import { Hono } from "hono";
import { sql } from "drizzle-orm";

import {
  createDatabase,
  type AppDatabase,
} from "../../../../packages/db/src";
import type {
  AssayResultRevision,
  AssayResultWorkItem,
  BankAllocation,
  SubmitAssayResultInput,
} from "../../../../packages/shared/src";
import {
  sha256Base64Url,
  type AuthenticatedUser,
} from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { inMemoryAssays } from "../assays/routes";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const assayResultRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

const RESULT_ENTRY_ROLES = new Set(["system_admin", "assay_admin", "chemist", "lab_manager"]);
const RESULT_APPROVAL_ROLES = new Set(["system_admin", "assay_admin", "lab_manager"]);
const inMemoryResults = new Map<string, AssayResultRevision[]>();

assayResultRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (user.role === "commercial_bank_user") {
    return c.json({ ok: false, message: "Шинжилгээний дүн удирдах эрхгүй байна." }, 403);
  }

  const records = c.env.DATABASE_URL
    ? await listResultWorkItemsFromDatabase(createDatabase(c.env.DATABASE_URL))
    : listResultWorkItemsFromMemory();

  return c.json({ ok: true, data: records });
});

assayResultRoutes.post("/:publicId", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!RESULT_ENTRY_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Шинжилгээний дүн оруулах эрхгүй байна." }, 403);
  }

  const input = normalizeSubmitResultInput(await c.req.json().catch(() => null));
  const validationMessage = validateSubmitResultInput(input);
  if (validationMessage) return c.json({ ok: false, message: validationMessage }, 400);

  const record = await (async () => {
    try {
      return c.env.DATABASE_URL
        ? await submitResultInDatabase(createDatabase(c.env.DATABASE_URL), c.req.param("publicId"), input, user)
        : submitResultInMemory(c.req.param("publicId"), input, user);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("correction request")) {
        return "locked" as const;
      }
      if (message.includes("waiting for approval")) {
        return "pending" as const;
      }
      throw error;
    }
  })();

  if (record === "locked") {
    return c.json({ ok: false, message: "Баталгаажсан дүнд засварын хүсэлтээр шинэ хувилбар үүсгэнэ." }, 409);
  }
  if (record === "pending") {
    return c.json({ ok: false, message: "Эрхлэгчийн батлах хүлээгдэж буй дүн байна." }, 409);
  }
  if (!record) return c.json({ ok: false, message: "Сорьц олдсонгүй." }, 404);
  return c.json({ ok: true, record }, 201);
});

assayResultRoutes.post("/:publicId/approve", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!RESULT_APPROVAL_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Шинжилгээний дүн батлах эрхгүй байна." }, 403);
  }

  const record = c.env.DATABASE_URL
    ? await approveResultInDatabase(createDatabase(c.env.DATABASE_URL), c.req.param("publicId"), user)
    : approveResultInMemory(c.req.param("publicId"), user);

  if (record === "maker_checker") {
    return c.json({ ok: false, message: "Дүн оруулсан хэрэглэгч өөрөө батлах боломжгүй." }, 409);
  }
  if (!record) {
    return c.json({ ok: false, message: "Батлах хүлээгдэж буй дүн олдсонгүй." }, 404);
  }

  return c.json({ ok: true, record });
});

async function listResultWorkItemsFromDatabase(db: AppDatabase): Promise<AssayResultWorkItem[]> {
  const result = await db.execute<ResultWorkItemRow>(sql`
    SELECT
      ar.public_id AS "id",
      c.display_name AS "customerName",
      ar.metal,
      ar.declared_gross_weight_grams::float AS "declaredWeightGrams",
      ar.received_gross_weight_grams::float AS "grossWeightGrams",
      rr.purity_percent::float AS "purityPercent",
      rr.fine_weight_grams::float AS "fineWeightGrams",
      ar.status,
      ar.received_at AS "receivedAt",
      intake.full_name AS "intakeOfficerName",
      COALESCE(
        json_agg(
          json_build_object(
            'bankName', bo.name,
            'allocatedGrams', ba.allocated_gross_weight_grams::float
          )
          ORDER BY bo.name
        ) FILTER (WHERE ba.id IS NOT NULL),
        '[]'::json
      ) AS allocations,
      CASE
        WHEN rr.id IS NULL THEN null
        ELSE json_build_object(
          'id', rr.id,
          'revisionNo', rr.revision_no,
          'status', rr.status,
          'methodName', rr.method_name,
          'instrumentName', rr.instrument_name,
          'grossWeightGrams', rr.gross_weight_grams::float,
          'purityPercent', rr.purity_percent::float,
          'fineWeightGrams', rr.fine_weight_grams::float,
          'resultNotes', rr.result_notes,
          'enteredByName', entered.full_name,
          'approvedByName', approved.full_name,
          'submittedAt', rr.submitted_at,
          'approvedAt', rr.approved_at,
          'createdAt', rr.created_at
        )
      END AS "latestResult"
    FROM assay_records ar
    INNER JOIN customers c ON ar.customer_id = c.id
    LEFT JOIN LATERAL (
      SELECT *
      FROM assay_result_revisions
      WHERE assay_record_id = ar.id
      ORDER BY revision_no DESC
      LIMIT 1
    ) rr ON true
    LEFT JOIN users entered ON rr.entered_by_user_id = entered.id
    LEFT JOIN users approved ON rr.approved_by_user_id = approved.id
    LEFT JOIN users intake ON ar.intake_officer_id = intake.id
    LEFT JOIN bank_allocations ba ON ba.assay_record_id = ar.id
    LEFT JOIN organizations bo ON ba.bank_organization_id = bo.id
    WHERE ar.status IN ('received', 'in_analysis', 'manager_review', 'approved')
    GROUP BY
      ar.id,
      ar.public_id,
      c.display_name,
      ar.metal,
      ar.declared_gross_weight_grams,
      ar.received_gross_weight_grams,
      ar.status,
      ar.received_at,
      ar.created_at,
      intake.full_name,
      rr.id,
      rr.revision_no,
      rr.status,
      rr.method_name,
      rr.instrument_name,
      rr.gross_weight_grams,
      rr.purity_percent,
      rr.fine_weight_grams,
      rr.result_notes,
      rr.submitted_at,
      rr.approved_at,
      rr.created_at,
      entered.full_name,
      approved.full_name
    ORDER BY ar.created_at DESC
    LIMIT 100
  `);

  return readRows(result).map(mapResultWorkItemRow);
}

async function submitResultInDatabase(
  db: AppDatabase,
  publicId: string,
  input: SubmitAssayResultInput,
  user: AuthenticatedUser,
): Promise<AssayResultWorkItem | null> {
  const now = new Date();
  const fineWeightGrams = calculateFineWeight(input.grossWeightGrams, input.purityPercent);
  const previousHash = await getLatestAuditHash(db);

  const recordRows = readRows(
    await db.execute<{
      assayRecordId: string;
      status: string;
      nextRevisionNo: number;
      latestResultId: string | null;
      latestResultStatus: string | null;
    }>(sql`
      SELECT
        ar.id AS "assayRecordId",
        ar.status,
        COALESCE(max(arr.revision_no), 0)::int + 1 AS "nextRevisionNo",
        (
          SELECT id
          FROM assay_result_revisions latest
          WHERE latest.assay_record_id = ar.id
          ORDER BY latest.revision_no DESC
          LIMIT 1
        ) AS "latestResultId",
        (
          SELECT status
          FROM assay_result_revisions latest
          WHERE latest.assay_record_id = ar.id
          ORDER BY latest.revision_no DESC
          LIMIT 1
        ) AS "latestResultStatus"
      FROM assay_records ar
      LEFT JOIN assay_result_revisions arr ON arr.assay_record_id = ar.id
      WHERE ar.public_id = ${publicId}
      GROUP BY ar.id, ar.status
      LIMIT 1
    `),
  );
  const record = recordRows[0];
  if (!record) return null;
  if (["approved", "bom_submitted", "bom_confirmed", "closed", "cancelled"].includes(record.status)) {
    throw new Error("Approved records need a correction request before a new result can be entered.");
  }
  if (record.latestResultStatus === "submitted") {
    if (!record.latestResultId) throw new Error("A submitted result is already waiting for approval.");
    return updateSubmittedResultInDatabase(db, {
      assayRecordId: record.assayRecordId,
      publicId,
      revisionId: record.latestResultId,
      input,
      user,
      now,
      fineWeightGrams,
      previousHash,
    });
  }

  const revisionId = crypto.randomUUID();
  const entryHash = await sha256Base64Url(
    JSON.stringify({
      actorUserId: user.id,
      actorOrganizationId: user.organizationId,
      action: "assay_result.submitted",
      entityType: "assay_result_revisions",
      entityId: revisionId,
      previousHash,
      createdAt: now.toISOString(),
    }),
  );

  await db.execute(sql`
    WITH created_result AS (
      INSERT INTO assay_result_revisions (
        id,
        assay_record_id,
        revision_no,
        status,
        entered_by_user_id,
        method_name,
        instrument_name,
        gross_weight_grams,
        purity_percent,
        fine_weight_grams,
        result_notes,
        submitted_at,
        created_at
      )
      VALUES (
        ${revisionId},
        ${record.assayRecordId},
        ${record.nextRevisionNo},
        'submitted',
        ${user.id},
        ${input.methodName},
        ${input.instrumentName?.trim() || null},
        ${toFixedDecimal(input.grossWeightGrams)},
        ${toFixedDecimal(input.purityPercent)},
        ${toFixedDecimal(fineWeightGrams)},
        ${input.resultNotes?.trim() || null},
        ${now},
        ${now}
      )
      RETURNING id
    ),
    updated_record AS (
      UPDATE assay_records
      SET
        status = 'manager_review',
        updated_at = ${now}
      WHERE id = ${record.assayRecordId}
      RETURNING id
    )
    INSERT INTO audit_logs (
      actor_user_id,
      actor_organization_id,
      action,
      entity_type,
      entity_id,
      reason,
      previous_hash,
      entry_hash,
      created_at
    )
    SELECT
      ${user.id},
      ${user.organizationId},
      'assay_result.submitted',
      'assay_result_revisions',
      id,
      'Assay result submitted for manager review',
      ${previousHash},
      ${entryHash},
      ${now}
    FROM created_result
  `);

  return findResultWorkItemByPublicId(db, publicId);
}

async function updateSubmittedResultInDatabase(
  db: AppDatabase,
  context: {
    assayRecordId: string;
    publicId: string;
    revisionId: string;
    input: SubmitAssayResultInput;
    user: AuthenticatedUser;
    now: Date;
    fineWeightGrams: number;
    previousHash: string | null;
  },
): Promise<AssayResultWorkItem | null> {
  const entryHash = await sha256Base64Url(
    JSON.stringify({
      actorUserId: context.user.id,
      actorOrganizationId: context.user.organizationId,
      action: "assay_result.updated",
      entityType: "assay_result_revisions",
      entityId: context.revisionId,
      previousHash: context.previousHash,
      createdAt: context.now.toISOString(),
    }),
  );

  await db.execute(sql`
    WITH updated_result AS (
      UPDATE assay_result_revisions
      SET
        entered_by_user_id = ${context.user.id},
        method_name = ${context.input.methodName},
        instrument_name = ${context.input.instrumentName?.trim() || null},
        gross_weight_grams = ${toFixedDecimal(context.input.grossWeightGrams)},
        purity_percent = ${toFixedDecimal(context.input.purityPercent)},
        fine_weight_grams = ${toFixedDecimal(context.fineWeightGrams)},
        result_notes = ${context.input.resultNotes?.trim() || null},
        submitted_at = ${context.now}
      WHERE id = ${context.revisionId}
        AND status = 'submitted'
      RETURNING id
    ),
    updated_record AS (
      UPDATE assay_records
      SET
        status = 'manager_review',
        updated_at = ${context.now}
      WHERE id = ${context.assayRecordId}
      RETURNING id
    )
    INSERT INTO audit_logs (
      actor_user_id,
      actor_organization_id,
      action,
      entity_type,
      entity_id,
      reason,
      previous_hash,
      entry_hash,
      created_at
    )
    SELECT
      ${context.user.id},
      ${context.user.organizationId},
      'assay_result.updated',
      'assay_result_revisions',
      id,
      'Submitted assay result updated before approval',
      ${context.previousHash},
      ${entryHash},
      ${context.now}
    FROM updated_result
  `);

  return findResultWorkItemByPublicId(db, context.publicId);
}

async function approveResultInDatabase(
  db: AppDatabase,
  publicId: string,
  user: AuthenticatedUser,
): Promise<AssayResultWorkItem | "maker_checker" | null> {
  const submittedRows = readRows(
    await db.execute<{ revisionId: string; assayRecordId: string; revisionNo: number; enteredByUserId: string }>(sql`
      SELECT
        rr.id AS "revisionId",
        rr.assay_record_id AS "assayRecordId",
        rr.revision_no AS "revisionNo",
        rr.entered_by_user_id AS "enteredByUserId"
      FROM assay_result_revisions rr
      INNER JOIN assay_records ar ON rr.assay_record_id = ar.id
      WHERE ar.public_id = ${publicId}
        AND rr.status = 'submitted'
      ORDER BY rr.revision_no DESC
      LIMIT 1
    `),
  );
  const submitted = submittedRows[0];
  if (!submitted) return null;
  if (submitted.enteredByUserId === user.id) return "maker_checker";

  const now = new Date();
  const previousHash = await getLatestAuditHash(db);
  const entryHash = await sha256Base64Url(
    JSON.stringify({
      actorUserId: user.id,
      actorOrganizationId: user.organizationId,
      action: "assay_result.approved",
      entityType: "assay_result_revisions",
      entityId: submitted.revisionId,
      previousHash,
      createdAt: now.toISOString(),
    }),
  );

  await db.execute(sql`
    WITH superseded_results AS (
      UPDATE assay_result_revisions
      SET status = 'superseded'
      WHERE assay_record_id = ${submitted.assayRecordId}
        AND status = 'approved'
      RETURNING id
    ),
    approved_result AS (
      UPDATE assay_result_revisions
      SET
        status = 'approved',
        approved_by_user_id = ${user.id},
        approved_at = ${now}
      WHERE id = ${submitted.revisionId}
      RETURNING id, assay_record_id, revision_no
    ),
    updated_record AS (
      UPDATE assay_records
      SET
        status = 'approved',
        locked_at = ${now},
        locked_by_user_id = ${user.id},
        lock_reason = 'Assay result approved',
        current_result_revision = ${submitted.revisionNo},
        updated_at = ${now}
      WHERE id = ${submitted.assayRecordId}
      RETURNING id
    )
    INSERT INTO audit_logs (
      actor_user_id,
      actor_organization_id,
      action,
      entity_type,
      entity_id,
      reason,
      previous_hash,
      entry_hash,
      created_at
    )
    SELECT
      ${user.id},
      ${user.organizationId},
      'assay_result.approved',
      'assay_result_revisions',
      id,
      'Assay result approved and locked',
      ${previousHash},
      ${entryHash},
      ${now}
    FROM approved_result
  `);

  return findResultWorkItemByPublicId(db, publicId);
}

async function findResultWorkItemByPublicId(
  db: AppDatabase,
  publicId: string,
): Promise<AssayResultWorkItem | null> {
  const records = await listResultWorkItemsFromDatabase(db);
  return records.find((record) => record.id === publicId) ?? null;
}

function listResultWorkItemsFromMemory(): AssayResultWorkItem[] {
  return inMemoryAssays.map((record) => withLatestResult(record, inMemoryResults.get(record.id) ?? []));
}

function submitResultInMemory(
  publicId: string,
  input: SubmitAssayResultInput,
  user: AuthenticatedUser,
): AssayResultWorkItem | null {
  const record = inMemoryAssays.find((item) => item.id === publicId);
  if (!record) return null;
  const revisions = inMemoryResults.get(publicId) ?? [];
  const latestRevision = revisions.at(-1);
  if (latestRevision?.status === "submitted") {
    const now = new Date().toISOString();
    latestRevision.methodName = input.methodName;
    latestRevision.instrumentName = input.instrumentName?.trim() || null;
    latestRevision.grossWeightGrams = input.grossWeightGrams;
    latestRevision.purityPercent = input.purityPercent;
    latestRevision.fineWeightGrams = calculateFineWeight(input.grossWeightGrams, input.purityPercent);
    latestRevision.resultNotes = input.resultNotes?.trim() || null;
    latestRevision.enteredByName = user.fullName;
    latestRevision.submittedAt = now;
    record.status = "manager_review";
    record.purityPercent = latestRevision.purityPercent;
    record.fineWeightGrams = latestRevision.fineWeightGrams;

    return withLatestResult(record, revisions);
  }

  const now = new Date().toISOString();
  const revision: AssayResultRevision = {
    id: crypto.randomUUID(),
    revisionNo: revisions.length + 1,
    status: "submitted",
    methodName: input.methodName,
    instrumentName: input.instrumentName?.trim() || null,
    grossWeightGrams: input.grossWeightGrams,
    purityPercent: input.purityPercent,
    fineWeightGrams: calculateFineWeight(input.grossWeightGrams, input.purityPercent),
    resultNotes: input.resultNotes?.trim() || null,
    enteredByName: user.fullName,
    approvedByName: null,
    submittedAt: now,
    approvedAt: null,
    createdAt: now,
  };

  revisions.push(revision);
  inMemoryResults.set(publicId, revisions);
  record.status = "manager_review";
  record.purityPercent = revision.purityPercent;
  record.fineWeightGrams = revision.fineWeightGrams;

  return withLatestResult(record, revisions);
}

function approveResultInMemory(
  publicId: string,
  user: AuthenticatedUser,
): AssayResultWorkItem | "maker_checker" | null {
  const record = inMemoryAssays.find((item) => item.id === publicId);
  const revisions = inMemoryResults.get(publicId) ?? [];
  const revision = revisions.findLast((item) => item.status === "submitted");
  if (!record || !revision) return null;
  if (revision.enteredByName === user.fullName) return "maker_checker";

  revision.status = "approved";
  revision.approvedByName = user.fullName;
  revision.approvedAt = new Date().toISOString();
  record.status = "approved";
  record.purityPercent = revision.purityPercent;
  record.fineWeightGrams = revision.fineWeightGrams;

  return withLatestResult(record, revisions);
}

function withLatestResult(
  record: typeof inMemoryAssays[number],
  revisions: AssayResultRevision[],
): AssayResultWorkItem {
  return {
    ...record,
    intakeOfficerName: null,
    latestResult: revisions.at(-1) ?? null,
  };
}

function normalizeSubmitResultInput(value: unknown): SubmitAssayResultInput {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const method = readText(body.methodName);

  return {
    methodName: isResultMethod(method) ? method : "XRF",
    instrumentName: readText(body.instrumentName),
    grossWeightGrams: readNumber(body.grossWeightGrams),
    purityPercent: readNumber(body.purityPercent),
    resultNotes: readText(body.resultNotes),
  };
}

function validateSubmitResultInput(input: SubmitAssayResultInput): string | null {
  if (input.grossWeightGrams <= 0) return "Шинжилсэн жин 0-ээс их байна.";
  if (input.purityPercent <= 0 || input.purityPercent > 100) {
    return "Сорьцын хувь 0-100 хооронд байна.";
  }

  return null;
}

function isResultMethod(value: string): value is SubmitAssayResultInput["methodName"] {
  return ["XRF", "Fire assay", "ICP", "Бусад"].includes(value);
}

function mapResultWorkItemRow(row: ResultWorkItemRow): AssayResultWorkItem {
  const latestResult = row.latestResult ? mapResultRevision(row.latestResult) : null;

  return {
    id: row.id,
    customerName: row.customerName,
    metal: row.metal,
    declaredWeightGrams: Number(row.declaredWeightGrams),
    grossWeightGrams: Number(row.grossWeightGrams),
    purityPercent: row.purityPercent === null ? null : Number(row.purityPercent),
    fineWeightGrams: row.fineWeightGrams === null ? null : Number(row.fineWeightGrams),
    status: row.status,
    allocations: Array.isArray(row.allocations) ? row.allocations : [],
    receivedAt: row.receivedAt instanceof Date
      ? row.receivedAt.toISOString()
      : row.receivedAt,
    intakeOfficerName: row.intakeOfficerName,
    latestResult,
  };
}

function mapResultRevision(value: ResultRevisionJson): AssayResultRevision {
  return {
    id: value.id,
    revisionNo: Number(value.revisionNo),
    status: value.status,
    methodName: value.methodName,
    instrumentName: value.instrumentName,
    grossWeightGrams: Number(value.grossWeightGrams),
    purityPercent: Number(value.purityPercent),
    fineWeightGrams: Number(value.fineWeightGrams),
    resultNotes: value.resultNotes,
    enteredByName: value.enteredByName,
    approvedByName: value.approvedByName,
    submittedAt: normalizeDate(value.submittedAt),
    approvedAt: normalizeDate(value.approvedAt),
    createdAt: normalizeDate(value.createdAt) ?? new Date(0).toISOString(),
  };
}

async function getLatestAuditHash(db: AppDatabase): Promise<string | null> {
  const [row] = readRows(
    await db.execute<{ entryHash: string | null }>(sql`
      SELECT entry_hash AS "entryHash"
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT 1
    `),
  );

  return row?.entryHash ?? null;
}

function calculateFineWeight(grossWeightGrams: number, purityPercent: number): number {
  return Number(((grossWeightGrams * purityPercent) / 100).toFixed(4));
}

function normalizeDate(value: string | Date | null): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toFixedDecimal(value: number): string {
  return value.toFixed(4);
}

function readRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

type ResultWorkItemRow = {
  id: string;
  customerName: string;
  metal: "gold" | "silver";
  declaredWeightGrams: number | string;
  grossWeightGrams: number | string;
  purityPercent: number | string | null;
  fineWeightGrams: number | string | null;
  status: AssayResultWorkItem["status"];
  allocations: BankAllocation[];
  receivedAt: string | Date | null;
  intakeOfficerName: string | null;
  latestResult: ResultRevisionJson | null;
};

type ResultRevisionJson = {
  id: string;
  revisionNo: number | string;
  status: AssayResultRevision["status"];
  methodName: string;
  instrumentName: string | null;
  grossWeightGrams: number | string;
  purityPercent: number | string;
  fineWeightGrams: number | string;
  resultNotes: string | null;
  enteredByName: string;
  approvedByName: string | null;
  submittedAt: string | Date | null;
  approvedAt: string | Date | null;
  createdAt: string | Date | null;
};

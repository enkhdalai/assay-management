import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { createDatabase, type AppDatabase } from "../../../../packages/db/src";
import type {
  BullionIntakeBatchRecord,
  CreateBullionIntakeInput,
  SubmitBullionExaminationInput,
} from "../../../../packages/shared/src";
import { sha256Base64Url, type AuthenticatedUser } from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const bullionRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

const INTAKE_ROLES = new Set(["system_admin", "assay_admin", "intake_officer"]);
const EXAMINATION_ROLES = new Set(["system_admin", "assay_admin", "chemist", "lab_manager"]);
const inMemoryBatches: BullionIntakeBatchRecord[] = [];

bullionRoutes.get("/intakes", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!INTAKE_ROLES.has(user.role) && !EXAMINATION_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Гулдмайн бүртгэл харах эрхгүй байна." }, 403);
  }

  const data = c.env.DATABASE_URL
    ? await listIntakesFromDatabase(createDatabase(c.env.DATABASE_URL), user)
    : inMemoryBatches;
  return c.json({ ok: true, data });
});

bullionRoutes.post("/intakes", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!INTAKE_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Гулдмай хүлээн авах эрхгүй байна." }, 403);
  }

  const input = normalizeIntake(await c.req.json().catch(() => null));
  const validation = validateIntake(input);
  if (validation) return c.json({ ok: false, message: validation }, 400);

  const record = c.env.DATABASE_URL
    ? await createIntakeInDatabase(createDatabase(c.env.DATABASE_URL), user, input)
    : createIntakeInMemory(user, input);
  if (record === "customer_not_found") {
    return c.json({ ok: false, message: "Сонгосон харилцагч олдсонгүй." }, 404);
  }
  return c.json({ ok: true, record }, 201);
});

bullionRoutes.post("/examinations", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!EXAMINATION_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Шинжилгээний дүн оруулах эрхгүй байна." }, 403);
  }

  const input = normalizeExamination(await c.req.json().catch(() => null));
  const validation = validateExamination(input);
  if (validation) return c.json({ ok: false, message: validation }, 400);
  if (!c.env.DATABASE_URL) {
    return c.json({ ok: true, record: { ...input, revisionNo: 1 } }, 201);
  }

  const result = await createExaminationInDatabase(createDatabase(c.env.DATABASE_URL), user, input);
  if (result === "item_not_found") {
    return c.json({ ok: false, message: "Сонгосон гулдмай олдсонгүй." }, 404);
  }
  return c.json({ ok: true, record: result }, 201);
});

async function listIntakesFromDatabase(db: AppDatabase, user: AuthenticatedUser): Promise<BullionIntakeBatchRecord[]> {
  const organizationFilter = user.role === "system_admin" ? sql`` : sql`WHERE b.assay_center_id = ${user.organizationId}`;
  const result = await db.execute<IntakeRow>(sql`
    SELECT b.id, b.public_id AS "publicId", b.metal, b.received_at AS "receivedAt", b.branch_name AS "branchName",
      b.province, b.district, b.dispatch_reference AS "dispatchReference", b.initial_bullion_number AS "initialBullionNumber",
      b.piece_count AS "pieceCount", b.delta::float AS delta, b.status, b.created_at AS "createdAt",
      c.display_name AS "customerName", u.full_name AS "receivedByName",
      COALESCE(json_agg(json_build_object('id', i.id, 'sequenceNo', i.sequence_no, 'analysisNo', i.analysis_no,
        'bullionNo', i.bullion_no, 'grossWeightBeforeGrams', i.gross_weight_before_grams::float,
        'grossWeightAfterGrams', i.gross_weight_after_grams::float, 'slagWeightGrams', i.slag_weight_grams::float,
        'sampleWeightMilligrams', i.sample_weight_milligrams::float) ORDER BY i.sequence_no)
        FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
    FROM bullion_intake_batches b
    JOIN customers c ON c.id = b.customer_id
    JOIN users u ON u.id = b.received_by_user_id
    LEFT JOIN bullion_intake_items i ON i.batch_id = b.id
    ${organizationFilter}
    GROUP BY b.id, c.display_name, u.full_name
    ORDER BY b.created_at DESC LIMIT 100
  `);
  return readRows(result).map(mapIntakeRow);
}

async function createIntakeInDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
  input: CreateBullionIntakeInput,
): Promise<BullionIntakeBatchRecord | "customer_not_found"> {
  const customer = readRows(await db.execute<{ id: string; displayName: string }>(sql`
    SELECT c.id, c.display_name AS "displayName" FROM customers c
    JOIN users creator ON creator.id = c.created_by_user_id
    WHERE c.id = ${input.customerId}
      AND (${user.role} = 'system_admin' OR creator.organization_id = ${user.organizationId})
    LIMIT 1
  `))[0];
  if (!customer) return "customer_not_found";

  const today = new Date();
  const datePrefix = `${String(today.getFullYear()).slice(-2)}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const next = readRows(await db.execute<{ count: number | string }>(sql`
    SELECT count(*)::int AS count FROM bullion_intake_batches WHERE public_id LIKE ${`BI-${datePrefix}-%`}
  `))[0]?.count ?? 0;
  const publicId = `BI-${datePrefix}-${String(Number(next) + 1).padStart(3, "0")}`;
  const batchId = crypto.randomUUID();
  const itemRows = input.items.map((item, index) => ({ id: crypto.randomUUID(), sequenceNo: index + 1, ...item }));

  await db.execute(sql`
    INSERT INTO bullion_intake_batches (
      id, public_id, assay_center_id, customer_id, received_by_user_id, metal, received_at, branch_name,
      province, district, dispatch_reference, initial_bullion_number, piece_count, delta, status
    ) VALUES (
      ${batchId}, ${publicId}, ${user.organizationId}, ${customer.id}, ${user.id}, ${input.metal},
      ${input.receivedAt ? new Date(input.receivedAt) : new Date()}, ${input.branchName || null}, ${input.province || null},
      ${input.district || null}, ${input.dispatchReference || null}, ${input.initialBullionNumber || null},
      ${itemRows.length}, ${input.delta ?? 0}, ${input.status ?? "draft"}
    )
  `);
  for (const item of itemRows) {
    await db.execute(sql`
      INSERT INTO bullion_intake_items (
        id, batch_id, sequence_no, analysis_no, bullion_no, gross_weight_before_grams,
        gross_weight_after_grams, slag_weight_grams, sample_weight_milligrams
      ) VALUES (${item.id}, ${batchId}, ${item.sequenceNo}, ${item.analysisNo || null}, ${item.bullionNo},
        ${item.grossWeightBeforeGrams}, ${item.grossWeightAfterGrams ?? null}, ${item.slagWeightGrams ?? null},
        ${item.sampleWeightMilligrams ?? null})
    `);
  }
  await appendAuditLog(db, user, "bullion_intake.created", "bullion_intake_batches", batchId, { publicId, pieceCount: itemRows.length });
  return {
    id: batchId, publicId, customerId: customer.id, customerName: customer.displayName, receivedByName: user.fullName,
    metal: input.metal, receivedAt: input.receivedAt ?? new Date().toISOString(), branchName: input.branchName,
    province: input.province, district: input.district, dispatchReference: input.dispatchReference,
    initialBullionNumber: input.initialBullionNumber, pieceCount: itemRows.length, delta: input.delta,
    status: input.status, createdAt: new Date().toISOString(), items: itemRows,
  };
}

async function createExaminationInDatabase(db: AppDatabase, user: AuthenticatedUser, input: SubmitBullionExaminationInput) {
  const item = readRows(await db.execute<{ id: string; nextRevisionNo: number }>(sql`
    SELECT i.id, COALESCE(max(e.revision_no), 0)::int + 1 AS "nextRevisionNo"
    FROM bullion_intake_items i
    JOIN bullion_intake_batches b ON b.id = i.batch_id
    LEFT JOIN bullion_examination_revisions e ON e.bullion_item_id = i.id
    WHERE i.id = ${input.bullionItemId} AND (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
    GROUP BY i.id LIMIT 1
  `))[0];
  if (!item) return "item_not_found" as const;
  const id = crypto.randomUUID();
  await db.execute(sql`
    INSERT INTO bullion_examination_revisions (
      id, bullion_item_id, revision_no, examination_no, entered_by_user_id, status, delta, sample_weight_grams,
      weight_entries, measurement_entries, gold_result, silver_result, reexamination_requested, notes, submitted_at
    ) VALUES (${id}, ${item.id}, ${item.nextRevisionNo}, ${input.examinationNo}, ${user.id}, ${input.status},
      ${input.delta ?? 0}, ${input.sampleWeightGrams}, ${JSON.stringify(input.weightEntries)}::jsonb,
      ${JSON.stringify(input.measurementEntries)}::jsonb, ${input.goldResult ?? null}, ${input.silverResult ?? null},
      ${input.reexaminationRequested ?? false}, ${input.notes || null},
      ${input.status === "submitted" ? new Date() : null})
  `);
  await appendAuditLog(db, user, "bullion_examination.saved", "bullion_examination_revisions", id, { bullionItemId: item.id, revisionNo: item.nextRevisionNo, status: input.status });
  return { id, ...input, revisionNo: item.nextRevisionNo };
}

function createIntakeInMemory(user: AuthenticatedUser, input: CreateBullionIntakeInput): BullionIntakeBatchRecord {
  const now = new Date().toISOString();
  const record: BullionIntakeBatchRecord = {
    id: crypto.randomUUID(), publicId: `BI-LOCAL-${String(inMemoryBatches.length + 1).padStart(3, "0")}`,
    customerId: input.customerId, customerName: "Харилцагч", receivedByName: user.fullName, metal: input.metal,
    receivedAt: input.receivedAt ?? now, branchName: input.branchName, province: input.province, district: input.district,
    dispatchReference: input.dispatchReference, initialBullionNumber: input.initialBullionNumber,
    pieceCount: input.items.length, delta: input.delta, status: input.status, createdAt: now,
    items: input.items.map((item, index) => ({ ...item, id: crypto.randomUUID(), sequenceNo: index + 1 })),
  };
  inMemoryBatches.unshift(record);
  return record;
}

function normalizeIntake(value: unknown): CreateBullionIntakeInput {
  const body = object(value);
  return {
    customerId: text(body.customerId), metal: body.metal === "silver" ? "silver" : "gold", receivedAt: text(body.receivedAt),
    branchName: text(body.branchName), province: text(body.province), district: text(body.district), dispatchReference: text(body.dispatchReference),
    initialBullionNumber: text(body.initialBullionNumber), delta: number(body.delta), status: body.status === "sample_taken" ? "sample_taken" : "draft",
    items: Array.isArray(body.items) ? body.items.map((item) => {
      const row = object(item);
      return { analysisNo: text(row.analysisNo), bullionNo: text(row.bullionNo), grossWeightBeforeGrams: number(row.grossWeightBeforeGrams) ?? 0,
        grossWeightAfterGrams: number(row.grossWeightAfterGrams), slagWeightGrams: number(row.slagWeightGrams), sampleWeightMilligrams: number(row.sampleWeightMilligrams) };
    }) : [],
  };
}

function normalizeExamination(value: unknown): SubmitBullionExaminationInput {
  const body = object(value);
  return {
    bullionItemId: text(body.bullionItemId), examinationNo: text(body.examinationNo), sampleWeightGrams: number(body.sampleWeightGrams) ?? 0,
    delta: number(body.delta), status: body.status === "submitted" ? "submitted" : "draft",
    weightEntries: Array.isArray(body.weightEntries) ? body.weightEntries.map((entry) => {
      const row = object(entry); return { receivedWeightGrams: number(row.receivedWeightGrams) ?? 0,
        calculation: row.calculation === "yes" || row.calculation === "addition" ? row.calculation : "no", outputWeightGrams: number(row.outputWeightGrams) ?? 0 };
    }) : [],
    measurementEntries: Array.isArray(body.measurementEntries) ? body.measurementEntries.map((entry) => {
      const row = object(entry); return { label: text(row.label), reading: number(row.reading) ?? 0, goldAssay: number(row.goldAssay), silverAssay: number(row.silverAssay) };
    }) : [],
    goldResult: number(body.goldResult), silverResult: number(body.silverResult), reexaminationRequested: body.reexaminationRequested === true, notes: text(body.notes),
  };
}

function validateIntake(input: CreateBullionIntakeInput) {
  if (!isUuid(input.customerId)) return "Харилцагчийг сонгоно уу.";
  if (!input.items.length) return "Дор хаяж нэг гулдмайн мөр оруулна уу.";
  if (input.items.some((item) => !item.bullionNo || item.grossWeightBeforeGrams <= 0)) return "Гулдмайн дугаар болон жинг зөв оруулна уу.";
  return null;
}
function validateExamination(input: SubmitBullionExaminationInput) {
  if (!isUuid(input.bullionItemId) || !input.examinationNo || input.sampleWeightGrams <= 0) return "Шинжилгээний дугаар, гулдмай, дээжийн жинг зөв оруулна уу.";
  return null;
}
async function appendAuditLog(db: AppDatabase, user: AuthenticatedUser, action: string, entityType: string, entityId: string, metadata: unknown) {
  const previous = readRows(await db.execute<{ entryHash: string | null }>(sql`SELECT entry_hash AS "entryHash" FROM audit_logs ORDER BY created_at DESC LIMIT 1`))[0]?.entryHash ?? null;
  const now = new Date();
  const hash = await sha256Base64Url(JSON.stringify({ userId: user.id, action, entityType, entityId, previous, now: now.toISOString() }));
  await db.execute(sql`INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, previous_hash, entry_hash, created_at)
    VALUES (${crypto.randomUUID()}, ${user.id}, ${user.organizationId}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(metadata)}::jsonb, 'Bullion workflow action', ${previous}, ${hash}, ${now})`);
}
function mapIntakeRow(row: IntakeRow): BullionIntakeBatchRecord { return { ...row, pieceCount: Number(row.pieceCount), delta: Number(row.delta), receivedAt: iso(row.receivedAt), createdAt: iso(row.createdAt), items: Array.isArray(row.items) ? row.items : [] }; }
function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }
function readRows<T>(result: T[] | { rows: T[] }): T[] { return Array.isArray(result) ? result : result.rows; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown): number | undefined { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
type IntakeRow = Omit<BullionIntakeBatchRecord, "items" | "receivedAt" | "createdAt"> & { receivedAt: string | Date; createdAt: string | Date; items: BullionIntakeBatchRecord["items"]; };

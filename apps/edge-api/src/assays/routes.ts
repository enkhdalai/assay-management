import { Hono } from "hono";
import { sql } from "drizzle-orm";

import {
  createDatabase,
  type AppDatabase,
} from "../../../../packages/db/src";
import type {
  AssayApiRecord,
  BankAllocation,
  CreateAssayInput,
} from "../../../../packages/shared/src";
import {
  sha256Base64Url,
  type AuthenticatedUser,
} from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const assayRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

export const inMemoryAssays: AssayApiRecord[] = [];
const ASSAY_WRITE_ROLES = new Set(["system_admin", "assay_admin", "intake_officer"]);

assayRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);

  const records = c.env.DATABASE_URL
    ? await listAssaysFromDatabase(createDatabase(c.env.DATABASE_URL), user)
    : listAssaysFromMemory(user);

  return c.json({
    data: records,
    securityNote:
      "Commercial bank users only receive records allocated to their own organization.",
  });
});

assayRoutes.post("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!ASSAY_WRITE_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Сорьц бүртгэх эрхгүй байна." }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const input = normalizeCreateAssayInput(body);
  const validationMessage = validateCreateAssayInput(input);
  if (validationMessage) {
    return c.json({ ok: false, message: validationMessage }, 400);
  }

  if (c.env.DATABASE_URL) {
    const db = createDatabase(c.env.DATABASE_URL);
    const customerMessage = await validateCustomerSelection(db, user, input.customerId);
    if (customerMessage) return c.json({ ok: false, message: customerMessage }, 400);
    const bankMessage = await validateBankAllocations(db, input.allocations);
    if (bankMessage) return c.json({ ok: false, message: bankMessage }, 400);
  }

  const record = c.env.DATABASE_URL
    ? await createAssayInDatabase(createDatabase(c.env.DATABASE_URL), user, input)
    : await createAssayInMemory(user, input);

  return c.json({ ok: true, record }, 201);
});

async function listAssaysFromDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
): Promise<AssayApiRecord[]> {
  const bankOnlyFilter =
    user.role === "commercial_bank_user"
      ? sql`WHERE EXISTS (
          SELECT 1
          FROM bank_allocations scoped_ba
          WHERE scoped_ba.assay_record_id = ar.id
            AND scoped_ba.bank_organization_id = ${user.organizationId}
        )`
      : sql``;

  const result = await db.execute<AssayApiRecordRow>(sql`
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
      COALESCE(
        json_agg(
          json_build_object(
            'bankName', bo.name,
            'allocatedGrams', ba.allocated_gross_weight_grams::float
          )
          ORDER BY bo.name
        ) FILTER (WHERE ba.id IS NOT NULL),
        '[]'::json
      ) AS allocations
    FROM assay_records ar
    INNER JOIN customers c ON ar.customer_id = c.id
    LEFT JOIN LATERAL (
      SELECT purity_percent, fine_weight_grams
      FROM assay_result_revisions
      WHERE assay_record_id = ar.id
      ORDER BY revision_no DESC
      LIMIT 1
    ) rr ON true
    LEFT JOIN bank_allocations ba ON ba.assay_record_id = ar.id
    LEFT JOIN organizations bo ON ba.bank_organization_id = bo.id
    ${bankOnlyFilter}
    GROUP BY
      ar.id,
      ar.public_id,
      c.display_name,
      ar.metal,
      ar.declared_gross_weight_grams,
      ar.received_gross_weight_grams,
      rr.purity_percent,
      rr.fine_weight_grams,
      ar.status,
      ar.received_at,
      ar.created_at
    ORDER BY ar.created_at DESC
    LIMIT 100
  `);

  return readRows(result).map(mapAssayRecordRow);
}

async function createAssayInDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
  input: CreateAssayInput,
): Promise<AssayApiRecord> {
  const now = new Date();
  const customerId = crypto.randomUUID();
  const assayRecordId = crypto.randomUUID();
  const sampleId = crypto.randomUUID();
  const publicId = await nextAssayPublicId(db, now);
  const registrationHash = input.customerRegistrationNumber
    ? await sha256Base64Url(input.customerRegistrationNumber)
    : null;
  const phoneHash = input.customerPhone ? await sha256Base64Url(input.customerPhone) : null;
  const bankAllocations = input.allocations.map((allocation) => ({
    bankId: allocation.bankId,
    allocatedGrams: toFixedDecimal(allocation.allocatedGrams),
  }));
  const previousHash = await getLatestAuditHash(db);
  const entryHash = await sha256Base64Url(
    JSON.stringify({
      actorUserId: user.id,
      actorOrganizationId: user.organizationId,
      action: "assay_record.created",
      entityType: "assay_records",
      entityId: assayRecordId,
      reason: "Initial assay intake registration",
      previousHash,
      createdAt: now.toISOString(),
    }),
  );

  const result = await db.execute<AssayApiRecordRow>(sql`
    WITH input_banks AS (
      SELECT *
      FROM jsonb_to_recordset(${JSON.stringify(bankAllocations)}::jsonb)
        AS x("bankId" uuid, "allocatedGrams" numeric)
    ),
    bank_rows AS (
      SELECT o.id, o.name
      FROM organizations o
      INNER JOIN input_banks ib ON ib."bankId" = o.id
    ),
    created_customer AS (
      INSERT INTO customers (
        id,
        type,
        display_name,
        registration_number_encrypted,
        registration_number_hash,
        phone_encrypted,
        phone_hash,
        email_encrypted,
        created_by_user_id
      )
      VALUES (
        ${customerId},
        ${input.customerType},
        ${input.customerName.trim()},
        ${input.customerRegistrationNumber ? maskSensitiveValue(input.customerRegistrationNumber) : null},
        ${registrationHash},
        ${input.customerPhone ? maskPhone(input.customerPhone) : null},
        ${phoneHash},
        ${input.customerEmail ? maskEmail(input.customerEmail) : null},
        ${user.id}
      )
      WHERE ${input.customerId ?? null} IS NULL
      RETURNING id, display_name
    ),
    selected_customer AS (
      SELECT c.id, c.display_name
      FROM customers c
      INNER JOIN users creator ON creator.id = c.created_by_user_id
      WHERE c.id = ${input.customerId ?? null}
        AND (${user.role === "system_admin"} OR creator.organization_id = ${user.organizationId})
    ),
    customer_source AS (
      SELECT id, display_name FROM created_customer
      UNION ALL
      SELECT id, display_name FROM selected_customer
    ),
    created_record AS (
      INSERT INTO assay_records (
        id,
        public_id,
        assay_center_id,
        customer_id,
        intake_officer_id,
        metal,
        declared_gross_weight_grams,
        received_gross_weight_grams,
        status,
        customer_instruction,
        received_at
      )
      SELECT
        ${assayRecordId},
        ${publicId},
        ${user.organizationId},
        id,
        ${user.id},
        ${input.metal},
        ${toFixedDecimal(input.declaredWeightGrams)},
        ${toFixedDecimal(input.receivedWeightGrams)},
        'received',
        ${input.customerInstruction?.trim() || null},
        ${now}
      FROM customer_source
      RETURNING id, public_id, metal, declared_gross_weight_grams, received_gross_weight_grams, status, received_at
    ),
    created_sample AS (
      INSERT INTO assay_samples (
        id,
        assay_record_id,
        sample_no,
        sample_weight_grams,
        received_by_user_id
      )
      SELECT ${sampleId}, id, 1, received_gross_weight_grams, ${user.id}
      FROM created_record
      RETURNING id
    ),
    created_allocations AS (
      INSERT INTO bank_allocations (
        id,
        assay_record_id,
        bank_organization_id,
        allocated_gross_weight_grams,
        customer_instruction_note,
        status,
        created_by_user_id
      )
      SELECT
        gen_random_uuid(),
        ${assayRecordId},
        bank_rows.id,
        input_banks."allocatedGrams",
        ${input.customerInstruction?.trim() || null},
        'assigned',
        ${user.id}
      FROM input_banks
      INNER JOIN bank_rows ON input_banks."bankId" = bank_rows.id
      RETURNING id
    ),
    created_audit AS (
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
      VALUES (
        ${user.id},
        ${user.organizationId},
        'assay_record.created',
        'assay_records',
        ${assayRecordId},
        'Initial assay intake registration',
        ${previousHash},
        ${entryHash},
        ${now}
      )
      RETURNING id
    )
    SELECT
      cr.public_id AS "id",
      cc.display_name AS "customerName",
      cr.metal,
      cr.declared_gross_weight_grams::float AS "declaredWeightGrams",
      cr.received_gross_weight_grams::float AS "grossWeightGrams",
      null::float AS "purityPercent",
      null::float AS "fineWeightGrams",
      cr.status,
      cr.received_at AS "receivedAt",
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'bankName', bank_rows.name,
              'allocatedGrams', input_banks."allocatedGrams"::float
            )
            ORDER BY bank_rows.name
          )
          FROM input_banks
          INNER JOIN bank_rows ON input_banks."bankId" = bank_rows.id
        ),
        '[]'::json
      ) AS allocations
    FROM created_record cr
    CROSS JOIN customer_source cc
  `);
  const [record] = readRows(result).map(mapAssayRecordRow);

  if (!record) {
    throw new Error("Failed to create assay record.");
  }

  return record;
}

function listAssaysFromMemory(user: AuthenticatedUser): AssayApiRecord[] {
  if (user.role !== "commercial_bank_user") return inMemoryAssays;

  return inMemoryAssays.filter((record) =>
    record.allocations.some((allocation) => allocation.bankName === user.organizationName),
  );
}

async function createAssayInMemory(
  _user: AuthenticatedUser,
  input: CreateAssayInput,
): Promise<AssayApiRecord> {
  const record: AssayApiRecord = {
    id: `AC-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}-${String(inMemoryAssays.length + 1).padStart(3, "0")}`,
    customerName: input.customerName.trim(),
    metal: input.metal,
    declaredWeightGrams: input.declaredWeightGrams,
    grossWeightGrams: input.receivedWeightGrams,
    purityPercent: null,
    fineWeightGrams: null,
    status: "received",
    allocations: input.allocations.map((allocation) => ({
      bankName: allocation.bankName.trim(),
      allocatedGrams: allocation.allocatedGrams,
    })),
    receivedAt: new Date().toISOString(),
  };

  inMemoryAssays.unshift(record);
  return record;
}

async function nextAssayPublicId(db: AppDatabase, now: Date): Promise<string> {
  const datePart = now.toISOString().slice(2, 10).replaceAll("-", "");
  const [row] = readRows(
    await db.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count
      FROM assay_records
      WHERE public_id LIKE ${`AC-${datePart}-%`}
    `),
  );

  return `AC-${datePart}-${String((row?.count ?? 0) + 1).padStart(3, "0")}`;
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

function normalizeCreateAssayInput(value: unknown): CreateAssayInput {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const customerId = readText(body.customerId);

  return {
    customerId: customerId || undefined,
    customerName: readText(body.customerName),
    customerType: body.customerType === "legal_entity" ? "legal_entity" : "individual",
    customerRegistrationNumber: readText(body.customerRegistrationNumber),
    customerEmail: readText(body.customerEmail),
    customerPhone: readText(body.customerPhone),
    metal: body.metal === "silver" ? "silver" : "gold",
    declaredWeightGrams: readNumber(body.declaredWeightGrams),
    receivedWeightGrams: readNumber(body.receivedWeightGrams),
    customerInstruction: readText(body.customerInstruction),
    allocations: Array.isArray(body.allocations)
      ? body.allocations.map(normalizeAllocation)
      : [],
  };
}

function normalizeAllocation(value: unknown): BankAllocation {
  const allocation = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const bankId = readText(allocation.bankId);

  return {
    bankId: bankId || undefined,
    bankName: readText(allocation.bankName),
    allocatedGrams: readNumber(allocation.allocatedGrams),
  };
}

function validateCreateAssayInput(input: CreateAssayInput): string | null {
  if (!input.customerId && input.customerName.length < 2) return "Харилцагчийн нэрийг зөв оруулна уу.";
  if (input.customerId && !isUuid(input.customerId)) return "Харилцагчийн сонголт буруу байна.";
  if (input.declaredWeightGrams <= 0) return "Мэдүүлсэн жин 0-ээс их байна.";
  if (input.receivedWeightGrams <= 0) return "Хүлээн авсан жин 0-ээс их байна.";
  if (input.allocations.length === 0) return "Дор хаяж нэг банкны хуваарилалт оруулна уу.";

  const bankNames = new Set<string>();
  for (const allocation of input.allocations) {
    if (allocation.bankId && !isUuid(allocation.bankId)) return "Банкны сонголт буруу байна.";
    if (!allocation.bankId && allocation.bankName.length < 2) return "Банкны сонголт буруу байна.";
    if (allocation.allocatedGrams <= 0) return "Банкны хуваарилалтын жин 0-ээс их байна.";

    const key = allocation.bankId || allocation.bankName.toLocaleLowerCase();
    if (bankNames.has(key)) return "Нэг банкийг давхар сонгож болохгүй.";
    bankNames.add(key);
  }

  const totalAllocated = input.allocations.reduce(
    (sum, allocation) => sum + allocation.allocatedGrams,
    0,
  );
  if (Math.abs(totalAllocated - input.receivedWeightGrams) > 0.0001) {
    return "Банкны хуваарилалтын нийлбэр хүлээн авсан жинтэй тэнцүү байна.";
  }

  return null;
}

async function validateCustomerSelection(
  db: AppDatabase,
  user: AuthenticatedUser,
  customerId: string | undefined,
): Promise<string | null> {
  if (!customerId) return null;
  const [customer] = readRows(await db.execute<{ id: string }>(sql`
    SELECT c.id
    FROM customers c
    INNER JOIN users creator ON creator.id = c.created_by_user_id
    WHERE c.id = ${customerId}
      AND (${user.role === "system_admin"} OR creator.organization_id = ${user.organizationId})
    LIMIT 1
  `));
  return customer ? null : "Сонгосон харилцагч ашиглах боломжгүй байна.";
}

async function validateBankAllocations(
  db: AppDatabase,
  allocations: BankAllocation[],
): Promise<string | null> {
  if (allocations.some((allocation) => !allocation.bankId)) {
    return "Банкны лавлахаас идэвхтэй банк сонгоно уу.";
  }
  const bankIds = allocations.map((allocation) => allocation.bankId).filter(Boolean) as string[];
  const [row] = readRows(await db.execute<{ count: number }>(sql`
    SELECT count(*)::int AS count
    FROM organizations
    WHERE id IN (SELECT value::uuid FROM jsonb_array_elements_text(${JSON.stringify(bankIds)}::jsonb))
      AND type IN ('commercial_bank', 'bank_of_mongolia')
      AND status = 'active'
  `));
  return Number(row?.count ?? 0) === bankIds.length
    ? null
    : "Сонгосон банк идэвхгүй эсвэл ашиглах боломжгүй байна.";
}

function mapAssayRecordRow(row: AssayApiRecordRow): AssayApiRecord {
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
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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

function maskSensitiveValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `${trimmed.slice(0, 2)}${"*".repeat(Math.min(trimmed.length - 4, 8))}${trimmed.slice(-2)}`;
}

function maskEmail(value: string): string {
  const [localPart, domain] = value.trim().split("@");
  if (!localPart || !domain) return maskSensitiveValue(value);
  const visibleLocal = localPart.length <= 2 ? localPart[0] : localPart.slice(0, 2);
  return `${visibleLocal}***@${domain}`;
}

function maskPhone(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

function readRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

type AssayApiRecordRow = {
  id: string;
  customerName: string;
  metal: "gold" | "silver";
  declaredWeightGrams: number | string;
  grossWeightGrams: number | string;
  purityPercent: number | string | null;
  fineWeightGrams: number | string | null;
  status: AssayApiRecord["status"];
  allocations: BankAllocation[];
  receivedAt: string | Date | null;
};

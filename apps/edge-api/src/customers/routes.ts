import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  createDatabase,
  type AppDatabase,
} from "../../../../packages/db/src";
import type {
  CreateCustomerInput,
  CustomerRecord,
  CustomerType,
} from "../../../../packages/shared/src";
import {
  sha256Base64Url,
  type AuthenticatedUser,
} from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { inMemoryAssays } from "../assays/routes";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const customerRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

const CUSTOMER_READ_ROLES = new Set([
  "system_admin",
  "assay_admin",
  "intake_officer",
  "chemist",
  "lab_manager",
  "auditor",
]);
const CUSTOMER_WRITE_ROLES = new Set(["system_admin", "assay_admin", "intake_officer"]);

const inMemoryCustomers: CustomerRecord[] = [];

customerRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!CUSTOMER_READ_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Харилцагч харах эрхгүй байна." }, 403);
  }

  const records = c.env.DATABASE_URL
    ? await listCustomersFromDatabase(createDatabase(c.env.DATABASE_URL), user)
    : listCustomersFromMemory();

  return c.json({ ok: true, data: records });
});

customerRoutes.post("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!CUSTOMER_WRITE_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Харилцагч бүртгэх эрхгүй байна." }, 403);
  }

  const body = await c.req.json().catch(() => null);
  const input = normalizeCreateCustomerInput(body);
  const validationMessage = validateCreateCustomerInput(input);
  if (validationMessage) {
    return c.json({ ok: false, message: validationMessage }, 400);
  }

  const record = c.env.DATABASE_URL
    ? await createCustomerInDatabase(createDatabase(c.env.DATABASE_URL), user, input)
    : await createCustomerInMemory(input);

  return c.json({ ok: true, record }, 201);
});

async function listCustomersFromDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
): Promise<CustomerRecord[]> {
  const organizationFilter = user.role === "system_admin"
    ? sql``
    : sql`WHERE creator.organization_id = ${user.organizationId}`;

  const result = await db.execute<CustomerRow>(sql`
    SELECT
      c.id,
      c.type,
      c.display_name AS "displayName",
      c.registration_number_encrypted AS "registrationNumberMasked",
      c.email_encrypted AS "emailMasked",
      c.phone_encrypted AS "phoneMasked",
      count(ar.id)::int AS "totalAssays",
      COALESCE(sum(ar.received_gross_weight_grams), 0)::float AS "totalGrossWeightGrams",
      max(ar.received_at) AS "lastAssayAt",
      c.created_at AS "createdAt"
    FROM customers c
    INNER JOIN users creator ON c.created_by_user_id = creator.id
    LEFT JOIN assay_records ar ON ar.customer_id = c.id
    ${organizationFilter}
    GROUP BY
      c.id,
      c.type,
      c.display_name,
      c.registration_number_encrypted,
      c.email_encrypted,
      c.phone_encrypted,
      c.created_at
    ORDER BY c.created_at DESC
    LIMIT 200
  `);

  return readRows(result).map(mapCustomerRow);
}

async function createCustomerInDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
  input: CreateCustomerInput,
): Promise<CustomerRecord> {
  const id = crypto.randomUUID();
  const registrationHash = input.registrationNumber
    ? await sha256Base64Url(input.registrationNumber)
    : null;
  const phoneHash = input.phone ? await sha256Base64Url(input.phone) : null;

  const result = await db.execute<CustomerRow>(sql`
    INSERT INTO customers (
      id,
      type,
      display_name,
      registration_number_encrypted,
      registration_number_hash,
      phone_encrypted,
      phone_hash,
      email_encrypted,
      address_encrypted,
      created_by_user_id
    )
    VALUES (
      ${id},
      ${input.type},
      ${input.displayName.trim()},
      ${input.registrationNumber ? maskSensitiveValue(input.registrationNumber) : null},
      ${registrationHash},
      ${input.phone ? maskPhone(input.phone) : null},
      ${phoneHash},
      ${input.email ? maskEmail(input.email) : null},
      null,
      ${user.id}
    )
    RETURNING
      id,
      type,
      display_name AS "displayName",
      registration_number_encrypted AS "registrationNumberMasked",
      email_encrypted AS "emailMasked",
      phone_encrypted AS "phoneMasked",
      0::int AS "totalAssays",
      0::float AS "totalGrossWeightGrams",
      null::timestamp AS "lastAssayAt",
      created_at AS "createdAt"
  `);
  const [record] = readRows(result).map(mapCustomerRow);

  if (!record) {
    throw new Error("Failed to create customer.");
  }

  return record;
}

function listCustomersFromMemory(): CustomerRecord[] {
  const derivedCustomers = inMemoryAssays.map((assay) => ({
    id: `derived-${assay.id}`,
    type: "individual" as const,
    displayName: assay.customerName,
    registrationNumberMasked: null,
    emailMasked: null,
    phoneMasked: null,
    totalAssays: 1,
    totalGrossWeightGrams: assay.grossWeightGrams,
    lastAssayAt: assay.receivedAt,
    createdAt: assay.receivedAt ?? new Date(0).toISOString(),
  }));

  const allCustomers = [...inMemoryCustomers, ...derivedCustomers];
  return allCustomers.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

async function createCustomerInMemory(input: CreateCustomerInput): Promise<CustomerRecord> {
  const now = new Date().toISOString();
  const record: CustomerRecord = {
    id: crypto.randomUUID(),
    type: input.type,
    displayName: input.displayName.trim(),
    registrationNumberMasked: input.registrationNumber
      ? maskSensitiveValue(input.registrationNumber)
      : null,
    emailMasked: input.email ? maskEmail(input.email) : null,
    phoneMasked: input.phone ? maskPhone(input.phone) : null,
    totalAssays: 0,
    totalGrossWeightGrams: 0,
    lastAssayAt: null,
    createdAt: now,
  };

  inMemoryCustomers.unshift(record);
  return record;
}

function normalizeCreateCustomerInput(value: unknown): CreateCustomerInput {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};

  return {
    type: body.type === "legal_entity" ? "legal_entity" : "individual",
    displayName: readText(body.displayName),
    registrationNumber: readText(body.registrationNumber),
    email: readText(body.email),
    phone: readText(body.phone),
    address: readText(body.address),
  };
}

function validateCreateCustomerInput(input: CreateCustomerInput): string | null {
  if (input.displayName.length < 2) return "Харилцагчийн нэрийг зөв оруулна уу.";
  if (input.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email)) {
    return "Имэйл хаягийг зөв оруулна уу.";
  }
  if (input.phone && input.phone.length < 6) return "Утасны дугаарыг зөв оруулна уу.";

  return null;
}

function mapCustomerRow(row: CustomerRow): CustomerRecord {
  return {
    id: row.id,
    type: row.type,
    displayName: row.displayName,
    registrationNumberMasked: row.registrationNumberMasked,
    emailMasked: row.emailMasked,
    phoneMasked: row.phoneMasked,
    totalAssays: Number(row.totalAssays),
    totalGrossWeightGrams: Number(row.totalGrossWeightGrams),
    lastAssayAt: row.lastAssayAt instanceof Date
      ? row.lastAssayAt.toISOString()
      : row.lastAssayAt,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
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
  const digits = value.trim();
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

type CustomerRow = {
  id: string;
  type: CustomerType;
  displayName: string;
  registrationNumberMasked: string | null;
  emailMasked: string | null;
  phoneMasked: string | null;
  totalAssays: number | string;
  totalGrossWeightGrams: number | string;
  lastAssayAt: string | Date | null;
  createdAt: string | Date;
};

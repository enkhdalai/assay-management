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
  decryptField,
  encryptField,
  isValidFieldEncryptionKey,
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
    ? await listCustomersFromDatabase(createDatabase(c.env.DATABASE_URL), user, c.env.FIELD_ENCRYPTION_KEY)
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
    ? await createCustomerInDatabase(createDatabase(c.env.DATABASE_URL), user, input, c.env.FIELD_ENCRYPTION_KEY)
    : await createCustomerInMemory(input);

  return c.json({ ok: true, record }, 201);
});

async function listCustomersFromDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
  encryptionKey?: string,
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

  return Promise.all(readRows(result).map((row) => mapCustomerRow(row, encryptionKey)));
}

async function createCustomerInDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
  input: CreateCustomerInput,
  encryptionKey?: string,
): Promise<CustomerRecord> {
  const id = crypto.randomUUID();
  const registrationHash = input.registrationNumber
    ? await sha256Base64Url(input.registrationNumber)
    : null;
  const phoneHash = input.phone ? await sha256Base64Url(input.phone) : null;
  const [registrationNumberEncrypted, phoneEncrypted, emailEncrypted, addressEncrypted] = await Promise.all([
    input.registrationNumber ? protectSensitiveValue(input.registrationNumber, encryptionKey, maskSensitiveValue) : null,
    input.phone ? protectSensitiveValue(input.phone, encryptionKey, maskPhone) : null,
    input.email ? protectSensitiveValue(input.email, encryptionKey, maskEmail) : null,
    input.address ? protectSensitiveValue(input.address, encryptionKey, maskSensitiveValue) : null,
  ]);

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
      ${registrationNumberEncrypted},
      ${registrationHash},
      ${phoneEncrypted},
      ${phoneHash},
      ${emailEncrypted},
      ${addressEncrypted},
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
  const [record] = await Promise.all(readRows(result).map((row) => mapCustomerRow(row, encryptionKey)));

  if (!record) {
    throw new Error("Failed to create customer.");
  }

  if (input.type === "legal_entity" && input.organizationProfile) {
    const profile = input.organizationProfile;
    const [bankAccountEncrypted, contactPhoneEncrypted] = await Promise.all([
      profile.bankAccount ? protectSensitiveValue(profile.bankAccount, encryptionKey, maskSensitiveValue) : null,
      profile.contactPhone ? protectSensitiveValue(profile.contactPhone, encryptionKey, maskPhone) : null,
    ]);
    await db.execute(sql`
      INSERT INTO customer_organization_profiles (
        customer_id, deposit_name, branch_name, organization_kind, bank_name, bank_account_encrypted,
        province, district, bag, mine_initial_number, contact_name, contact_phone_encrypted, notes
      ) VALUES (
        ${record.id}, ${profile.depositName || null}, ${profile.branchName || null}, ${profile.organizationKind || null},
        ${profile.bankName || null}, ${bankAccountEncrypted},
        ${profile.province || null}, ${profile.district || null}, ${profile.bag || null}, ${profile.mineInitialNumber || null},
        ${profile.contactName || null}, ${contactPhoneEncrypted}, ${profile.notes || null}
      )
    `);
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
    organizationProfile: body.organizationProfile && typeof body.organizationProfile === "object"
      ? normalizeOrganizationProfile(body.organizationProfile as Record<string, unknown>)
      : undefined,
  };
}

function normalizeOrganizationProfile(value: Record<string, unknown>) {
  return {
    depositName: readText(value.depositName),
    branchName: readText(value.branchName),
    organizationKind: readText(value.organizationKind),
    bankName: readText(value.bankName),
    bankAccount: readText(value.bankAccount),
    province: readText(value.province),
    district: readText(value.district),
    bag: readText(value.bag),
    mineInitialNumber: readText(value.mineInitialNumber),
    contactName: readText(value.contactName),
    contactPhone: readText(value.contactPhone),
    notes: readText(value.notes),
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

async function mapCustomerRow(row: CustomerRow, encryptionKey?: string): Promise<CustomerRecord> {
  return {
    id: row.id,
    type: row.type,
    displayName: row.displayName,
    registrationNumberMasked: await maskStoredValue(row.registrationNumberMasked, encryptionKey, maskSensitiveValue),
    emailMasked: await maskStoredValue(row.emailMasked, encryptionKey, maskEmail),
    phoneMasked: await maskStoredValue(row.phoneMasked, encryptionKey, maskPhone),
    totalAssays: Number(row.totalAssays),
    totalGrossWeightGrams: Number(row.totalGrossWeightGrams),
    lastAssayAt: row.lastAssayAt instanceof Date
      ? row.lastAssayAt.toISOString()
      : row.lastAssayAt,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

async function protectSensitiveValue(
  value: string,
  encryptionKey: string | undefined,
  legacyMask: (value: string) => string,
): Promise<string> {
  return isValidFieldEncryptionKey(encryptionKey) ? encryptField(value, encryptionKey!) : legacyMask(value);
}

async function maskStoredValue(
  storedValue: string | null,
  encryptionKey: string | undefined,
  masker: (value: string) => string,
): Promise<string | null> {
  if (!storedValue) return null;
  if (!storedValue.startsWith("v1.")) return storedValue;
  if (!isValidFieldEncryptionKey(encryptionKey)) return "[secured]";
  try {
    return masker(await decryptField(storedValue, encryptionKey!));
  } catch {
    return "[secured]";
  }
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

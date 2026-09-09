import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  createDatabase,
  type AppDatabase,
} from "../../../../packages/db/src";
import type {
  CreateCustomerInput,
  CustomerRecord,
  CustomerDetail,
  CustomerType,
  OrganizationProfileInput,
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
  "lab_manager",
]);
const CUSTOMER_WRITE_ROLES = new Set(["system_admin", "assay_admin", "lab_manager", "intake_officer"]);

const inMemoryCustomers: CustomerRecord[] = [];
const customerOwners = new Map<string, string>();
const initialBullionNumbers = new Map<string, number>();
const inMemoryLegalEntityKeys = new Set<string>();
export const localCustomerInitialNumber = (id: string) => initialBullionNumbers.get(id) ?? 1;

export function localCustomerForCenter(id: string, user: AuthenticatedUser): CustomerRecord | undefined {
  return inMemoryCustomers.find((record) => record.id === id
    && (user.role === "system_admin" || customerOwners.get(id) === user.organizationId));
}

customerRoutes.get("/lookup", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!CUSTOMER_WRITE_ROLES.has(user.role)) return c.json({ ok: false }, 403);
  const data = c.env.DATABASE_URL
    ? await Promise.all(readRows(await createDatabase(c.env.DATABASE_URL).execute<CustomerLookupRow>(sql`
        SELECT c.id, c.display_name AS "displayName", c.type,
          c.registration_number_encrypted AS "registrationNumber", p.province, p.district,
          p.deposit_name AS origin
        FROM customers c
        LEFT JOIN customer_organization_profiles p ON p.customer_id = c.id
        WHERE (${user.role} = 'system_admin' OR c.assay_center_id = ${user.organizationId})
        ORDER BY c.display_name
      `)).map(async (customer) => ({
        ...customer,
        registrationNumber: await revealStoredValue(customer.registrationNumber, c.env.FIELD_ENCRYPTION_KEY),
        province: customer.province || null,
        district: customer.district || null,
        origin: customer.origin || null,
      })))
    : inMemoryCustomers.filter((record) => localCustomerForCenter(record.id, user))
      .map(({ id, displayName, type, registrationNumberMasked, province, district }) => ({ id, displayName, type,
        registrationNumber: registrationNumberMasked, province: province || null, district: district || null, origin: null }));
  return c.json({ ok: true, data });
});

customerRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!CUSTOMER_READ_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Харилцагч харах эрхгүй байна." }, 403);
  }

  const records = c.env.DATABASE_URL
    ? await listCustomersFromDatabase(createDatabase(c.env.DATABASE_URL), user, c.env.FIELD_ENCRYPTION_KEY)
    : listCustomersFromMemory().filter((record) => user.role === "system_admin" || customerOwners.get(record.id) === user.organizationId);

  return c.json({ ok: true, data: records });
});

customerRoutes.get("/:id", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!CUSTOMER_READ_ROLES.has(user.role)) return c.json({ ok: false, message: "Харилцагч харах эрхгүй байна." }, 403);
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "Харилцагчийн дэлгэрэнгүй мэдээлэлд өгөгдлийн сан шаардлагатай." }, 503);
  const detail = await getCustomerDetail(createDatabase(c.env.DATABASE_URL), user, id, c.env.FIELD_ENCRYPTION_KEY);
  return detail ? c.json({ ok: true, data: detail }) : c.json({ ok: false }, 404);
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

  if (record === "duplicate") {
    return c.json({ ok: false, message: "Энэ нэр болон регистрийн дугаартай байгууллага бүртгэлтэй байна." }, 409);
  }

  if (!c.env.DATABASE_URL) {
    customerOwners.set(record.id, user.organizationId);
    const initial = input.organizationProfile?.mineInitialNumber ?? "";
    initialBullionNumbers.set(record.id, /^[0-9]{1,12}$/.test(initial) ? Math.max(1, Number(initial)) : 1);
  }

  return c.json({ ok: true, record }, 201);
});

customerRoutes.patch("/:id", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!CUSTOMER_READ_ROLES.has(user.role)) return c.json({ ok: false, message: "Харилцагч засах эрхгүй байна." }, 403);
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ ok: false }, 400);
  const input = normalizeCreateCustomerInput(await c.req.json().catch(() => null));
  const validationMessage = validateCreateCustomerInput(input);
  if (validationMessage) return c.json({ ok: false, message: validationMessage }, 400);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "Харилцагч засахад өгөгдлийн сан шаардлагатай." }, 503);

  const db = createDatabase(c.env.DATABASE_URL);
  const registrationHash = input.registrationNumber ? await sha256Base64Url(input.registrationNumber) : null;
  if (await hasDuplicateLegalEntity(db, user, input, registrationHash, id)) {
    return c.json({ ok: false, message: "Энэ нэр болон регистрийн дугаартай байгууллага бүртгэлтэй байна." }, 409);
  }
  const phoneHash = input.phone ? await sha256Base64Url(input.phone) : null;
  const [registrationNumberEncrypted, phoneEncrypted, emailEncrypted, addressEncrypted] = await Promise.all([
    input.registrationNumber ? protectSensitiveValue(input.registrationNumber, c.env.FIELD_ENCRYPTION_KEY, maskSensitiveValue) : null,
    input.phone ? protectSensitiveValue(input.phone, c.env.FIELD_ENCRYPTION_KEY, maskPhone) : null,
    input.email ? protectSensitiveValue(input.email, c.env.FIELD_ENCRYPTION_KEY, maskEmail) : null,
    input.address ? protectSensitiveValue(input.address, c.env.FIELD_ENCRYPTION_KEY, maskSensitiveValue) : null,
  ]);
  const profile: OrganizationProfileInput = input.organizationProfile ?? { province: input.province, district: input.district };
  const [bankAccountEncrypted, contactPhoneEncrypted] = await Promise.all([
    profile.bankAccount ? protectSensitiveValue(profile.bankAccount, c.env.FIELD_ENCRYPTION_KEY, maskSensitiveValue) : null,
    profile.contactPhone ? protectSensitiveValue(profile.contactPhone, c.env.FIELD_ENCRYPTION_KEY, maskPhone) : null,
  ]);
  const updated = readRows(await db.execute<{ id: string }>(sql`
    UPDATE customers c SET type = ${input.type}, display_name = ${input.displayName},
      registration_number_encrypted = ${registrationNumberEncrypted}, registration_number_hash = ${registrationHash},
      phone_encrypted = ${phoneEncrypted}, phone_hash = ${phoneHash}, email_encrypted = ${emailEncrypted},
      address_encrypted = ${addressEncrypted}, updated_at = now()
    WHERE c.id = ${id}::uuid
      AND (${user.role} = 'system_admin' OR c.assay_center_id = ${user.organizationId})
    RETURNING c.id
  `))[0];
  if (!updated) return c.json({ ok: false }, 404);
  await db.execute(sql`
    INSERT INTO customer_organization_profiles (
      customer_id, deposit_name, branch_name, organization_kind, bank_name, bank_account_encrypted,
      province, district, bag, mine_initial_number, contact_name, contact_phone_encrypted, notes, updated_at
    ) VALUES (
      ${id}::uuid, ${profile.depositName || null}, ${profile.branchName || null}, ${profile.organizationKind || null},
      ${profile.bankName || null}, ${bankAccountEncrypted}, ${profile.province || null}, ${profile.district || null},
      ${profile.bag || null}, ${profile.mineInitialNumber || null}, ${profile.contactName || null}, ${contactPhoneEncrypted}, ${profile.notes || null}, now()
    ) ON CONFLICT (customer_id) DO UPDATE SET
      deposit_name = EXCLUDED.deposit_name, branch_name = EXCLUDED.branch_name, organization_kind = EXCLUDED.organization_kind,
      bank_name = EXCLUDED.bank_name, bank_account_encrypted = EXCLUDED.bank_account_encrypted,
      province = EXCLUDED.province, district = EXCLUDED.district, bag = EXCLUDED.bag,
      mine_initial_number = EXCLUDED.mine_initial_number, contact_name = EXCLUDED.contact_name,
      contact_phone_encrypted = EXCLUDED.contact_phone_encrypted, notes = EXCLUDED.notes, updated_at = now()
  `);
  const detail = await getCustomerDetail(db, user, id, c.env.FIELD_ENCRYPTION_KEY);
  return c.json({ ok: true, data: detail });
});

async function listCustomersFromDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
  encryptionKey?: string,
): Promise<CustomerRecord[]> {
  const organizationFilter = user.role === "system_admin"
    ? sql``
    : sql`WHERE c.assay_center_id = ${user.organizationId}`;

  const result = await db.execute<CustomerRow>(sql`
    SELECT
      c.id,
      c.type,
      c.display_name AS "displayName",
      p.province,
      p.district,
      c.registration_number_encrypted AS "registrationNumberMasked",
      c.email_encrypted AS "emailMasked",
      c.phone_encrypted AS "phoneMasked",
      c.assay_center_id AS "assayCenterId",
      organization.name AS "assayCenterName",
      count(ar.id)::int AS "totalAssays",
      COALESCE(sum(ar.received_gross_weight_grams), 0)::float AS "totalGrossWeightGrams",
      max(ar.received_at) AS "lastAssayAt",
      c.created_at AS "createdAt"
    FROM customers c
    INNER JOIN organizations organization ON organization.id = c.assay_center_id
    LEFT JOIN customer_organization_profiles p ON p.customer_id = c.id
    LEFT JOIN assay_records ar ON ar.customer_id = c.id
    ${organizationFilter}
    GROUP BY
      c.id,
      c.type,
      c.display_name,
      p.province,
      p.district,
      c.registration_number_encrypted,
      c.email_encrypted,
      c.phone_encrypted,
      c.assay_center_id,
      organization.name,
      c.created_at
    ORDER BY c.created_at DESC
    LIMIT 200
  `);

  return Promise.all(readRows(result).map((row) => mapCustomerRow(row, encryptionKey)));
}

async function getCustomerDetail(db: AppDatabase, user: AuthenticatedUser, id: string, encryptionKey?: string): Promise<CustomerDetail | null> {
  const row = readRows(await db.execute<CustomerDetailRow>(sql`
    SELECT c.id, c.type, c.display_name AS "displayName", c.registration_number_encrypted AS "registrationNumber",
      c.email_encrypted AS email, c.phone_encrypted AS phone, c.address_encrypted AS address,
      p.deposit_name AS "depositName", p.branch_name AS "branchName", p.organization_kind AS "organizationKind",
      p.bank_name AS "bankName", p.bank_account_encrypted AS "bankAccount", p.province, p.district, p.bag,
      p.mine_initial_number AS "mineInitialNumber", p.contact_name AS "contactName",
      p.contact_phone_encrypted AS "contactPhone", p.notes,
      count(ar.id)::int AS "totalAssays", COALESCE(sum(ar.received_gross_weight_grams), 0)::float AS "totalGrossWeightGrams",
      max(ar.received_at) AS "lastAssayAt", c.created_at AS "createdAt"
    FROM customers c
    LEFT JOIN customer_organization_profiles p ON p.customer_id = c.id
    LEFT JOIN assay_records ar ON ar.customer_id = c.id
    WHERE c.id = ${id}::uuid AND (${user.role} = 'system_admin' OR c.assay_center_id = ${user.organizationId})
    GROUP BY c.id, p.customer_id
  `))[0];
  if (!row) return null;
  const [registrationNumber, email, phone, address, bankAccount, contactPhone] = await Promise.all([
    revealStoredValue(row.registrationNumber, encryptionKey), revealStoredValue(row.email, encryptionKey),
    revealStoredValue(row.phone, encryptionKey), revealStoredValue(row.address, encryptionKey),
    revealStoredValue(row.bankAccount, encryptionKey), revealStoredValue(row.contactPhone, encryptionKey),
  ]);
  return {
    id: row.id, type: row.type, displayName: row.displayName, registrationNumber, email, phone, address,
    registrationNumberMasked: registrationNumber ? maskSensitiveValue(registrationNumber) : null,
    emailMasked: email ? maskEmail(email) : null, phoneMasked: phone ? maskPhone(phone) : null,
    province: row.province || undefined, district: row.district || undefined,
    totalAssays: Number(row.totalAssays), totalGrossWeightGrams: Number(row.totalGrossWeightGrams),
    lastAssayAt: row.lastAssayAt instanceof Date ? row.lastAssayAt.toISOString() : row.lastAssayAt,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    organizationProfile: {
      depositName: row.depositName || undefined, branchName: row.branchName || undefined, organizationKind: row.organizationKind || undefined,
      bankName: row.bankName || undefined, bankAccount: bankAccount || undefined, province: row.province || undefined,
      district: row.district || undefined, bag: row.bag || undefined, mineInitialNumber: row.mineInitialNumber || undefined,
      contactName: row.contactName || undefined, contactPhone: contactPhone || undefined, notes: row.notes || undefined,
    },
  };
}

async function createCustomerInDatabase(
  db: AppDatabase,
  user: AuthenticatedUser,
  input: CreateCustomerInput,
  encryptionKey?: string,
): Promise<CustomerRecord | "duplicate"> {
  const id = crypto.randomUUID();
  const registrationHash = input.registrationNumber
    ? await sha256Base64Url(input.registrationNumber)
    : null;
  const phoneHash = input.phone ? await sha256Base64Url(input.phone) : null;
  if (await hasDuplicateLegalEntity(db, user, input, registrationHash)) return "duplicate";
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
      assay_center_id,
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
      ${user.organizationId},
      ${user.id}
    )
    ON CONFLICT DO NOTHING
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

  if (!record) return "duplicate";

  const profile: OrganizationProfileInput | undefined = input.type === "legal_entity"
    ? input.organizationProfile
    : input.province || input.district ? { province: input.province, district: input.district } : undefined;
  if (profile) {
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

  return { ...record, province: profile?.province, district: profile?.district };
}

async function hasDuplicateLegalEntity(
  db: AppDatabase,
  user: AuthenticatedUser,
  input: CreateCustomerInput,
  registrationHash: string | null,
  excludeCustomerId?: string,
): Promise<boolean> {
  if (input.type !== "legal_entity" || !registrationHash) return false;
  const duplicate = readRows(await db.execute<{ id: string }>(sql`
    SELECT c.id
    FROM customers c
    WHERE c.assay_center_id = ${user.organizationId}::uuid
      AND c.type = 'legal_entity'
      AND c.registration_number_hash = ${registrationHash}
      AND lower(c.display_name) = lower(${input.displayName.trim()})
      ${excludeCustomerId ? sql`AND c.id <> ${excludeCustomerId}::uuid` : sql``}
    LIMIT 1
  `))[0];
  return !!duplicate;
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

async function createCustomerInMemory(input: CreateCustomerInput): Promise<CustomerRecord | "duplicate"> {
  const legalEntityKey = input.type === "legal_entity" ? `${input.displayName.trim().toLocaleLowerCase("mn")}:${input.registrationNumber?.trim() ?? ""}` : null;
  if (legalEntityKey && inMemoryLegalEntityKeys.has(legalEntityKey)) return "duplicate";
  const now = new Date().toISOString();
  const record: CustomerRecord = {
    id: crypto.randomUUID(),
    type: input.type,
    displayName: input.displayName.trim(),
    province: input.type === "individual" ? input.province : input.organizationProfile?.province,
    district: input.type === "individual" ? input.district : input.organizationProfile?.district,
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
  if (legalEntityKey) inMemoryLegalEntityKeys.add(legalEntityKey);
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
    province: readText(body.province),
    district: readText(body.district),
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
  if ((input.province?.length ?? 0) > 120 || (input.district?.length ?? 0) > 120) return "Байршлын мэдээлэл 120 тэмдэгтээс хэтрэхгүй байна.";
  if (input.displayName.length < 2) return "Харилцагчийн нэрийг зөв оруулна уу.";
  if (input.type === "legal_entity" && !input.registrationNumber) return "Байгууллагын регистрийн дугаарыг оруулна уу.";
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
    province: row.province || undefined,
    district: row.district || undefined,
    registrationNumberMasked: await maskStoredValue(row.registrationNumberMasked, encryptionKey, maskSensitiveValue),
    emailMasked: await maskStoredValue(row.emailMasked, encryptionKey, maskEmail),
    phoneMasked: await maskStoredValue(row.phoneMasked, encryptionKey, maskPhone),
    assayCenterId: row.assayCenterId || undefined,
    assayCenterName: row.assayCenterName || undefined,
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

async function revealStoredValue(storedValue: string | null, encryptionKey?: string): Promise<string | null> {
  if (!storedValue) return null;
  if (!storedValue.startsWith("v1.")) return storedValue;
  if (!isValidFieldEncryptionKey(encryptionKey)) return null;
  try { return await decryptField(storedValue, encryptionKey!); }
  catch { return null; }
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

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function readRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

type CustomerRow = {
  province?: string | null;
  district?: string | null;
  id: string;
  type: CustomerType;
  displayName: string;
  registrationNumberMasked: string | null;
  emailMasked: string | null;
  phoneMasked: string | null;
  assayCenterId?: string | null;
  assayCenterName?: string | null;
  totalAssays: number | string;
  totalGrossWeightGrams: number | string;
  lastAssayAt: string | Date | null;
  createdAt: string | Date;
};

type CustomerLookupRow = {
  id: string;
  type: CustomerType;
  displayName: string;
  registrationNumber: string | null;
  province: string | null;
  district: string | null;
  origin: string | null;
};

type CustomerDetailRow = {
  id: string;
  type: CustomerType;
  displayName: string;
  registrationNumber: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  depositName: string | null;
  branchName: string | null;
  organizationKind: string | null;
  bankName: string | null;
  bankAccount: string | null;
  province: string | null;
  district: string | null;
  bag: string | null;
  mineInitialNumber: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  totalAssays: number | string;
  totalGrossWeightGrams: number | string;
  lastAssayAt: string | Date | null;
  createdAt: string | Date;
};

import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  createDatabase,
  type AppDatabase,
} from "../../../../packages/db/src";
import type {
  BankDirectoryRecord,
  CreateBankInput,
} from "../../../../packages/shared/src";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const bankRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

const BANK_READ_ROLES = new Set([
  "system_admin",
  "assay_admin",
  "intake_officer",
  "chemist",
  "lab_manager",
  "auditor",
]);
const BANK_WRITE_ROLES = new Set(["system_admin", "assay_admin"]);
const inMemoryBanks: BankDirectoryRecord[] = [];

bankRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!BANK_READ_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Банкны лавлах харах эрхгүй байна." }, 403);
  }

  const data = c.env.DATABASE_URL
    ? await listBanksFromDatabase(createDatabase(c.env.DATABASE_URL))
    : inMemoryBanks;
  return c.json({ ok: true, data });
});

bankRoutes.post("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!BANK_WRITE_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Банк бүртгэх эрхгүй байна." }, 403);
  }

  const input = normalizeBank(await c.req.json().catch(() => null));
  const validationMessage = validateBank(input);
  if (validationMessage) return c.json({ ok: false, message: validationMessage }, 400);

  try {
    const record = c.env.DATABASE_URL
      ? await createBankInDatabase(createDatabase(c.env.DATABASE_URL), input)
      : createBankInMemory(input);
    return c.json({ ok: true, record }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return c.json({ ok: false, message: message === "duplicate" ? "Банкны код эсвэл нэр давхардсан байна." : "Банк бүртгэх боломжгүй байна." }, 409);
  }
});

bankRoutes.patch("/:id/status", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!BANK_WRITE_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Банкны төлөв өөрчлөх эрхгүй байна." }, 403);
  }

  const status = readText((await c.req.json().catch(() => null))?.status);
  if (status !== "active" && status !== "suspended") {
    return c.json({ ok: false, message: "Банкны төлөв буруу байна." }, 400);
  }

  const record = c.env.DATABASE_URL
    ? await updateBankStatusInDatabase(createDatabase(c.env.DATABASE_URL), c.req.param("id"), status)
    : updateBankStatusInMemory(c.req.param("id"), status);
  if (!record) return c.json({ ok: false, message: "Банк олдсонгүй." }, 404);
  return c.json({ ok: true, record });
});

async function listBanksFromDatabase(db: AppDatabase): Promise<BankDirectoryRecord[]> {
  const result = await db.execute<BankRow>(sql`
    SELECT
      o.id, o.type, o.status, o.code, o.name,
      count(ba.id)::int AS "allocationCount",
      COALESCE(sum(ba.allocated_gross_weight_grams), 0)::float AS "allocatedGrams",
      o.created_at AS "createdAt"
    FROM organizations o
    LEFT JOIN bank_allocations ba ON ba.bank_organization_id = o.id
    WHERE o.type IN ('commercial_bank', 'bank_of_mongolia')
    GROUP BY o.id, o.type, o.status, o.code, o.name, o.created_at
    ORDER BY CASE WHEN o.type = 'bank_of_mongolia' THEN 0 ELSE 1 END, o.name ASC
  `);
  return readRows(result).map(mapBankRow);
}

async function createBankInDatabase(db: AppDatabase, input: CreateBankInput): Promise<BankDirectoryRecord> {
  const existing = readRows(await db.execute<{ id: string }>(sql`
    SELECT id FROM organizations
    WHERE code = ${input.code} OR lower(name) = lower(${input.name})
    LIMIT 1
  `));
  if (existing.length > 0) throw new Error("duplicate");

  if (input.type === "bank_of_mongolia") {
    const bom = readRows(await db.execute<{ id: string }>(sql`
      SELECT id FROM organizations WHERE type = 'bank_of_mongolia' LIMIT 1
    `));
    if (bom.length > 0) throw new Error("duplicate");
  }

  const result = await db.execute<BankRow>(sql`
    INSERT INTO organizations (id, type, status, code, name)
    VALUES (${crypto.randomUUID()}, ${input.type}, 'active', ${input.code}, ${input.name})
    RETURNING
      id, type, status, code, name,
      0::int AS "allocationCount",
      0::float AS "allocatedGrams",
      created_at AS "createdAt"
  `);
  const [record] = readRows(result).map(mapBankRow);
  if (!record) throw new Error("create_failed");
  return record;
}

async function updateBankStatusInDatabase(
  db: AppDatabase,
  id: string,
  status: "active" | "suspended",
): Promise<BankDirectoryRecord | null> {
  const result = await db.execute<BankRow>(sql`
    UPDATE organizations
    SET status = ${status}, updated_at = now()
    WHERE id = ${id} AND type IN ('commercial_bank', 'bank_of_mongolia')
    RETURNING
      id, type, status, code, name,
      0::int AS "allocationCount",
      0::float AS "allocatedGrams",
      created_at AS "createdAt"
  `);
  const [record] = readRows(result).map(mapBankRow);
  return record ?? null;
}

function createBankInMemory(input: CreateBankInput): BankDirectoryRecord {
  const record: BankDirectoryRecord = {
    id: crypto.randomUUID(),
    type: input.type,
    status: "active",
    code: input.code,
    name: input.name,
    allocationCount: 0,
    allocatedGrams: 0,
    createdAt: new Date().toISOString(),
  };
  inMemoryBanks.push(record);
  return record;
}

function updateBankStatusInMemory(
  id: string,
  status: "active" | "suspended",
): BankDirectoryRecord | null {
  const record = inMemoryBanks.find((bank) => bank.id === id);
  if (!record) return null;
  record.status = status;
  return record;
}

function normalizeBank(value: unknown): CreateBankInput {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    type: body.type === "bank_of_mongolia" ? "bank_of_mongolia" : "commercial_bank",
    code: readText(body.code).toUpperCase(),
    name: readText(body.name),
  };
}

function validateBank(input: CreateBankInput): string | null {
  if (!/^[A-Z0-9_-]{2,32}$/.test(input.code)) return "Банкны код 2-32 латин үсэг, тоо байна.";
  if (input.name.length < 2 || input.name.length > 255) return "Банкны нэрийг зөв оруулна уу.";
  return null;
}

function mapBankRow(row: BankRow): BankDirectoryRecord {
  return {
    ...row,
    type: row.type as BankDirectoryRecord["type"],
    status: row.status as BankDirectoryRecord["status"],
    allocationCount: Number(row.allocationCount),
    allocatedGrams: Number(row.allocatedGrams),
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
  };
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

type BankRow = {
  id: string;
  type: string;
  status: string;
  code: string;
  name: string;
  allocationCount: number | string;
  allocatedGrams: number | string;
  createdAt: string | Date;
};

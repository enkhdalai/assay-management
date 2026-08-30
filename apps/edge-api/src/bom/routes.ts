import { sql } from "drizzle-orm";
import { Hono } from "hono";

import {
  createDatabase,
  type AppDatabase,
} from "../../../../packages/db/src";
import {
  hmacSha256Base64Url,
  sha256Base64Url,
  timingSafeEqual,
} from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { getTrustedClientIp } from "../security/middleware";

const MAX_SIGNATURE_AGE_MS = 5 * 60 * 1000;
const BOM_READ_SCOPE = "bom:assays:read";
const BOM_CONFIRM_SCOPE = "bom:confirmations:write";

export const bomRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

/**
 * This is a server-to-server boundary. It intentionally does not share the
 * browser session cookie authentication used by the internal admin website.
 */
bomRoutes.get("/assays", async (c) => {
  const auth = await authorizeBomRequest(c.req.raw, c.env, BOM_READ_SCOPE);
  if (auth instanceof Response) return auth;

  const db = createDatabase(c.env.DATABASE_URL!);
  try {
    const records = await listApprovedAssays(db);
    await logBomApiRequest(db, auth, 200);
    return c.json({ ok: true, data: records, requestId: auth.requestId });
  } catch {
    await logBomApiRequest(db, auth, 500, "Unable to retrieve approved assays.");
    return c.json({ ok: false, message: "Системийн алдаа гарлаа.", requestId: auth.requestId }, 500);
  }
});

bomRoutes.get("/assays/:publicId", async (c) => {
  const auth = await authorizeBomRequest(c.req.raw, c.env, BOM_READ_SCOPE);
  if (auth instanceof Response) return auth;

  const db = createDatabase(c.env.DATABASE_URL!);
  try {
    const record = await findApprovedAssay(db, c.req.param("publicId"));
    await logBomApiRequest(db, auth, record ? 200 : 404);
    if (!record) {
      return c.json({ ok: false, message: "Баталгаажсан сорьц олдсонгүй.", requestId: auth.requestId }, 404);
    }
    return c.json({ ok: true, data: record, requestId: auth.requestId });
  } catch {
    await logBomApiRequest(db, auth, 500, "Unable to retrieve approved assay.");
    return c.json({ ok: false, message: "Системийн алдаа гарлаа.", requestId: auth.requestId }, 500);
  }
});

bomRoutes.post("/assays/:publicId/confirmations", async (c) => {
  const auth = await authorizeBomRequest(c.req.raw, c.env, BOM_CONFIRM_SCOPE);
  if (auth instanceof Response) return auth;

  const body = await c.req.json().catch(() => null);
  const input = normalizeConfirmation(body);
  const validationMessage = validateConfirmation(input);
  if (validationMessage) {
    await logBomApiRequest(createDatabase(c.env.DATABASE_URL!), auth, 400, validationMessage);
    return c.json({ ok: false, message: validationMessage, requestId: auth.requestId }, 400);
  }

  const db = createDatabase(c.env.DATABASE_URL!);
  try {
    const confirmation = await createConfirmation(db, c.req.param("publicId"), input, auth);
    if (confirmation === "not_found") {
      await logBomApiRequest(db, auth, 404, "No approved assay was found.");
      return c.json({ ok: false, message: "Баталгаажсан сорьц олдсонгүй.", requestId: auth.requestId }, 404);
    }
    if (confirmation === "conflict") {
      await logBomApiRequest(db, auth, 409, "Confirmation number and version already exist.");
      return c.json({ ok: false, message: "Энэ баталгаажуулалт аль хэдийн бүртгэгдсэн байна.", requestId: auth.requestId }, 409);
    }

    await logBomApiRequest(db, auth, 201);
    return c.json({ ok: true, data: confirmation, requestId: auth.requestId }, 201);
  } catch {
    await logBomApiRequest(db, auth, 500, "Unable to record confirmation.");
    return c.json({ ok: false, message: "Системийн алдаа гарлаа.", requestId: auth.requestId }, 500);
  }
});

type BomAuthorization = {
  apiClientId: string;
  clientId: string;
  requestId: string;
  method: string;
  path: string;
  idempotencyKey: string | null;
  requestHash: string;
  ipHash: string | null;
  userAgent: string | null;
};

async function authorizeBomRequest(
  request: Request,
  env: EdgeApiEnv,
  requiredScope: string,
): Promise<BomAuthorization | Response> {
  if (!env.DATABASE_URL || !env.BOM_API_CLIENT_ID || !env.BOM_API_SIGNING_SECRET) {
    return bomError(503, "Монголбанкны API хараахан тохируулагдаагүй байна.");
  }

  const clientId = request.headers.get("x-assay-client-id")?.trim() ?? "";
  const timestamp = request.headers.get("x-assay-timestamp")?.trim() ?? "";
  const nonce = request.headers.get("x-assay-nonce")?.trim() ?? "";
  const requestId = request.headers.get("x-assay-request-id")?.trim() ?? "";
  const signature = request.headers.get("x-assay-signature")?.trim().replace(/^v1=/, "") ?? "";
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? null;

  if (!clientId || !timestamp || !nonce || !requestId || !signature) {
    return bomError(401, "API таних мэдээлэл дутуу байна.");
  }
  if (!isSafeHeaderValue(nonce, 16, 128) || !isSafeHeaderValue(requestId, 16, 128)) {
    return bomError(400, "API хүсэлтийн дугаар буруу байна.");
  }
  if (requiredScope === BOM_CONFIRM_SCOPE && !isSafeHeaderValue(idempotencyKey ?? "", 16, 128)) {
    return bomError(400, "Idempotency түлхүүр буруу байна.");
  }
  if (!isFreshTimestamp(timestamp)) {
    return bomError(401, "API гарын үсгийн хугацаа дууссан байна.");
  }
  if (clientId !== env.BOM_API_CLIENT_ID) {
    return bomError(401, "API client зөвшөөрөгдөөгүй байна.");
  }

  const body = await request.clone().text();
  const bodyHash = await sha256Base64Url(body);
  const canonical = [
    "v1",
    clientId,
    timestamp,
    nonce,
    request.method.toUpperCase(),
    new URL(request.url).pathname,
    requestId,
    bodyHash,
  ].join("\n");
  const expectedSignature = await hmacSha256Base64Url(env.BOM_API_SIGNING_SECRET, canonical);
  if (!timingSafeEqual(signature, expectedSignature)) {
    return bomError(401, "API гарын үсэг буруу байна.");
  }

  const clientIp = getTrustedClientIp(request, env.AUTH_DEV_LOGIN_ENABLED === "true");
  const db = createDatabase(env.DATABASE_URL);
  const client = await findApiClient(db, clientId);
  if (!client || !client.scopes.includes(requiredScope)) {
    return bomError(403, "API эрх хүрэлцэхгүй байна.");
  }
  if (client.allowedIpCidrs.length > 0 && (!clientIp || !client.allowedIpCidrs.some((range) => ipMatchesRange(clientIp, range)))) {
    return bomError(403, "API IP хаяг зөвшөөрөгдөөгүй байна.");
  }

  const ipHash = clientIp ? await sha256Base64Url(clientIp) : null;
  return {
    apiClientId: client.id,
    clientId,
    requestId,
    method: request.method.toUpperCase(),
    path: new URL(request.url).pathname,
    idempotencyKey,
    requestHash: bodyHash,
    ipHash,
    userAgent: request.headers.get("user-agent"),
  };
}

async function findApiClient(db: AppDatabase, clientId: string): Promise<ApiClientRow | null> {
  const [row] = readRows(await db.execute<ApiClientRow>(sql`
    SELECT ac.id, ac.scopes, ac.allowed_ip_cidrs AS "allowedIpCidrs"
    FROM api_clients ac
    INNER JOIN organizations o ON o.id = ac.organization_id
    WHERE ac.client_id = ${clientId}
      AND ac.status = 'active'
      AND o.type = 'bank_of_mongolia'
      AND o.status = 'active'
      AND (ac.expires_at IS NULL OR ac.expires_at > now())
    LIMIT 1
  `));
  return row ?? null;
}

async function listApprovedAssays(db: AppDatabase): Promise<BomAssayRecord[]> {
  const result = await db.execute<BomAssayRow>(sql`
    SELECT
      ar.public_id AS "recordId",
      c.display_name AS "customerName",
      ar.metal,
      ar.received_gross_weight_grams::float AS "grossWeightGrams",
      rr.purity_percent::float AS "purityPercent",
      rr.fine_weight_grams::float AS "fineWeightGrams",
      rr.method_name AS "methodName",
      rr.instrument_name AS "instrumentName",
      rr.approved_at AS "approvedAt",
      COALESCE(
        json_agg(
          json_build_object(
            'bankName', bank.name,
            'allocatedGrossWeightGrams', ba.allocated_gross_weight_grams::float
          ) ORDER BY bank.name
        ) FILTER (WHERE ba.id IS NOT NULL),
        '[]'::json
      ) AS allocations
    FROM assay_records ar
    INNER JOIN customers c ON c.id = ar.customer_id
    INNER JOIN LATERAL (
      SELECT *
      FROM assay_result_revisions
      WHERE assay_record_id = ar.id AND status = 'approved'
      ORDER BY revision_no DESC
      LIMIT 1
    ) rr ON true
    LEFT JOIN bank_allocations ba ON ba.assay_record_id = ar.id
    LEFT JOIN organizations bank ON bank.id = ba.bank_organization_id
    WHERE ar.status IN ('approved', 'bom_submitted')
    GROUP BY ar.id, ar.public_id, c.display_name, ar.metal,
      ar.received_gross_weight_grams, rr.purity_percent, rr.fine_weight_grams,
      rr.method_name, rr.instrument_name, rr.approved_at
    ORDER BY rr.approved_at ASC
    LIMIT 100
  `);
  return readRows(result).map(mapBomAssayRow);
}

async function findApprovedAssay(db: AppDatabase, publicId: string): Promise<BomAssayRecord | null> {
  const records = await listApprovedAssaysById(db, publicId);
  return records[0] ?? null;
}

async function listApprovedAssaysById(db: AppDatabase, publicId: string): Promise<BomAssayRecord[]> {
  const result = await db.execute<BomAssayRow>(sql`
    SELECT
      ar.public_id AS "recordId",
      c.display_name AS "customerName",
      ar.metal,
      ar.received_gross_weight_grams::float AS "grossWeightGrams",
      rr.purity_percent::float AS "purityPercent",
      rr.fine_weight_grams::float AS "fineWeightGrams",
      rr.method_name AS "methodName",
      rr.instrument_name AS "instrumentName",
      rr.approved_at AS "approvedAt",
      COALESCE(
        json_agg(
          json_build_object(
            'bankName', bank.name,
            'allocatedGrossWeightGrams', ba.allocated_gross_weight_grams::float
          ) ORDER BY bank.name
        ) FILTER (WHERE ba.id IS NOT NULL),
        '[]'::json
      ) AS allocations
    FROM assay_records ar
    INNER JOIN customers c ON c.id = ar.customer_id
    INNER JOIN LATERAL (
      SELECT *
      FROM assay_result_revisions
      WHERE assay_record_id = ar.id AND status = 'approved'
      ORDER BY revision_no DESC
      LIMIT 1
    ) rr ON true
    LEFT JOIN bank_allocations ba ON ba.assay_record_id = ar.id
    LEFT JOIN organizations bank ON bank.id = ba.bank_organization_id
    WHERE ar.public_id = ${publicId}
      AND ar.status IN ('approved', 'bom_submitted')
    GROUP BY ar.id, ar.public_id, c.display_name, ar.metal,
      ar.received_gross_weight_grams, rr.purity_percent, rr.fine_weight_grams,
      rr.method_name, rr.instrument_name, rr.approved_at
    LIMIT 1
  `);
  return readRows(result).map(mapBomAssayRow);
}

async function createConfirmation(
  db: AppDatabase,
  publicId: string,
  input: BomConfirmationInput,
  auth: BomAuthorization,
): Promise<BomConfirmationRecord | "not_found" | "conflict"> {
  const existing = readRows(await db.execute<{ id: string }>(sql`
    SELECT id FROM bom_confirmations
    WHERE confirmation_no = ${input.confirmationNo} AND version_no = ${input.versionNo}
    LIMIT 1
  `));
  if (existing.length > 0) return "conflict";

  const now = new Date();
  const matching = readRows(await db.execute<ConfirmationSourceRow>(sql`
    SELECT ar.id AS "assayRecordId", rr.id AS "resultRevisionId",
      rr.fine_weight_grams::float AS "fineWeightGrams"
    FROM assay_records ar
    INNER JOIN LATERAL (
      SELECT * FROM assay_result_revisions
      WHERE assay_record_id = ar.id AND status = 'approved'
      ORDER BY revision_no DESC LIMIT 1
    ) rr ON true
    WHERE ar.public_id = ${publicId} AND ar.status IN ('approved', 'bom_submitted')
    LIMIT 1
  `));
  const source = matching[0];
  if (!source) return "not_found";

  const calculatedGrossAmountMnt = roundMoney(source.fineWeightGrams * input.pricePerGramMnt);
  const netPayableAmountMnt = roundMoney(calculatedGrossAmountMnt - input.deductionAmountMnt);
  const calculationPayloadHash = await sha256Base64Url(JSON.stringify({
    confirmationNo: input.confirmationNo,
    versionNo: input.versionNo,
    pricePerGramMnt: input.pricePerGramMnt,
    deductionAmountMnt: input.deductionAmountMnt,
    calculatedGrossAmountMnt,
    netPayableAmountMnt,
    fineWeightGrams: source.fineWeightGrams,
  }));
  const previousHash = await getLatestAuditHash(db);
  const entryHash = await sha256Base64Url(JSON.stringify({
    action: "bom_confirmation.recorded",
    entityType: "bom_confirmations",
    entityId: input.confirmationNo,
    requestId: auth.requestId,
    calculationPayloadHash,
    previousHash,
    createdAt: now.toISOString(),
  }));
  const confirmationId = crypto.randomUUID();

  await db.execute(sql`
    WITH created_confirmation AS (
      INSERT INTO bom_confirmations (
        id, assay_record_id, result_revision_id, confirmation_no, version_no,
        status, price_per_gram_mnt, calculated_gross_amount_mnt,
        deduction_amount_mnt, net_payable_amount_mnt, calculation_payload_hash,
        confirmation_notes, confirmed_at, created_at
      ) VALUES (
        ${confirmationId}, ${source.assayRecordId}, ${source.resultRevisionId},
        ${input.confirmationNo}, ${input.versionNo}, 'confirmed',
        ${toMoney(input.pricePerGramMnt)}, ${toMoney(calculatedGrossAmountMnt)},
        ${toMoney(input.deductionAmountMnt)}, ${toMoney(netPayableAmountMnt)},
        ${calculationPayloadHash}, ${input.notes}, ${now}, ${now}
      )
      RETURNING id
    ), updated_record AS (
      UPDATE assay_records
      SET status = 'bom_confirmed', updated_at = ${now}
      WHERE id = ${source.assayRecordId}
      RETURNING id
    )
    INSERT INTO audit_logs (
      action, entity_type, entity_id, new_values, reason, request_id, ip_hash,
      user_agent, previous_hash, entry_hash, created_at
    ) VALUES (
      'bom_confirmation.recorded', 'bom_confirmations', ${confirmationId},
      ${JSON.stringify({ confirmationNo: input.confirmationNo, versionNo: input.versionNo, calculationPayloadHash })}::jsonb,
      'Signed Bank of Mongolia financial confirmation', ${auth.requestId}, ${auth.ipHash},
      ${auth.userAgent}, ${previousHash}, ${entryHash}, ${now}
    )
  `);

  return {
    confirmationNo: input.confirmationNo,
    versionNo: input.versionNo,
    pricePerGramMnt: input.pricePerGramMnt,
    calculatedGrossAmountMnt,
    deductionAmountMnt: input.deductionAmountMnt,
    netPayableAmountMnt,
    confirmedAt: now.toISOString(),
  };
}

async function logBomApiRequest(
  db: AppDatabase,
  auth: BomAuthorization,
  statusCode: number,
  errorMessage: string | null = null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO api_request_logs (
      api_client_id, direction, request_id, idempotency_key, method, path,
      status_code, request_hash, ip_hash, user_agent, error_message
    ) VALUES (
      ${auth.apiClientId}, 'inbound', ${auth.requestId}, ${auth.idempotencyKey},
      ${auth.method}, ${auth.path}, ${statusCode}, ${auth.requestHash},
      ${auth.ipHash}, ${auth.userAgent}, ${errorMessage}
    )
    ON CONFLICT (request_id) DO NOTHING
  `).catch(() => undefined);
}

function normalizeConfirmation(value: unknown): BomConfirmationInput {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    confirmationNo: readText(body.confirmationNo),
    versionNo: Number.isInteger(body.versionNo) ? Number(body.versionNo) : 1,
    pricePerGramMnt: readNumber(body.pricePerGramMnt),
    deductionAmountMnt: readNumber(body.deductionAmountMnt),
    notes: readText(body.notes) || null,
  };
}

function validateConfirmation(input: BomConfirmationInput): string | null {
  if (!isSafeHeaderValue(input.confirmationNo, 4, 80)) return "Баталгаажуулалтын дугаар буруу байна.";
  if (!Number.isInteger(input.versionNo) || input.versionNo !== 1) {
    return "Эхний баталгаажуулалтын хувилбар 1 байна.";
  }
  if (input.pricePerGramMnt <= 0) return "Нэг граммын үнэ 0-ээс их байна.";
  if (input.deductionAmountMnt < 0) return "Суутгалын дүн сөрөг байж болохгүй.";
  if (input.notes && input.notes.length > 1000) return "Тайлбар хэт урт байна.";
  return null;
}

function mapBomAssayRow(row: BomAssayRow): BomAssayRecord {
  return {
    recordId: row.recordId,
    customerName: row.customerName,
    metal: row.metal,
    grossWeightGrams: Number(row.grossWeightGrams),
    purityPercent: Number(row.purityPercent),
    fineWeightGrams: Number(row.fineWeightGrams),
    methodName: row.methodName,
    instrumentName: row.instrumentName,
    approvedAt: row.approvedAt instanceof Date ? row.approvedAt.toISOString() : row.approvedAt,
    allocations: Array.isArray(row.allocations) ? row.allocations : [],
  };
}

function bomError(status: 400 | 401 | 403 | 503, message: string): Response {
  return Response.json({ ok: false, message }, { status });
}

function isFreshTimestamp(value: string): boolean {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && Math.abs(Date.now() - timestamp) <= MAX_SIGNATURE_AGE_MS;
}

function isSafeHeaderValue(value: string, minimumLength: number, maximumLength: number): boolean {
  return value.length >= minimumLength && value.length <= maximumLength && /^[A-Za-z0-9._:-]+$/.test(value);
}

function ipMatchesRange(ip: string, range: string): boolean {
  const [network, prefixText] = range.trim().split("/");
  if (!network) return false;
  if (!prefixText) return ip === network;
  if (!isIpv4(ip) || !isIpv4(network)) return false;
  const prefix = Number(prefixText);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(network) & mask);
}

function isIpv4(value: string): boolean {
  return value.split(".").length === 4 && value.split(".").every((part) => {
    const number = Number(part);
    return Number.isInteger(number) && number >= 0 && number <= 255;
  });
}

function ipv4ToInt(value: string): number {
  return value.split(".").reduce((result, part) => (result << 8) + Number(part), 0) >>> 0;
}

function roundMoney(value: number): number {
  return Number(value.toFixed(2));
}

function toMoney(value: number): string {
  return value.toFixed(2);
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

function readRows<T>(result: T[] | { rows: T[] }): T[] {
  return Array.isArray(result) ? result : result.rows;
}

async function getLatestAuditHash(db: AppDatabase): Promise<string | null> {
  const [row] = readRows(await db.execute<{ entryHash: string | null }>(sql`
    SELECT entry_hash AS "entryHash" FROM audit_logs ORDER BY created_at DESC LIMIT 1
  `));
  return row?.entryHash ?? null;
}

type ApiClientRow = { id: string; scopes: string[]; allowedIpCidrs: string[] };
type BomAssayRow = {
  recordId: string;
  customerName: string;
  metal: "gold" | "silver";
  grossWeightGrams: number | string;
  purityPercent: number | string;
  fineWeightGrams: number | string;
  methodName: string;
  instrumentName: string | null;
  approvedAt: string | Date;
  allocations: BomAllocation[];
};
type BomAllocation = { bankName: string; allocatedGrossWeightGrams: number };
type BomAssayRecord = Omit<BomAssayRow, "grossWeightGrams" | "purityPercent" | "fineWeightGrams" | "approvedAt"> & {
  grossWeightGrams: number;
  purityPercent: number;
  fineWeightGrams: number;
  approvedAt: string;
};
type ConfirmationSourceRow = { assayRecordId: string; resultRevisionId: string; fineWeightGrams: number };
type BomConfirmationInput = {
  confirmationNo: string;
  versionNo: number;
  pricePerGramMnt: number;
  deductionAmountMnt: number;
  notes: string | null;
};
type BomConfirmationRecord = {
  confirmationNo: string;
  versionNo: number;
  pricePerGramMnt: number;
  calculatedGrossAmountMnt: number;
  deductionAmountMnt: number;
  netPayableAmountMnt: number;
  confirmedAt: string;
};

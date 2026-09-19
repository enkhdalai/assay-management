import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { createDatabase, type AppDatabase } from "../../../../packages/db/src";
import type {
  BullionIntakeBatchRecord,
  CreateBullionIntakeInput,
  CreateJewelryIntakeInput,
  JewelryIntakeRecord,
  JewelryServicePriceRule,
  SubmitBullionExaminationInput,
} from "../../../../packages/shared/src";
import { sha256Base64Url, type AuthenticatedUser } from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";
import { getAuthStore } from "../auth/auth-store";
import { localCustomerForCenter } from "../customers/routes";
import { formatBullionNumber } from "../../../../packages/shared/src/bullion-numbering";
import { isCenterManager } from "../../../../packages/shared/src/workspace-access";
import type { AnonymousSample } from "../../../../packages/shared/src/bullion-types";
import { calculateBullion, calculateSilverBullion } from "../../../../packages/shared/src/bullion-calculation";
import { issueCertificate } from "./certificates";
import { verifyEsignSignature } from "../signatures/monpass";
import { verifyEsignCertificateTrust } from "../signatures/monpass-trust";
import { recordVerifiedCertificateSignature } from "../signatures/certificates";

export const bullionRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

const INTAKE_ROLES = new Set(["system_admin", "assay_admin", "lab_manager", "intake_officer"]);
const EXAMINATION_ROLES = new Set(["system_admin", "assay_admin", "chemist", "lab_manager"]);
const inMemoryBatches: BullionIntakeBatchRecord[] = [];
const inMemoryJewelryIntakes: JewelryIntakeRecord[] = [];
let nextMemoryExaminationNumber = 1;
const batchOwners = new Map<string, string>();
const memoryExaminations = new Map<string, { revisionNo: number; input: SubmitBullionExaminationInput; submittedAt: string | null; returnedByName?: string | null; returnedAt?: string | null; returnNote?: string | null }>();
const memorySubstitutions = new Map<string, { byName: string; transferredAt: string; recipientId: string }>();
const memoryDailyChemistAssignments = new Map<string, { goldChemistIds: string[]; silverChemistIds: string[]; vacationChemistIds: string[] }>();
const visibleBatches = (user: AuthenticatedUser) => inMemoryBatches.filter((batch) => user.role === "system_admin" || batchOwners.get(batch.id) === user.organizationId);

export function getMemoryReport(user: AuthenticatedUser, from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00+08:00`);
  const end = Date.parse(`${to}T00:00:00+08:00`) + 86400000;
  return ["gold", "silver"].map((metal) => {
    const items = visibleBatches(user).filter((batch) => batch.metal === metal
      && Date.parse(batch.receivedAt || batch.createdAt) >= start && Date.parse(batch.receivedAt || batch.createdAt) < end).flatMap((batch) => batch.items);
    return { metal, bullionCount: items.length, sampleCount: items.filter((item) => (item.sampleWeightMilligrams ?? 0) > 0).length,
      receivedGrams: items.reduce((sum, item) => sum + item.grossWeightBeforeGrams, 0),
      afterGrams: items.reduce((sum, item) => sum + (item.grossWeightAfterGrams ?? 0), 0),
      submittedCount: items.filter((item) => memoryExaminations.get(item.id)?.input.status === "submitted").length };
  });
}

export function getMemoryPrivateAssayReport(user: AuthenticatedUser, from: string, to: string) {
  const start = Date.parse(`${from}T00:00:00+08:00`);
  const end = Date.parse(`${to}T00:00:00+08:00`) + 86400000;
  return visibleBatches(user)
    .filter((batch) => Date.parse(batch.receivedAt || batch.createdAt) >= start && Date.parse(batch.receivedAt || batch.createdAt) < end)
    .flatMap((batch) => batch.items.map((item) => ({
      organizationName: batch.customerName,
      receivedAt: batch.receivedAt,
      registrationNo: batch.publicId,
      bullionNo: item.bullionNo,
      analysisNo: item.analysisNo,
      metal: batch.metal,
      grossWeightBeforeGrams: item.grossWeightBeforeGrams,
      grossWeightAfterGrams: item.grossWeightAfterGrams ?? null,
      sampleWeightMilligrams: item.sampleWeightMilligrams ?? null,
      lossGrams: item.grossWeightAfterGrams == null ? null : item.grossWeightBeforeGrams - item.grossWeightAfterGrams - (item.slagWeightGrams ?? 0),
      receivedWeightGrams: null,
      remainingMilligrams: null,
      korolkoMilligrams: null,
      goldFinenessPermille: null,
      silverFinenessPermille: null,
      delta: batch.delta ?? 0,
      origin: batch.dispatchReference ?? null,
      chemistName: item.assignedChemistName ?? null,
      actNumber: batch.actNumber ?? null,
      actDate: batch.actDate ?? null,
    })));
}

export function getMemoryDashboardSummary(user: AuthenticatedUser, period: "day" | "month" | "year" = "day") {
  const dateParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => dateParts.find((item) => item.type === type)?.value || "";
  const year = Number(part("year"));
  const month = Number(part("month"));
  const day = Number(part("day"));
  const periodStart = period === "year" ? `${year}-01-01` : period === "month" ? `${year}-${String(month).padStart(2, "0")}-01` : `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const periodEnd = period === "year" ? `${year + 1}-01-01` : period === "month"
    ? `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, "0")}-01`
    : new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  const start = Date.parse(`${periodStart}T00:00:00+08:00`);
  const end = Date.parse(`${periodEnd}T00:00:00+08:00`);
  const items = visibleBatches(user).flatMap((batch) => batch.items.map((item) => ({ batch, item })));
  const isInPeriod = ({ batch }: typeof items[number]) => {
    const receivedAt = Date.parse(batch.receivedAt || batch.createdAt);
    return receivedAt >= start && receivedAt < end;
  };
  const isInExamination = ({ item }: typeof items[number]) => !!item.assignedChemistId && memoryExaminations.get(item.id)?.input.status !== "submitted";
  const periodItems = items.filter(isInPeriod);
  return {
    goldReceivedToday: periodItems.filter(({ batch }) => batch.metal === "gold").length,
    silverReceivedToday: periodItems.filter(({ batch }) => batch.metal === "silver").length,
    withChemistCount: items.filter(isInExamination).length,
    todayInExaminationCount: periodItems.filter(isInExamination).length,
    totalGoldGrams: periodItems.filter(({ batch }) => batch.metal === "gold").reduce((sum, { item }) => sum + item.grossWeightBeforeGrams, 0),
    totalSilverGrams: periodItems.filter(({ batch }) => batch.metal === "silver").reduce((sum, { item }) => sum + item.grossWeightBeforeGrams, 0),
    userCount: 0,
    individualCustomers: 0,
    companyCustomers: 0,
  };
}

bullionRoutes.get("/samples", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!EXAMINATION_ROLES.has(user.role)) return c.json({ ok: false }, 403);
  const samples = await listSamples(c.env, user);
  return c.json({ ok: true, data: user.role === "chemist" ? samples.filter((sample) => ["pending", "draft"].includes(sample.status)) : samples });
});

bullionRoutes.get("/samples/history", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (user.role !== "chemist") return c.json({ ok: false }, 403);
  const date = c.req.query("date") ?? "";
  if (!isIsoDate(date)) return c.json({ ok: false, message: "Огноо буруу байна." }, 400);
  return c.json({ ok: true, data: await listChemistHistory(c.env, user, date) });
});

bullionRoutes.get("/samples/history/dates", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (user.role !== "chemist") return c.json({ ok: false }, 403);
  return c.json({ ok: true, data: await listChemistHistoryDates(c.env, user) });
});

bullionRoutes.post("/samples/:id/approve", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false, message: "Шинжилгээ баталгаажуулах эрхгүй байна." }, 403);
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "Баталгаажуулахад өгөгдлийн сан шаардлагатай." }, 503);

  const db = createDatabase(c.env.DATABASE_URL);
  const now = new Date();
  const auditId = crypto.randomUUID();
  const entryHash = await sha256Base64Url(JSON.stringify({ auditId, itemId: id, actor: user.id, action: "bullion_examination.approved", now }));
  const result = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute<{ id: string; batchReadyForFinalization: boolean }>(sql`
      WITH target AS MATERIALIZED (
        SELECT e.id, i.batch_id
        FROM bullion_intake_items i
        JOIN bullion_intake_batches b ON b.id = i.batch_id
        JOIN LATERAL (
          SELECT * FROM bullion_examination_revisions
          WHERE bullion_item_id = i.id ORDER BY revision_no DESC LIMIT 1
        ) e ON true
        WHERE i.id = ${id}::uuid
          AND b.assay_center_id = ${user.organizationId}::uuid
          AND e.status = 'submitted'
          AND e.entered_by_user_id <> ${user.id}::uuid
        FOR UPDATE OF e
      ), approved AS (
        UPDATE bullion_examination_revisions
        SET status = 'approved', approved_by_user_id = ${user.id}::uuid, approved_at = ${now}
        WHERE id IN (SELECT id FROM target)
        RETURNING id
      ), audit AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, reason, entry_hash)
        SELECT ${auditId}::uuid, ${user.id}::uuid, ${user.organizationId}::uuid,
          'bullion_examination.approved', 'bullion_examination_revisions', id,
          'Laboratory director approved bullion examination', ${entryHash}
        FROM approved
      )
      SELECT approved.id,
        NOT EXISTS (
          SELECT 1
          FROM bullion_intake_items batch_item
          LEFT JOIN LATERAL (
            SELECT status
            FROM bullion_examination_revisions
            WHERE bullion_item_id = batch_item.id
            ORDER BY revision_no DESC
            LIMIT 1
          ) latest ON true
          WHERE batch_item.batch_id = target.batch_id
            AND COALESCE(latest.status::text, 'draft') <> 'approved'
        ) AS "batchReadyForFinalization"
      FROM approved
      JOIN target ON target.id = approved.id
    `),
  ]);
  const [approved] = readRows(result[1]);
  if (!approved) return c.json({ ok: false, message: "Шинжилгээ батлах боломжгүй байна." }, 409);
  return c.json({ ok: true, data: { batchReadyForFinalization: approved.batchReadyForFinalization } });
});

bullionRoutes.post("/samples/:id/return", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false, message: "Шинжилгээ буцаах эрхгүй байна." }, 403);
  const id = c.req.param("id");
  const note = text(object(await c.req.json().catch(() => null)).note).trim();
  if (!isUuid(id)) return c.json({ ok: false }, 400);
  if (!note || note.length > 2_000) return c.json({ ok: false, message: "Буцаах тайлбарыг 1-2000 тэмдэгтээр оруулна уу." }, 400);
  if (!c.env.DATABASE_URL) {
    const revision = memoryExaminations.get(id);
    const item = visibleBatches(user).flatMap((batch) => batch.items).find((candidate) => candidate.id === id);
    if (!item || revision?.input.status !== "submitted") return c.json({ ok: false, message: "Буцаах шинжилгээ олдсонгүй." }, 409);
    memoryExaminations.set(id, { ...revision, input: { ...revision.input, status: "draft" }, submittedAt: null, returnedByName: user.fullName, returnedAt: new Date().toISOString(), returnNote: note });
    return c.json({ ok: true });
  }

  const db = createDatabase(c.env.DATABASE_URL);
  const [returned] = readRows(await db.execute<{ id: string }>(sql`
    UPDATE bullion_examination_revisions revision
    SET status = 'draft', submitted_at = NULL, returned_by_user_id = ${user.id}::uuid,
      returned_at = now(), return_note = ${note}
    FROM bullion_intake_items item
    JOIN bullion_intake_batches batch ON batch.id = item.batch_id
    WHERE revision.id = (
      SELECT latest.id
      FROM bullion_examination_revisions latest
      WHERE latest.bullion_item_id = item.id
      ORDER BY latest.revision_no DESC
      LIMIT 1
    )
      AND item.id = ${id}::uuid
      AND revision.status = 'submitted'
      AND (${user.role} = 'system_admin' OR batch.assay_center_id = ${user.organizationId}::uuid)
    RETURNING revision.id
  `));
  if (!returned) return c.json({ ok: false, message: "Зөвхөн эрхлэгчийн хяналтад байгаа шинжилгээг буцаах боломжтой." }, 409);
  await appendAuditLog(db, user, "bullion_examination.returned", "bullion_examination_revisions", returned.id, {
    bullionItemId: id, status: "draft", returnNote: note,
  });
  return c.json({ ok: true });
});

bullionRoutes.post("/batches/:id/finalize", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false, message: "Эцсийн гэрчилгээ батлах эрхгүй байна." }, 403);
  const batchId = c.req.param("id");
  if (!isUuid(batchId)) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "Гэрчилгээ батлахад өгөгдлийн сан шаардлагатай." }, 503);

  const db = createDatabase(c.env.DATABASE_URL);
  const certificate = await issueCertificate(db, user, batchId, c.env.FIELD_ENCRYPTION_KEY);
  if (!certificate) return c.json({ ok: false, message: "Бүх гулдмайн шинжилгээг лабораторын эрхлэгч баталсны дараа эцсийн гэрчилгээ батална." }, 409);
  return c.json({ ok: true, data: certificate });
});

/** The exact immutable bytes represented by this response are what a provider signs. */
bullionRoutes.get("/batches/:id/signature-payload", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const batchId = c.req.param("id");
  if (!isUuid(batchId) || !c.env.DATABASE_URL) return c.json({ ok: false }, 400);
  const [certificate] = readRows(await createDatabase(c.env.DATABASE_URL).execute(sql`
    SELECT id, verification_id AS "verificationId", manifest, document_hash AS "documentHash", signature_status AS "signatureStatus"
    FROM bullion_certificates WHERE batch_id = ${batchId}::uuid AND assay_center_id = ${user.organizationId}::uuid
  `));
  if (!certificate?.manifest || !certificate.documentHash) {
    return c.json({ ok: false, message: "Дижитал гарын үсгийн гэрчилгээ бэлтгэгдээгүй байна." }, 409);
  }
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true, data: certificate });
});

/**
 * Stores the response from the local eSign client as evidence only. The
 * provider adapter must cryptographically verify it before a certificate can
 * become signed or visible to external API clients.
 */
bullionRoutes.post("/batches/:id/signature-evidence", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const batchId = c.req.param("id");
  if (!isUuid(batchId) || !c.env.DATABASE_URL) return c.json({ ok: false }, 400);
  const body = await c.req.json().catch(() => null) as { providerResponse?: unknown } | null;
  if (body?.providerResponse == null) {
    return c.json({ ok: false, message: "eSign-ийн хариу дутуу байна." }, 400);
  }
  const db = createDatabase(c.env.DATABASE_URL);
  const [certificate] = readRows(await db.execute<{ id: string; documentHash: string }>(sql`
    SELECT id, document_hash AS "documentHash" FROM bullion_certificates
    WHERE batch_id = ${batchId}::uuid AND assay_center_id = ${user.organizationId}::uuid
      AND signature_status IN ('unsigned', 'signing') AND document_hash IS NOT NULL AND manifest IS NOT NULL
    LIMIT 1
  `));
  if (!certificate?.documentHash) return c.json({ ok: false, message: "Гэрчилгээ гарын үсэг зурахад бэлэн биш байна." }, 409);
  let verified;
  try { verified = await verifyEsignSignature(body.providerResponse, certificate.documentHash); }
  catch (error) { return c.json({ ok: false, message: error instanceof Error ? error.message : "eSign-ийн гарын үсэг баталгаажсангүй." }, 400); }
  let validationEvidence: Record<string, unknown> = verified.validationEvidence;
  try {
    const trust = await verifyEsignCertificateTrust(verified.signerCertificate, c.env);
    const signed = await recordVerifiedCertificateSignature(db, {
      certificateId: certificate.id,
      provider: trust.provider,
      providerTransactionId: verified.validationEvidence.tokenSerialNumber,
      signatureValue: verified.signatureValue,
      signerCertificate: verified.signerCertificate,
      certificateChain: trust.certificateChain,
      signatureAlgorithm: verified.signatureAlgorithm,
      signedAt: verified.signedAt,
      validationEvidence: { ...verified.validationEvidence, ...trust.validationEvidence },
    });
    if (!signed) return c.json({ ok: false, message: "Гэрчилгээ гарын үсэг зурахад бэлэн биш байна." }, 409);
    return c.json({ ok: true, data: { signatureStatus: "signed" } });
  } catch (error) {
    // The signature itself is retained as evidence, but it cannot be published
    // until the pinned CA chain and a fresh OCSP result are both verified.
    validationEvidence = {
      ...verified.validationEvidence,
      trust: "pending_or_failed",
      trustError: error instanceof Error ? error.message : "MonPass итгэмжлэлийн шалгалт амжилтгүй боллоо.",
    };
  }
  const auditId = crypto.randomUUID();
  const entryHash = await sha256Base64Url(JSON.stringify({ auditId, batchId, certificateHash: certificate.documentHash, signature: verified.signatureValue, signedAt: verified.signedAt }));
  const result = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute<{ id: string }>(sql`
      WITH saved AS (
        UPDATE bullion_certificates certificate
        SET signature_status = 'cryptographically_verified', signature_provider = ${null},
          signature_value = ${verified.signatureValue}, signer_certificate = ${verified.signerCertificate},
          signature_algorithm = ${verified.signatureAlgorithm}, signed_at = ${verified.signedAt}::timestamptz,
          validation_evidence = ${JSON.stringify(validationEvidence)}::jsonb
        FROM bullion_intake_batches batch
        WHERE certificate.batch_id = ${batchId}::uuid AND batch.id = certificate.batch_id
          AND certificate.assay_center_id = ${user.organizationId}::uuid
          AND certificate.signature_status IN ('unsigned', 'signing')
          AND certificate.manifest IS NOT NULL AND certificate.document_hash IS NOT NULL
        RETURNING certificate.id
      ), audit AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, entry_hash)
        SELECT ${auditId}::uuid, ${user.id}::uuid, ${user.organizationId}::uuid,
          'bullion_certificate.signature_evidence_received', 'bullion_certificates', id,
          jsonb_build_object('provider', 'untrusted'::text, 'signedAt', ${verified.signedAt}::timestamptz,
            'certificateSerialNumber', ${verified.validationEvidence.certificateSerialNumber}::text),
          'eSign RSA signature verified; provider CA chain and revocation validation pending', ${entryHash}
        FROM saved
      ) SELECT id FROM saved
    `),
  ]);
  if (!readRows(result[1]).length) return c.json({ ok: false, message: "Гэрчилгээ гарын үсэг зурахад бэлэн биш байна." }, 409);
  return c.json({ ok: true, data: { signatureStatus: "cryptographically_verified" } });
});

bullionRoutes.post("/batches/:id/archive-print", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false, message: "Архивын тайлан хэвлэх эрхгүй байна." }, 403);
  const batchId = c.req.param("id");
  if (!isUuid(batchId)) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "Тайлан хэвлэхэд өгөгдлийн сан шаардлагатай." }, 503);
  const [report] = readRows(await createDatabase(c.env.DATABASE_URL).execute(sql`
    SELECT customer.display_name AS "customerName", center.name AS "centerName", center.type AS "centerType",
      batch.public_id AS "registrationNo", batch.metal, batch.received_at AS "receivedAt",
      certificate.issue_year AS "certificateYear", certificate.sequence_no AS "certificateSequence", certificate.issued_at AS "issuedAt",
      certificate.entries,
      (SELECT CASE WHEN count(DISTINCT chemist.full_name) = 1 THEN min(chemist.full_name) ELSE 'Олон химич' END
        FROM bullion_intake_items item
        JOIN LATERAL (SELECT entered_by_user_id FROM bullion_examination_revisions
          WHERE bullion_item_id = item.id ORDER BY revision_no DESC LIMIT 1) examination ON true
        JOIN users chemist ON chemist.id = examination.entered_by_user_id
        WHERE item.batch_id = batch.id) AS "chemistName",
      (SELECT CASE WHEN count(*) = 1 THEN min(manager.full_name) END FROM users manager
        WHERE manager.organization_id = batch.assay_center_id AND manager.role = 'lab_manager' AND manager.status = 'active') AS "managerName"
    FROM bullion_intake_batches batch
    JOIN customers customer ON customer.id = batch.customer_id
    JOIN organizations center ON center.id = batch.assay_center_id
    JOIN bullion_certificates certificate ON certificate.batch_id = batch.id
    WHERE batch.id = ${batchId}::uuid AND batch.assay_center_id = ${user.organizationId}::uuid
    LIMIT 1
  `));
  if (!report) return c.json({ ok: false, message: "Эцсийн гэрчилгээ батлагдаагүй байна." }, 409);
  const certificateNo = String(report.certificateSequence).padStart(4, "0");
  await appendAuditLog(createDatabase(c.env.DATABASE_URL), user, "bullion_certificate.archive_print_requested", "bullion_intake_batches", batchId,
    { certificateNo, certificateYear: report.certificateYear });
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true, data: {
    customerName: report.customerName, centerName: report.centerName, centerType: report.centerType,
    bullionNo: "", bullionWeightGrams: 0, origin: null, registrationNo: report.registrationNo,
    chemistName: report.chemistName, managerName: report.managerName, printedAt: new Date().toISOString(),
    sample: { id: batchId, analysisNo: "", metal: report.metal, receivedAt: report.receivedAt, sampleWeightMilligrams: 0,
      delta: 0, revisionNo: 0, status: "approved", examination: null },
    certificateNo, issuedAt: report.issuedAt, entries: report.entries,
  } });
});

bullionRoutes.get("/samples/:id/substitute-chemists", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (user.role !== "chemist") return c.json({ ok: false }, 403);
  const sample = (await listSamples(c.env, user)).find((item) => item.id === c.req.param("id"));
  if (!sample) return c.json({ ok: false }, 404);
  if (!c.env.DATABASE_URL) {
    const chemists = await (await getAuthStore(c.env))!.listActiveChemists(user);
    return c.json({ ok: true, data: chemists });
  }
  const data = readRows(await createDatabase(c.env.DATABASE_URL).execute(sql`
    SELECT id, full_name AS "fullName" FROM users
    WHERE organization_id = ${user.organizationId} AND role = 'chemist' AND status = 'active' AND id <> ${user.id}
    ORDER BY full_name, id
  `));
  return c.json({ ok: true, data });
});

bullionRoutes.post("/samples/:id/substitute", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (user.role !== "chemist") return c.json({ ok: false }, 403);
  const sampleId = c.req.param("id");
  const substituteId = text(object(await c.req.json().catch(() => null)).chemistId);
  if (!isUuid(sampleId) || !isUuid(substituteId) || substituteId === user.id) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) {
    const batch = visibleBatches(user).find((record) => record.status === "sample_taken" && record.items.some((item) => item.id === sampleId && item.assignedChemistId === user.id));
    const item = batch?.items.find((record) => record.id === sampleId);
    const chemists = await (await getAuthStore(c.env))!.listActiveChemists(user);
    const substitute = chemists.find((person) => person.id === substituteId);
    if (!item || !substitute) return c.json({ ok: false }, 404);
    const transferredAt = new Date().toISOString();
    item.assignedChemistId = substitute.id; item.assignedChemistName = substitute.fullName; item.assignedAt = transferredAt;
    memorySubstitutions.set(sampleId, { byName: user.fullName, transferredAt, recipientId: substitute.id });
    return c.json({ ok: true });
  }
  const db = createDatabase(c.env.DATABASE_URL);
  const eventId = crypto.randomUUID();
  const hash = await sha256Base64Url(JSON.stringify({ eventId, userId: user.id, sampleId, substituteId }));
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute(sql`
      WITH target AS MATERIALIZED (
        SELECT i.id, i.assigned_chemist_id AS "assignedChemistId" FROM bullion_intake_items i
        JOIN bullion_intake_batches b ON b.id = i.batch_id
        JOIN users substitute ON substitute.id = ${substituteId}::uuid AND substitute.organization_id = b.assay_center_id
          AND substitute.role = 'chemist' AND substitute.status = 'active'
        WHERE i.id = ${sampleId}::uuid AND i.assigned_chemist_id = ${user.id}::uuid AND b.status = 'sample_taken'
          AND b.assay_center_id = ${user.organizationId}::uuid
          AND NOT EXISTS (SELECT 1 FROM bullion_examination_revisions e WHERE e.bullion_item_id = i.id AND e.status = 'approved')
        FOR UPDATE OF i
      ), updated AS (
        UPDATE bullion_intake_items i SET assigned_chemist_id = ${substituteId}::uuid, assigned_at = now()
        WHERE i.id IN (SELECT id FROM target) RETURNING i.id
      ), audit AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, old_values, new_values, reason, entry_hash)
        SELECT ${eventId}, ${user.id}, ${user.organizationId}, 'bullion_sample.substituted', 'bullion_intake_items', updated.id,
          jsonb_build_object('assignedChemistId', target."assignedChemistId"), jsonb_build_object('assignedChemistId', ${substituteId}::text),
          'Chemist requested a substitute', ${hash} FROM updated JOIN target ON target.id = updated.id
      ) SELECT id FROM updated
    `),
  ]);
  if (!readRows(results[1]).length) return c.json({ ok: false, message: "Дээж хуваарилагдсан, баталгаажсан эсвэл орлох химич идэвхгүй байна." }, 409);
  return c.json({ ok: true });
});

async function listSamples(env: EdgeApiEnv, user: AuthenticatedUser): Promise<AnonymousSample[]> {
  if (!env.DATABASE_URL) return visibleBatches(user).flatMap((batch) => batch.items
    .filter((item) => batch.status === "sample_taken" && (item.sampleWeightMilligrams ?? 0) > 0
      && (user.role !== "chemist" || item.assignedChemistId === user.id))
    .map((item) => {
      const revision = memoryExaminations.get(item.id);
      const substitution = memorySubstitutions.get(item.id);
      const batchProgress = batch.items.reduce<Map<string, { chemistId: string; chemistName: string; assignedCount: number; completedCount: number; completedAt: string | null }>>((progress, record) => {
        if (!record.assignedChemistId || !record.assignedChemistName) return progress;
        const current = progress.get(record.assignedChemistId) ?? { chemistId: record.assignedChemistId, chemistName: record.assignedChemistName, assignedCount: 0, completedCount: 0, completedAt: null };
        const examination = memoryExaminations.get(record.id);
        current.assignedCount += 1;
        if (examination?.input.status === "submitted") { current.completedCount += 1; current.completedAt = examination.submittedAt; }
        progress.set(record.assignedChemistId, current);
        return progress;
      }, new Map());
      return { id: item.id, analysisNo: item.analysisNo!, metal: batch.metal,
        ...(isCenterManager(user.role) ? { bullionNo: item.bullionNo, batchId: batch.id, customerName: batch.customerName, registrationNo: batch.publicId,
          assignedChemistId: item.assignedChemistId ?? null, assignedChemistName: item.assignedChemistName ?? null,
          assignedAt: item.assignedAt ?? null, completedAt: revision?.submittedAt ?? null,
          returnedByName: revision?.returnedByName ?? null, returnedAt: revision?.returnedAt ?? null, returnNote: revision?.returnNote ?? null,
          batchProgress: [...batchProgress.values()], batchReadyForFinalization: false, certificateNo: null } : {}),
        ...(substitution?.recipientId === user.id ? { substitutedByName: substitution.byName, substitutedAt: substitution.transferredAt } : {}),
        receivedAt: batch.receivedAt || batch.createdAt, sampleWeightMilligrams: item.sampleWeightMilligrams!,
        delta: batch.delta ?? -0.03125, silverTiter: batch.silverTiter ?? null, revisionNo: revision?.revisionNo ?? 0,
        status: revision?.input.status ?? "pending", examination: revision?.input ?? null };
    }));
  const result = await createDatabase(env.DATABASE_URL).execute<AnonymousSample>(sql`
    SELECT i.id, b.id AS "batchId", customer.display_name AS "customerName", b.public_id AS "registrationNo",
      i.assigned_chemist_id AS "assignedChemistId", i.assigned_at AS "assignedAt", e.submitted_at AS "completedAt", e.approved_at AS "approvedAt",
      e.returned_at AS "returnedAt", e.return_note AS "returnNote",
      (SELECT full_name FROM users WHERE id = i.assigned_chemist_id) AS "assignedChemistName",
      approver.full_name AS "approvedByName", returner.full_name AS "returnedByName",
      transfer."substitutedByName", transfer."substitutedAt",
      i.bullion_no AS "bullionNo", i.examination_number::text AS "analysisNo", b.metal,
      b.received_at AS "receivedAt", i.sample_weight_milligrams::float AS "sampleWeightMilligrams",
      b.delta::float AS delta, b.silver_titer::float AS "silverTiter", COALESCE(e.revision_no, 0) AS "revisionNo", COALESCE(e.status::text, 'pending') AS status,
      COALESCE((SELECT json_agg(json_build_object(
        'chemistId', timeline."chemistId", 'chemistName', timeline."chemistName", 'assignedCount', timeline."assignedCount",
        'completedCount', timeline."completedCount", 'completedAt', timeline."completedAt") ORDER BY timeline."chemistName")
        FROM (
          SELECT u.id AS "chemistId", u.full_name AS "chemistName", count(*)::int AS "assignedCount",
            count(*) FILTER (WHERE latest.status IN ('submitted', 'approved'))::int AS "completedCount",
            max(latest.submitted_at)::text AS "completedAt"
          FROM bullion_intake_items batch_item
          JOIN users u ON u.id = batch_item.assigned_chemist_id
          LEFT JOIN LATERAL (SELECT status, submitted_at FROM bullion_examination_revisions
            WHERE bullion_item_id = batch_item.id ORDER BY revision_no DESC LIMIT 1) latest ON true
          WHERE batch_item.batch_id = b.id
          GROUP BY u.id, u.full_name
        ) timeline), '[]'::json) AS "batchProgress",
      NOT EXISTS (SELECT 1 FROM bullion_intake_items batch_item
        LEFT JOIN LATERAL (SELECT status FROM bullion_examination_revisions
          WHERE bullion_item_id = batch_item.id ORDER BY revision_no DESC LIMIT 1) latest ON true
        WHERE batch_item.batch_id = b.id AND COALESCE(latest.status::text, 'draft') <> 'approved') AS "batchReadyForFinalization",
      (SELECT lpad(sequence_no::text, GREATEST(4, length(sequence_no::text)), '0') FROM bullion_certificates
        WHERE batch_id = b.id LIMIT 1) AS "certificateNo",
      (SELECT to_jsonb(certificate)->>'signature_status' FROM bullion_certificates certificate
        WHERE certificate.batch_id = b.id LIMIT 1) AS "certificateSignatureStatus",
      CASE WHEN e.id IS NULL THEN NULL ELSE json_build_object(
        'bullionItemId', i.id, 'examinationNo', i.examination_number::text, 'sampleWeightGrams', e.sample_weight_grams::float,
        'delta', e.delta::float, 'status', e.status, 'weightEntries', e.weight_entries,
        'measurementEntries', e.measurement_entries, 'goldResult', e.gold_result::float, 'silverResult', e.silver_result::float,
        'silverMethod', e.silver_method, 'silverTiterMilligramsPerMilliliter', e.silver_titer_mg_per_ml::float, 'silverBlankVolumeMilliliters', e.silver_blank_volume_ml::float,
        'reexaminationRequested', e.reexamination_requested, 'notes', e.notes) END AS examination
    FROM bullion_intake_items i JOIN bullion_intake_batches b ON b.id = i.batch_id
    JOIN customers customer ON customer.id = b.customer_id
    LEFT JOIN LATERAL (SELECT * FROM bullion_examination_revisions WHERE bullion_item_id = i.id ORDER BY revision_no DESC LIMIT 1) e ON true
    LEFT JOIN users approver ON approver.id = e.approved_by_user_id
    LEFT JOIN users returner ON returner.id = e.returned_by_user_id
    LEFT JOIN LATERAL (
      SELECT sender.full_name AS "substitutedByName", audit.created_at AS "substitutedAt"
      FROM audit_logs audit JOIN users sender ON sender.id = audit.actor_user_id
      WHERE audit.action = 'bullion_sample.substituted' AND audit.entity_type = 'bullion_intake_items' AND audit.entity_id = i.id
        AND audit.new_values->>'assignedChemistId' = i.assigned_chemist_id::text
      ORDER BY audit.created_at DESC LIMIT 1
    ) transfer ON ${user.role} = 'chemist'
    WHERE b.status = 'sample_taken' AND i.sample_weight_milligrams > 0
      AND (${user.role} <> 'chemist' OR i.assigned_chemist_id = ${user.id})
      AND (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
    ORDER BY b.received_at DESC, i.sequence_no
  `);
  return readRows(result).map((sample) => {
    if (typeof sample.batchProgress === "string") {
      try { sample.batchProgress = JSON.parse(sample.batchProgress); } catch { sample.batchProgress = []; }
    }
    if (isCenterManager(user.role)) return sample;
    const anonymous = { ...sample };
    delete anonymous.batchId; delete anonymous.customerName; delete anonymous.registrationNo;
    delete anonymous.bullionNo;
    delete anonymous.assignedChemistId; delete anonymous.assignedChemistName;
    delete anonymous.assignedAt; delete anonymous.completedAt;
    delete anonymous.approvedByName; delete anonymous.approvedAt;
    delete anonymous.batchProgress; delete anonymous.batchReadyForFinalization; delete anonymous.certificateNo; delete anonymous.certificateSignatureStatus;
    return anonymous;
  });
}

async function listChemistHistory(env: EdgeApiEnv, user: AuthenticatedUser, date: string): Promise<AnonymousSample[]> {
  if (!env.DATABASE_URL) {
    return visibleBatches(user).flatMap((batch) => batch.items.map((item) => ({ batch, item })))
      .filter(({ item }) => item.assignedChemistId === user.id)
      .flatMap(({ batch, item }) => {
        const revision = memoryExaminations.get(item.id);
        if (!revision?.submittedAt || revision.input.status !== "submitted" || mongoliaDate(revision.submittedAt) !== date) return [];
        return [{ id: item.id, bullionNo: item.bullionNo, analysisNo: item.analysisNo!, metal: batch.metal, receivedAt: batch.receivedAt || batch.createdAt,
          sampleWeightMilligrams: item.sampleWeightMilligrams!, delta: batch.delta ?? -0.03125, silverTiter: batch.silverTiter ?? null,
          assignedChemistName: user.fullName, completedAt: revision.submittedAt,
          revisionNo: revision.revisionNo, status: revision.input.status, examination: revision.input }];
      })
      .sort((left, right) => Number(left.analysisNo) - Number(right.analysisNo));
  }
  const result = await createDatabase(env.DATABASE_URL).execute<AnonymousSample>(sql`
    SELECT i.id, i.bullion_no AS "bullionNo", e.examination_no::text AS "analysisNo", b.metal,
      b.received_at AS "receivedAt", e.submitted_at AS "completedAt", ${user.fullName} AS "assignedChemistName",
      i.sample_weight_milligrams::float AS "sampleWeightMilligrams", b.delta::float AS delta,
      b.silver_titer::float AS "silverTiter", e.revision_no AS "revisionNo", e.status::text AS status,
      json_build_object(
        'bullionItemId', i.id, 'examinationNo', e.examination_no::text, 'sampleWeightGrams', e.sample_weight_grams::float,
        'delta', e.delta::float, 'status', e.status, 'weightEntries', e.weight_entries, 'measurementEntries', e.measurement_entries,
        'goldResult', e.gold_result::float, 'silverResult', e.silver_result::float, 'silverMethod', e.silver_method,
        'silverTiterMilligramsPerMilliliter', e.silver_titer_mg_per_ml::float, 'silverBlankVolumeMilliliters', e.silver_blank_volume_ml::float,
        'reexaminationRequested', e.reexamination_requested, 'notes', e.notes) AS examination
    FROM bullion_examination_revisions e
    JOIN bullion_intake_items i ON i.id = e.bullion_item_id
    JOIN bullion_intake_batches b ON b.id = i.batch_id
    JOIN organizations o ON o.id = b.assay_center_id
    WHERE e.entered_by_user_id = ${user.id} AND b.assay_center_id = ${user.organizationId}
      AND o.type IN ('private_assay_center', 'government_assay_center')
      AND e.status IN ('submitted', 'approved', 'rejected', 'superseded') AND e.submitted_at IS NOT NULL
      AND (e.submitted_at AT TIME ZONE 'Asia/Ulaanbaatar')::date = ${date}::date
    ORDER BY e.examination_no, e.revision_no
  `);
  return readRows(result);
}

async function listChemistHistoryDates(env: EdgeApiEnv, user: AuthenticatedUser): Promise<string[]> {
  if (!env.DATABASE_URL) return [...new Set(visibleBatches(user).flatMap((batch) => batch.items)
    .filter((item) => item.assignedChemistId === user.id)
    .flatMap((item) => {
      const examination = memoryExaminations.get(item.id);
      return examination?.submittedAt && examination.input.status === "submitted" ? [mongoliaDate(examination.submittedAt)] : [];
    }))].sort().reverse();
  const result = await createDatabase(env.DATABASE_URL).execute<{ date: string }>(sql`
    SELECT DISTINCT (e.submitted_at AT TIME ZONE 'Asia/Ulaanbaatar')::date::text AS date
    FROM bullion_examination_revisions e
    JOIN bullion_intake_items i ON i.id = e.bullion_item_id
    JOIN bullion_intake_batches b ON b.id = i.batch_id
    JOIN organizations o ON o.id = b.assay_center_id
    WHERE e.entered_by_user_id = ${user.id} AND b.assay_center_id = ${user.organizationId}
      AND o.type IN ('private_assay_center', 'government_assay_center')
      AND e.status IN ('submitted', 'approved', 'rejected', 'superseded') AND e.submitted_at IS NOT NULL
    ORDER BY date DESC
  `);
  return readRows(result).map((row) => row.date);
}

async function assignmentQuery(batchId: string, user: AuthenticatedUser, updateEventId?: string) {
  const hash = await sha256Base64Url(JSON.stringify({ event: crypto.randomUUID(), batchId, actor: user.id }));
  return sql`
    WITH pending AS MATERIALIZED (
      SELECT i.id, b.assay_center_id, row_number() OVER (ORDER BY random(), i.id) AS position
      FROM bullion_intake_items i JOIN bullion_intake_batches b ON b.id = i.batch_id
      WHERE b.id = ${batchId} AND b.status = 'sample_taken' AND i.assigned_chemist_id IS NULL
        AND (${updateEventId ?? null}::uuid IS NULL OR EXISTS (SELECT 1 FROM audit_logs WHERE id = ${updateEventId ?? null}::uuid))
        AND (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
    ), workforce AS (
      SELECT u.id, (SELECT count(*) FROM bullion_intake_items i
        JOIN bullion_intake_batches b ON b.id = i.batch_id
        WHERE i.assigned_chemist_id = u.id AND b.status = 'sample_taken'
          AND COALESCE((SELECT e.status::text FROM bullion_examination_revisions e
            WHERE e.bullion_item_id = i.id ORDER BY e.revision_no DESC LIMIT 1), 'draft') = 'draft') AS load
      FROM users u WHERE u.role = 'chemist' AND u.status = 'active'
        AND u.organization_id IN (SELECT assay_center_id FROM pending)
    ), slots AS (
      SELECT w.id, row_number() OVER (ORDER BY w.load + s.n, random(), w.id) AS position
      FROM workforce w CROSS JOIN generate_series(1, (SELECT count(*)::int FROM pending)) s(n)
    ), assigned AS (
      UPDATE bullion_intake_items i SET assigned_chemist_id = s.id, assigned_at = now()
      FROM pending p JOIN slots s ON s.position = p.position WHERE i.id = p.id
      RETURNING i.id, i.assigned_chemist_id
    ), audit AS (
      INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, entry_hash)
      SELECT gen_random_uuid(), ${user.id}, ${user.organizationId}, 'bullion_sample.assigned',
        'bullion_intake_items', id, jsonb_build_object('assignedChemistId', assigned_chemist_id),
        'Automatic workload-balanced assignment', encode(sha256(convert_to(${hash} || id::text || assigned_chemist_id::text, 'UTF8')), 'hex') FROM assigned
    ) SELECT count(*)::int AS count FROM assigned
  `;
}

async function assignInMemory(batch: BullionIntakeBatchRecord, user: AuthenticatedUser, env: EdgeApiEnv) {
  if (batch.status !== "sample_taken") return;
  const store = await getAuthStore(env);
  const staff = (await store?.listStaff(user) ?? []).filter((person) =>
    person.organizationId === batchOwners.get(batch.id) && person.role === "chemist" && person.status === "active");
  for (const item of batch.items.filter((item) => !item.assignedChemistId)) {
    const loads = staff.map((person) => ({ person, load: inMemoryBatches.flatMap((b) => b.items)
      .filter((i) => i.assignedChemistId === person.id && memoryExaminations.get(i.id)?.input.status !== "submitted").length }));
    const min = Math.min(...loads.map((entry) => entry.load));
    const eligible = loads.filter((entry) => entry.load === min);
    if (!eligible.length) return;
    const chosen = eligible[crypto.getRandomValues(new Uint32Array(1))[0] % eligible.length].person;
    item.assignedChemistId = chosen.id;
    item.assignedChemistName = chosen.fullName;
    item.assignedAt = new Date().toISOString();
  }
}

async function applyDailyChemistAssignmentInMemory(batch: BullionIntakeBatchRecord, user: AuthenticatedUser, env: EdgeApiEnv) {
  const assignment = memoryDailyChemistAssignments.get(dailyChemistKey(user.organizationId, mongoliaDate(batch.receivedAt || new Date())));
  const chemistIds = (batch.metal === "gold" ? assignment?.goldChemistIds : assignment?.silverChemistIds) ?? [];
  if (!chemistIds.length) return;
  const staff = await (await getAuthStore(env))?.listStaff(user) ?? [];
  const eligible = chemistIds.map((chemistId) => staff.find((person) => person.id === chemistId
    && person.organizationId === user.organizationId && person.role === "chemist" && person.status === "active"
    && !assignment?.vacationChemistIds.includes(chemistId))).filter((chemist): chemist is NonNullable<typeof chemist> => Boolean(chemist));
  for (const [index, item] of batch.items.filter((item) => !item.assignedChemistId).entries()) {
    const chemist = eligible[index % eligible.length];
    if (!chemist) return;
    item.assignedChemistId = chemist.id;
    item.assignedChemistName = chemist.fullName;
    item.assignedAt = new Date().toISOString();
  }
}

function customerSequenceQuery(customerId: string, user: AuthenticatedUser) {
  return sql`SELECT c.id, c.display_name AS "displayName", c.assay_center_id AS "organizationId", ''::text AS prefix,
      bullion.value AS "nextSequence", lpad(bullion.value::text, GREATEST(4, length(bullion.value::text)), '0') AS "nextNumber",
      numbering.registration_prefix || lpad(registration.value::text, GREATEST(4, length(registration.value::text)), '0') AS "nextRegistrationNumber",
      lpad(act.value::text, GREATEST(4, length(act.value::text)), '0') AS "nextActNumber",
      (SELECT (COALESCE(max(examination_number), 0) + 1)::text FROM bullion_intake_items) AS "nextAnalysisNumber"
    FROM customers c
    JOIN organizations o ON o.id = c.assay_center_id
    CROSS JOIN LATERAL (SELECT COALESCE(o.metadata->>'bullionPrefix', CASE WHEN o.type = 'private_assay_center' THEN '55' ELSE '' END) AS registration_prefix) numbering
    CROSS JOIN LATERAL (SELECT COALESCE(max(CASE WHEN i.bullion_no ~ '^[0-9]{1,12}$'
      THEN i.bullion_no::bigint END), 0) + 1 AS value
      FROM bullion_intake_items i JOIN bullion_intake_batches b ON b.id = i.batch_id
      WHERE b.assay_center_id = o.id) bullion
    CROSS JOIN LATERAL (SELECT COALESCE(max(CASE WHEN b.public_id ~ ('^' || numbering.registration_prefix || '[0-9]{4,12}$')
      THEN substring(b.public_id FROM length(numbering.registration_prefix) + 1)::bigint END), 0) + 1 AS value
      FROM bullion_intake_batches b WHERE b.assay_center_id = o.id) registration
    CROSS JOIN LATERAL (SELECT COALESCE(max(CASE WHEN b.act_number ~ '^[0-9]{1,12}$'
      THEN b.act_number::bigint END), 0) + 1 AS value
      FROM bullion_intake_batches b WHERE b.assay_center_id = o.id) act
    WHERE c.id = ${customerId} AND (${user.role} = 'system_admin' OR c.assay_center_id = ${user.organizationId})`;
}

function memoryNextNumber(user: AuthenticatedUser): { prefix: string; value: number } {
  const issued = inMemoryBatches.filter((batch) => batchOwners.get(batch.id) === user.organizationId)
    .flatMap((batch) => batch.items).map((item) => /^[0-9]{1,12}$/.test(item.bullionNo) ? Number(item.bullionNo) : 0);
  return { prefix: "", value: issued.reduce((max, value) => Math.max(max, value), 0) + 1 };
}

function memoryNextRegistrationNumber(user: AuthenticatedUser): { prefix: string; value: number } {
  const prefix = user.organizationType === "private_assay_center" ? "55" : "";
  const issued = inMemoryBatches.filter((batch) => batchOwners.get(batch.id) === user.organizationId)
    .map((batch) => new RegExp(`^${prefix}[0-9]{4,12}$`).test(batch.publicId) ? Number(batch.publicId.slice(prefix.length)) : 0);
  return { prefix, value: issued.reduce((max, value) => Math.max(max, value), 0) + 1 };
}

function memoryNextActNumber(user: AuthenticatedUser): string {
  const value = inMemoryBatches.filter((batch) => batchOwners.get(batch.id) === user.organizationId)
    .map((batch) => /^[0-9]{1,12}$/.test(batch.actNumber ?? "") ? Number(batch.actNumber) : 0)
    .reduce((max, current) => Math.max(max, current), 0) + 1;
  return formatBullionNumber("", value);
}

bullionRoutes.get("/intakes/next-number", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!INTAKE_ROLES.has(user.role)) return c.json({ ok: false }, 403);
  const customerId = c.req.query("customerId") || "";
  if (!isUuid(customerId)) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) {
    if (!localCustomerForCenter(customerId, user)) return c.json({ ok: false }, 404);
    const next = memoryNextNumber(user);
    return c.json({ ok: true, nextNumber: formatBullionNumber(next.prefix, next.value), prefix: next.prefix, nextActNumber: memoryNextActNumber(user), nextAnalysisNumber: String(nextMemoryExaminationNumber) });
  }
  const customer = readRows(await createDatabase(c.env.DATABASE_URL).execute<{ nextNumber: string; prefix: string; nextActNumber: string; nextAnalysisNumber: string }>(customerSequenceQuery(customerId, user)))[0];
  if (!customer) return c.json({ ok: false }, 404);
  return c.json({ ok: true, nextNumber: customer.nextNumber, prefix: customer.prefix, nextActNumber: customer.nextActNumber, nextAnalysisNumber: customer.nextAnalysisNumber });
});

bullionRoutes.get("/intakes/daily-chemist-assignment", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const date = text(c.req.query("date")) || localDate();
  if (!isIsoDate(date)) return c.json({ ok: false, message: "Огноог YYYY-MM-DD хэлбэрээр оруулна уу." }, 400);
  if (!c.env.DATABASE_URL) {
    const staff = (await (await getAuthStore(c.env))?.listStaff(user) ?? []).filter((person) => person.organizationId === user.organizationId && person.role === "chemist");
    const assignment = memoryDailyChemistAssignments.get(dailyChemistKey(user.organizationId, date));
    return c.json({ ok: true, data: { date, goldChemistIds: assignment?.goldChemistIds ?? [], silverChemistIds: assignment?.silverChemistIds ?? [],
      chemists: staff.map((person) => ({ id: person.id, fullName: person.fullName, status: person.status, onVacation: assignment?.vacationChemistIds.includes(person.id) ?? false })) } });
  }
  const db = createDatabase(c.env.DATABASE_URL);
  const [chemists, assignments] = await Promise.all([
    db.execute<{ id: string; fullName: string; status: string; onVacation: boolean }>(sql`
      SELECT u.id, u.full_name AS "fullName", u.status,
        COALESCE(availability.is_on_vacation, false) AS "onVacation"
      FROM users u LEFT JOIN chemist_daily_availability availability ON availability.organization_id = u.organization_id
        AND availability.chemist_id = u.id AND availability.assignment_date = ${date}::date
      WHERE u.organization_id = ${user.organizationId}::uuid AND u.role = 'chemist' ORDER BY u.full_name, u.id`),
    db.execute<{ metal: "gold" | "silver"; chemistId: string }>(sql`
      SELECT metal, chemist_id AS "chemistId" FROM bullion_daily_chemist_assignments
      WHERE organization_id = ${user.organizationId}::uuid AND assignment_date = ${date}::date`),
  ]);
  const selected = readRows(assignments);
  return c.json({ ok: true, data: { date,
    goldChemistIds: selected.filter((assignment) => assignment.metal === "gold").map((assignment) => assignment.chemistId),
    silverChemistIds: selected.filter((assignment) => assignment.metal === "silver").map((assignment) => assignment.chemistId),
    chemists: readRows(chemists),
  } });
});

bullionRoutes.put("/intakes/daily-chemist-assignment", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const body = object(await c.req.json().catch(() => null));
  const date = text(body.date) || localDate();
  const goldChemistIds = Array.isArray(body.goldChemistIds) ? [...new Set(body.goldChemistIds.map(text).filter(isUuid))] : [];
  const silverChemistIds = Array.isArray(body.silverChemistIds) ? [...new Set(body.silverChemistIds.map(text).filter(isUuid))] : [];
  const vacationChemistIds = Array.isArray(body.vacationChemistIds) ? [...new Set(body.vacationChemistIds.map(text).filter(isUuid))] : [];
  if (!isIsoDate(date) || Object.keys(body).some((key) => !["date", "goldChemistIds", "silverChemistIds", "vacationChemistIds"].includes(key))) return c.json({ ok: false }, 400);
  const selectedIds = [...new Set([...goldChemistIds, ...silverChemistIds])];
  if (selectedIds.some((id) => vacationChemistIds.includes(id))) return c.json({ ok: false, message: "Амралттай химичийг өдөр тутмын хуваарьт сонгох боломжгүй." }, 400);
  if (!c.env.DATABASE_URL) {
    const staff = await (await getAuthStore(c.env))?.listStaff(user) ?? [];
    const validIds = new Set(staff.filter((person) => person.organizationId === user.organizationId && person.role === "chemist" && person.status === "active").map((person) => person.id));
    if ([...selectedIds, ...vacationChemistIds].some((id) => !validIds.has(id))) return c.json({ ok: false, message: "Сонгосон химич идэвхтэй биш байна." }, 400);
    memoryDailyChemistAssignments.set(dailyChemistKey(user.organizationId, date), { goldChemistIds, silverChemistIds, vacationChemistIds });
    return c.json({ ok: true });
  }
  const db = createDatabase(c.env.DATABASE_URL);
  const activeChemists = readRows(await db.execute<{ id: string }>(sql`SELECT id FROM users WHERE organization_id = ${user.organizationId}::uuid AND role = 'chemist' AND status = 'active'`));
  const activeIds = new Set(activeChemists.map((chemist) => chemist.id));
  if ([...selectedIds, ...vacationChemistIds].some((id) => !activeIds.has(id))) return c.json({ ok: false, message: "Сонгосон химич идэвхтэй биш байна." }, 400);
  const assignments = [
    ...goldChemistIds.map((chemistId) => ({ metal: "gold", chemistId })),
    ...silverChemistIds.map((chemistId) => ({ metal: "silver", chemistId })),
  ];
  await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute(sql`DELETE FROM chemist_daily_availability WHERE organization_id = ${user.organizationId}::uuid AND assignment_date = ${date}::date`),
    db.execute(sql`INSERT INTO chemist_daily_availability (organization_id, chemist_id, assignment_date, is_on_vacation, updated_by_user_id)
      SELECT ${user.organizationId}::uuid, record."chemistId"::uuid, ${date}::date, true, ${user.id}::uuid
      FROM jsonb_to_recordset(${JSON.stringify(vacationChemistIds.map((chemistId) => ({ chemistId })))}::jsonb) AS record("chemistId" text)`),
    db.execute(sql`DELETE FROM bullion_daily_chemist_assignments WHERE organization_id = ${user.organizationId}::uuid AND assignment_date = ${date}::date`),
    db.execute(sql`INSERT INTO bullion_daily_chemist_assignments (organization_id, assignment_date, metal, chemist_id, updated_by_user_id)
      SELECT ${user.organizationId}::uuid, ${date}::date, record.metal::metal_type, record."chemistId"::uuid, ${user.id}::uuid
      FROM jsonb_to_recordset(${JSON.stringify(assignments)}::jsonb) AS record(metal text, "chemistId" text)`),
  ]);
  await appendAuditLog(db, user, "bullion_daily_chemist_assignment.updated", "organizations", user.organizationId, { date, goldChemistIds, silverChemistIds, vacationChemistIds });
  return c.json({ ok: true });
});

bullionRoutes.get("/intakes", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!INTAKE_ROLES.has(user.role)) {
    return c.json({ ok: false, message: "Гулдмайн бүртгэл харах эрхгүй байна." }, 403);
  }

  const data = c.env.DATABASE_URL
    ? await listIntakesFromDatabase(createDatabase(c.env.DATABASE_URL), user)
    : visibleBatches(user);
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
  if (user.role === "intake_officer" && (input.status === "sample_taken" || input.items.some((item) => item.sampleWeightMilligrams != null))) {
    return c.json({ ok: false, message: "Дээжийн жинг зөвхөн лабораторийн эрхлэгч оруулна." }, 403);
  }
  if (!c.env.DATABASE_URL && !localCustomerForCenter(input.customerId, user)) return c.json({ ok: false }, 404);

  const record = c.env.DATABASE_URL
    ? await createIntakeInDatabase(createDatabase(c.env.DATABASE_URL), user, input)
    : createIntakeInMemory(user, input);
  if (record === "customer_not_found") {
    return c.json({ ok: false, message: "Сонгосон харилцагч олдсонгүй." }, 404);
  }
  if (!c.env.DATABASE_URL) {
    await applyDailyChemistAssignmentInMemory(record, user, c.env);
    await assignInMemory(record, user, c.env);
  }
  return c.json({ ok: true, record }, 201);
});

bullionRoutes.get("/jewelry-catalogue", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!INTAKE_ROLES.has(user.role)) return c.json({ ok: false, message: "Эдлэлийн ангилал харах эрхгүй байна." }, 403);
  if (!c.env.DATABASE_URL) return c.json({ ok: true, data: [] });
  const rows = readRows(await createDatabase(c.env.DATABASE_URL).execute<{ name: string; metal: "gold" | "silver"; spoonType: "Халбагатай" | "Халбагагүй" }>(sql`
    SELECT item_name AS name, metal, spoon_type AS "spoonType" FROM jewelry_item_catalogue ORDER BY item_name
  `));
  return c.json({ ok: true, data: rows });
});

bullionRoutes.get("/jewelry-price-rules", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!INTAKE_ROLES.has(user.role)) return c.json({ ok: false, message: "Үнийн хүснэгт харах эрхгүй байна." }, 403);
  if (!c.env.DATABASE_URL) return c.json({ ok: true, data: [] });
  const rows = readRows(await createDatabase(c.env.DATABASE_URL).execute<JewelryServicePriceRule>(sql`
    SELECT id, service_code AS "serviceCode", metal_scope AS metal,
      min_weight_grams::float AS "minWeightGrams", max_weight_grams::float AS "maxWeightGrams",
      price_mnt::float AS "priceMnt", effective_from::text AS "effectiveFrom"
    FROM service_price_rules
    WHERE active = true AND effective_from <= CURRENT_DATE
      AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
      AND service_code IN ('gold_jewelry_analysis', 'silver_jewelry_analysis', 'gold_hallmark', 'silver_hallmark', 'gold_laser', 'silver_laser')
    ORDER BY metal_scope, min_weight_grams NULLS FIRST
  `));
  return c.json({ ok: true, data: rows });
});

bullionRoutes.get("/jewelry-intakes", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!INTAKE_ROLES.has(user.role)) return c.json({ ok: false, message: "Эдлэлийн бүртгэл харах эрхгүй байна." }, 403);
  if (!c.env.DATABASE_URL) return c.json({ ok: true, data: inMemoryJewelryIntakes.filter((record) => record.assayCenterId === user.organizationId) });
  const records = readRows(await createDatabase(c.env.DATABASE_URL).execute<JewelryIntakeRecord>(sql`
    SELECT j.id, j.assay_center_id AS "assayCenterId", j.customer_id AS "customerId", c.display_name AS "customerName",
      j.received_at AS "receivedAt", j.item_name AS "itemName", j.metal, j.spoon_type AS "spoonType",
      j.quality_kind AS "qualityKind", j.quality_value::float AS "qualityValue", j.weight_band AS "weightBand",
      j.total_weight_grams::float AS "totalWeightGrams", j.piece_count AS "pieceCount",
      j.marking_service AS "markingService",
      j.calculated_service_price_mnt::float AS "calculatedServicePriceMnt", u.full_name AS "receivedByName", j.created_at AS "createdAt"
    FROM jewelry_intake_records j
    JOIN customers c ON c.id = j.customer_id
    JOIN users u ON u.id = j.received_by_user_id
    WHERE j.assay_center_id = ${user.organizationId}::uuid
    ORDER BY j.created_at DESC LIMIT 100
  `));
  return c.json({ ok: true, data: records });
});

bullionRoutes.post("/jewelry-intakes", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!INTAKE_ROLES.has(user.role)) return c.json({ ok: false, message: "Эдлэл бүртгэх эрхгүй байна." }, 403);
  const input = normalizeJewelryIntake(await c.req.json().catch(() => null));
  const validation = validateJewelryIntake(input);
  if (validation) return c.json({ ok: false, message: validation }, 400);

  if (!c.env.DATABASE_URL) {
    if (!localCustomerForCenter(input.customerId, user)) return c.json({ ok: false }, 404);
    const record: JewelryIntakeRecord = { ...input, id: crypto.randomUUID(), assayCenterId: user.organizationId, receivedByName: user.fullName, createdAt: new Date().toISOString(), calculatedServicePriceMnt: fallbackJewelryServicePrice(input.metal, input.totalWeightGrams, input.pieceCount, input.markingService) };
    inMemoryJewelryIntakes.push(record);
    return c.json({ ok: true, record }, 201);
  }

  const db = createDatabase(c.env.DATABASE_URL);
  const serviceCode = input.metal === "gold" ? "gold_jewelry_analysis" : "silver_jewelry_analysis";
  const priceRow = readRows(await db.execute<{ priceMnt: number }>(sql`
    SELECT price_mnt::float AS "priceMnt" FROM service_price_rules
    WHERE active = true AND service_code = ${serviceCode} AND metal_scope = ${input.metal}
      AND effective_from <= ${input.receivedAt}::date
      AND (effective_to IS NULL OR effective_to >= ${input.receivedAt}::date)
      AND (min_weight_grams IS NULL OR min_weight_grams <= ${input.totalWeightGrams})
      AND (max_weight_grams IS NULL OR max_weight_grams >= ${input.totalWeightGrams})
    ORDER BY effective_from DESC, min_weight_grams DESC NULLS LAST LIMIT 1
  `))[0];
  if (!priceRow) return c.json({ ok: false, message: "Энэ эдлэлийн үйлчилгээний үнэ тохируулагдаагүй байна." }, 422);
  const markingCodes = input.markingService === "both" ? [`${input.metal}_hallmark`, `${input.metal}_laser`] : input.markingService === "none" ? [] : [`${input.metal}_${input.markingService}`];
  const markingRows: Array<{ priceMnt: number } | undefined> = [];
  for (const code of markingCodes) {
    markingRows.push(readRows(await db.execute<{ priceMnt: number }>(sql`
      SELECT price_mnt::float AS "priceMnt" FROM service_price_rules
      WHERE active = true AND metal_scope = ${input.metal} AND service_code = ${code}
        AND effective_from <= ${input.receivedAt}::date
        AND (effective_to IS NULL OR effective_to >= ${input.receivedAt}::date)
      ORDER BY effective_from DESC LIMIT 1
    `))[0]);
  }
  if (markingRows.length !== markingCodes.length || markingRows.some((row) => !row)) return c.json({ ok: false, message: "Сонгосон баталгааны тэмдгийн үнэ тохируулагдаагүй байна." }, 422);
  const calculatedServicePriceMnt = priceRow.priceMnt + markingRows.reduce((total, row) => total + (row?.priceMnt ?? 0), 0) * input.pieceCount;
  const id = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const now = new Date().toISOString();
  const entryHash = await sha256Base64Url(JSON.stringify({ auditId, id, actor: user.id, input, now }));
  const result = await db.execute<{ id: string }>(sql`
    WITH customer AS (
      SELECT id FROM customers
      WHERE id = ${input.customerId}::uuid AND assay_center_id = ${user.organizationId}::uuid
    ), catalogue AS (
      SELECT item_name, metal, spoon_type FROM jewelry_item_catalogue
      WHERE item_name = ${input.itemName} AND metal = ${input.metal}::metal_type AND spoon_type = ${input.spoonType}
    ), inserted AS (
      INSERT INTO jewelry_intake_records (
        id, assay_center_id, customer_id, received_by_user_id, received_at, item_name, metal, spoon_type,
        quality_kind, quality_value, weight_band, total_weight_grams, piece_count, marking_service, calculated_service_price_mnt
      ) SELECT ${id}::uuid, ${user.organizationId}::uuid, customer.id, ${user.id}::uuid,
        ${input.receivedAt}::timestamptz, ${input.itemName}, ${input.metal}::metal_type, ${input.spoonType},
        ${input.qualityKind}, ${input.qualityValue}, ${input.weightBand}, ${input.totalWeightGrams}, ${input.pieceCount}, ${input.markingService}, ${calculatedServicePriceMnt}
      FROM customer CROSS JOIN catalogue RETURNING id
    ), audited AS (
      INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, entry_hash)
      SELECT ${auditId}::uuid, ${user.id}::uuid, ${user.organizationId}::uuid,
        'jewelry_intake.created', 'jewelry_intake_records', inserted.id,
        jsonb_build_object(
          'itemName', ${input.itemName}::text,
          'metal', ${input.metal}::text,
          'pieceCount', ${input.pieceCount}::integer,
          'markingService', ${input.markingService}::text,
          'totalWeightGrams', ${input.totalWeightGrams}::numeric,
          'calculatedServicePriceMnt', ${calculatedServicePriceMnt}::numeric
        ),
        'Jewelry intake registered', ${entryHash} FROM inserted
    )
    SELECT id FROM inserted
  `);
  if (!readRows(result)[0]) return c.json({ ok: false, message: "Сонгосон харилцагч олдсонгүй." }, 404);
  const record: JewelryIntakeRecord = { ...input, id, assayCenterId: user.organizationId, receivedByName: user.fullName, createdAt: now, calculatedServicePriceMnt };
  return c.json({ ok: true, record }, 201);
});

bullionRoutes.patch("/intakes/:id", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!INTAKE_ROLES.has(user.role)) return c.json({ ok: false }, 403);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const id = c.req.param("id");
  const body = object(await c.req.json().catch(() => null));
  const rows = Array.isArray(body.items) ? body.items.map(object) : [];
  const manager = isCenterManager(user.role);
  const initialBullionNumber = text(body.initialBullionNumber).trim();
  const allowedBodyFields = manager ? ["items", "status", "initialBullionNumber"] : ["items", "status"];
  const allowedRowFields = manager ? ["id", "bullionNo", "grossWeightBeforeGrams", "grossWeightAfterGrams", "slagWeightGrams", "sampleWeightMilligrams"] : ["id", "grossWeightAfterGrams", "slagWeightGrams", "sampleWeightMilligrams"];
  if (!isUuid(id) || !rows.length || rows.length > 100 || !["draft", "ready_for_sampling", "sample_taken"].includes(text(body.status))
    || Object.keys(body).some((key) => !allowedBodyFields.includes(key))
    || (manager && !/^\d{1,12}$/.test(initialBullionNumber))
    || rows.some((row) => !isUuid(text(row.id)) || Object.keys(row).some((key) => !allowedRowFields.includes(key))
      || [row.grossWeightAfterGrams, row.slagWeightGrams, row.sampleWeightMilligrams].some((value) => value != null && (typeof value !== "number" || !Number.isFinite(value) || value < 0))
      || (manager && (!/^\d{1,12}$/.test(text(row.bullionNo)) || typeof row.grossWeightBeforeGrams !== "number" || !Number.isFinite(row.grossWeightBeforeGrams) || row.grossWeightBeforeGrams <= 0)))) {
    return c.json({ ok: false, message: "Жингийн утгыг зөв оруулна уу." }, 400);
  }
  if (user.role === "intake_officer" && (body.status === "sample_taken" || rows.some((row) => "sampleWeightMilligrams" in row))) return c.json({ ok: false }, 403);
  if (body.status === "ready_for_sampling" && rows.some((row) => Number(row.grossWeightAfterGrams ?? 0) <= 0)) return c.json({ ok: false, message: "Хайлалтын дараах жинг оруулна уу." }, 400);
  if (body.status === "sample_taken" && rows.some((row) => Number(row.sampleWeightMilligrams ?? 0) <= 0 || Number(row.grossWeightAfterGrams ?? 0) <= 0)) {
    return c.json({ ok: false, message: "Хайлалтын дараах жин, дээжийн жинг оруулна уу." }, 400);
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return c.json({ ok: false }, 400);
  const changes = rows.map((row) => ({ id: row.id, bullionNo: manager ? text(row.bullionNo) : null, before: manager ? row.grossWeightBeforeGrams : null,
    after: row.grossWeightAfterGrams ?? null, slag: row.slagWeightGrams ?? null, sample: row.sampleWeightMilligrams ?? null }));
  if (!c.env.DATABASE_URL) {
    const batch = visibleBatches(user).find((batch) => batch.id === id);
    if (!batch) return c.json({ ok: false }, 404);
    if ((!manager && batch.status !== "draft") || changes.length !== batch.items.length || batch.items.some((item) => !changes.some((change) => change.id === item.id))) return c.json({ ok: false }, 409);
    if (batch.items.some((item) => {
      const change = changes.find((candidate) => candidate.id === item.id)!;
      const before = change.before == null ? item.grossWeightBeforeGrams : Number(change.before);
      return (change.after != null && Number(change.after) > before)
        || (change.slag != null && change.after != null && Number(change.slag) > before - Number(change.after));
    })) return c.json({ ok: false, message: "Дараах жин өмнөх жингээс их, Шлак жин нь хайлалтын жингийн зөрүүнээс их байж болохгүй." }, 400);
    for (const item of batch.items) {
      const change = changes.find((change) => change.id === item.id)!;
      if (manager) { item.bullionNo = change.bullionNo ?? item.bullionNo; item.grossWeightBeforeGrams = Number(change.before); }
      item.grossWeightAfterGrams = change.after as number | undefined;
      item.slagWeightGrams = change.slag as number | undefined;
      if (manager) item.sampleWeightMilligrams = change.sample as number | undefined;
    }
    if (manager) batch.initialBullionNumber = initialBullionNumber;
    if (manager) batch.wasEdited = true;
    batch.status = body.status as "draft" | "ready_for_sampling" | "sample_taken";
    await assignInMemory(batch, user, c.env);
    return c.json({ ok: true, record: batch });
  }
  const db = createDatabase(c.env.DATABASE_URL);
  const eventId = crypto.randomUUID();
  const hash = await sha256Base64Url(JSON.stringify({ eventId, actor: user.id, id, initialBullionNumber: manager ? initialBullionNumber : null, changes, status: body.status }));
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute<{ id: string }>(sql`
    WITH incoming AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb)
      AS r(id uuid, bullion_no text, before numeric, after numeric, slag numeric, sample numeric)),
    target AS MATERIALIZED (
      SELECT b.id FROM bullion_intake_batches b WHERE b.id = ${id}
        AND (b.status = 'draft' OR ${manager})
        AND (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
        AND (SELECT count(*) FROM bullion_intake_items WHERE batch_id = b.id) = ${changes.length}
        AND NOT EXISTS (SELECT 1 FROM incoming r WHERE NOT EXISTS (SELECT 1 FROM bullion_intake_items i WHERE i.id = r.id AND i.batch_id = b.id))
        AND NOT EXISTS (SELECT 1 FROM incoming r JOIN bullion_intake_items i ON i.id = r.id WHERE r.after > COALESCE(r.before, i.gross_weight_before_grams) OR (r.slag IS NOT NULL AND r.after IS NOT NULL AND r.slag > COALESCE(r.before, i.gross_weight_before_grams) - r.after))
      FOR UPDATE
    ), previous AS MATERIALIZED (
      SELECT i.id, i.bullion_no, i.gross_weight_before_grams, i.gross_weight_after_grams, i.slag_weight_grams, i.sample_weight_milligrams, b.initial_bullion_number
      FROM bullion_intake_items i JOIN target t ON t.id = i.batch_id JOIN bullion_intake_batches b ON b.id = t.id
    ), changed AS (
      UPDATE bullion_intake_items i SET bullion_no = CASE WHEN ${manager} THEN r.bullion_no ELSE i.bullion_no END,
        gross_weight_before_grams = CASE WHEN ${manager} THEN r.before ELSE i.gross_weight_before_grams END,
        gross_weight_after_grams = r.after, slag_weight_grams = r.slag,
        sample_weight_milligrams = CASE WHEN ${manager} THEN r.sample ELSE i.sample_weight_milligrams END
      FROM incoming r WHERE i.id = r.id AND i.batch_id IN (SELECT id FROM target)
      RETURNING i.id, i.bullion_no, i.gross_weight_before_grams, i.gross_weight_after_grams, i.slag_weight_grams, i.sample_weight_milligrams
    ), batch AS (
      UPDATE bullion_intake_batches SET status = ${body.status}, initial_bullion_number = CASE WHEN ${manager} THEN ${initialBullionNumber} ELSE initial_bullion_number END, updated_at = now()
      WHERE id IN (SELECT id FROM target) AND (SELECT count(*) FROM changed) = ${changes.length} RETURNING id
    ), audit AS (
      INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, old_values, new_values, reason, entry_hash)
      SELECT ${eventId}, ${user.id}, ${user.organizationId}, 'bullion_intake.updated', 'bullion_intake_batches', batch.id,
        (SELECT jsonb_agg(to_jsonb(previous)) FROM previous), jsonb_build_object('status', ${body.status}::text, 'initialBullionNumber', CASE WHEN ${manager} THEN ${initialBullionNumber} ELSE NULL END, 'items', (SELECT jsonb_agg(to_jsonb(changed)) FROM changed)), 'Intake weights updated', ${hash} FROM batch
    ) SELECT id FROM batch
  `),
    db.execute(await assignmentQuery(id, user, eventId)),
  ]);
  const result = readRows(results[1]);
  if (!result.length) return c.json({ ok: false, message: "Бүртгэл өөрчлөгдсөн эсвэл жин буруу байна. Дараах жин өмнөх жингээс их, Шлак жингийн зөрүүнээс их байж болохгүй." }, 409);
  return c.json({ ok: true });
});

bullionRoutes.post("/intakes/:id/split", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const id = c.req.param("id");
  const body = object(await c.req.json().catch(() => null));
  const itemIds = Array.isArray(body.itemIds) ? body.itemIds.map(text) : [];
  if (!isUuid(id) || !itemIds.length || itemIds.length > 99 || new Set(itemIds).size !== itemIds.length || itemIds.some((itemId) => !isUuid(itemId))) {
    return c.json({ ok: false, message: "Тусгаарлах гулдмайг зөв сонгоно уу." }, 400);
  }

  if (!c.env.DATABASE_URL) {
    const source = visibleBatches(user).find((batch) => batch.id === id && batch.metal === "gold");
    const selected = source?.items.filter((item) => itemIds.includes(item.id)) ?? [];
    if (!source || selected.length !== itemIds.length || selected.length === source.items.length) {
      return c.json({ ok: false, message: "Тусгаарлах боломжтой гулдмай олдсонгүй." }, 409);
    }
    const firstBullion = memoryNextNumber(user);
    const registration = memoryNextRegistrationNumber(user);
    const now = new Date().toISOString();
    const split: BullionIntakeBatchRecord = {
      ...source,
      id: crypto.randomUUID(), publicId: formatBullionNumber(registration.prefix, registration.value),
      splitFromBatchId: source.id, receivedByName: user.fullName, actNumber: memoryNextActNumber(user), actDate: localDate(),
      initialBullionNumber: formatBullionNumber(firstBullion.prefix, firstBullion.value), pieceCount: selected.length, createdAt: now,
      items: selected.map((item, index) => ({ ...item, sequenceNo: index + 1, bullionNo: formatBullionNumber(firstBullion.prefix, firstBullion.value + index) })),
    };
    source.items = source.items.filter((item) => !itemIds.includes(item.id));
    source.pieceCount = source.items.length;
    source.wasEdited = true;
    inMemoryBatches.unshift(split);
    batchOwners.set(split.id, user.organizationId);
    return c.json({ ok: true, data: { id: split.id, publicId: split.publicId, actNumber: split.actNumber, initialBullionNumber: split.initialBullionNumber } }, 201);
  }

  const db = createDatabase(c.env.DATABASE_URL);
  const splitId = crypto.randomUUID();
  const parentAuditId = crypto.randomUUID();
  const childAuditId = crypto.randomUUID();
  const parentHash = await sha256Base64Url(JSON.stringify({ parentAuditId, sourceId: id, itemIds, actor: user.id, action: "bullion_intake.split" }));
  const childHash = await sha256Base64Url(JSON.stringify({ childAuditId, splitId, sourceId: id, itemIds, actor: user.id, action: "bullion_intake.split_created" }));
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute<{ id: string; publicId: string; actNumber: string; initialBullionNumber: string }>(sql`
      WITH requested AS MATERIALIZED (
        SELECT id::uuid FROM jsonb_array_elements_text(${JSON.stringify(itemIds)}::jsonb) AS requested(id)
      ), target AS MATERIALIZED (
        SELECT b.* FROM bullion_intake_batches b
        WHERE b.id = ${id}::uuid AND b.metal = 'gold'
          AND (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId}::uuid)
          AND NOT EXISTS (SELECT 1 FROM bullion_certificates certificate WHERE certificate.batch_id = b.id)
          AND (SELECT count(*) FROM bullion_intake_items item WHERE item.batch_id = b.id) > ${itemIds.length}
          AND (SELECT count(*) FROM bullion_intake_items item JOIN requested requested ON requested.id = item.id WHERE item.batch_id = b.id) = ${itemIds.length}
        FOR UPDATE
      ), selected AS MATERIALIZED (
        SELECT item.* FROM bullion_intake_items item
        JOIN requested requested ON requested.id = item.id
        JOIN target target ON target.id = item.batch_id
      ), sequence AS MATERIALIZED (
        SELECT target.*, customer.display_name AS "customerName",
          COALESCE(center.metadata->>'bullionPrefix', CASE WHEN center.type = 'private_assay_center' THEN '55' ELSE '' END) AS "registrationPrefix",
          COALESCE((SELECT max(CASE WHEN item.bullion_no ~ '^[0-9]{1,12}$' THEN item.bullion_no::bigint END)
            FROM bullion_intake_items item JOIN bullion_intake_batches batch ON batch.id = item.batch_id
            WHERE batch.assay_center_id = target.assay_center_id), 0) + 1 AS "nextBullion",
          COALESCE((SELECT max(CASE WHEN batch.public_id ~ ('^' || COALESCE(center.metadata->>'bullionPrefix', CASE WHEN center.type = 'private_assay_center' THEN '55' ELSE '' END) || '[0-9]{4,12}$')
            THEN substring(batch.public_id FROM length(COALESCE(center.metadata->>'bullionPrefix', CASE WHEN center.type = 'private_assay_center' THEN '55' ELSE '' END)) + 1)::bigint END)
            FROM bullion_intake_batches batch WHERE batch.assay_center_id = target.assay_center_id), 0) + 1 AS "nextRegistration",
          COALESCE((SELECT max(CASE WHEN batch.act_number ~ '^[0-9]{1,12}$' THEN batch.act_number::bigint END)
            FROM bullion_intake_batches batch WHERE batch.assay_center_id = target.assay_center_id), 0) + 1 AS "nextAct"
        FROM target
        JOIN customers customer ON customer.id = target.customer_id
        JOIN organizations center ON center.id = target.assay_center_id
      ), created AS (
        INSERT INTO bullion_intake_batches (
          id, public_id, assay_center_id, customer_id, received_by_user_id, metal, received_at,
          branch_name, province, district, dispatch_reference, split_from_batch_id, act_number, act_date,
          initial_bullion_number, piece_count, delta, silver_titer, status
        ) SELECT ${splitId}::uuid,
          sequence."registrationPrefix" || lpad(sequence."nextRegistration"::text, GREATEST(4, length(sequence."nextRegistration"::text)), '0'),
          sequence.assay_center_id, sequence.customer_id, ${user.id}::uuid, sequence.metal, sequence.received_at,
          sequence.branch_name, sequence.province, sequence.district, sequence.dispatch_reference, sequence.id,
          lpad(sequence."nextAct"::text, GREATEST(4, length(sequence."nextAct"::text)), '0'),
          (now() AT TIME ZONE 'Asia/Ulaanbaatar')::date,
          lpad(sequence."nextBullion"::text, GREATEST(4, length(sequence."nextBullion"::text)), '0'),
          (SELECT count(*) FROM selected), sequence.delta, sequence.silver_titer, sequence.status
        FROM sequence RETURNING id, public_id AS "publicId", act_number AS "actNumber", initial_bullion_number AS "initialBullionNumber"
      ), moved AS (
        UPDATE bullion_intake_items item
        SET batch_id = created.id,
          sequence_no = numbered."sequenceNo",
          bullion_no = lpad((sequence."nextBullion" + numbered."sequenceNo" - 1)::text,
            GREATEST(4, length((sequence."nextBullion" + numbered."sequenceNo" - 1)::text)), '0')
        FROM created
        CROSS JOIN sequence
        CROSS JOIN (SELECT id, row_number() OVER (ORDER BY sequence_no)::int AS "sequenceNo" FROM selected) numbered
        WHERE item.id = numbered.id
        RETURNING item.id, item.examination_number, item.bullion_no
      ), updated_parent AS (
        UPDATE bullion_intake_batches batch
        SET piece_count = piece_count - (SELECT count(*) FROM moved), updated_at = now()
        WHERE batch.id IN (SELECT id FROM target) AND (SELECT count(*) FROM moved) = ${itemIds.length}
        RETURNING batch.id
      ), parent_audit AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, entry_hash)
        SELECT ${parentAuditId}::uuid, ${user.id}::uuid, ${user.organizationId}::uuid,
          'bullion_intake.split', 'bullion_intake_batches', updated_parent.id,
          jsonb_build_object('splitBatchId', created.id, 'movedItemIds', ${JSON.stringify(itemIds)}::jsonb, 'retainedPieceCount', (SELECT count(*) FROM bullion_intake_items WHERE batch_id = updated_parent.id)),
          'Delayed bullion moved to a separate intake batch', ${parentHash}
        FROM updated_parent CROSS JOIN created
      ), child_audit AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, entry_hash)
        SELECT ${childAuditId}::uuid, ${user.id}::uuid, ${user.organizationId}::uuid,
          'bullion_intake.split_created', 'bullion_intake_batches', created.id,
          jsonb_build_object('splitFromBatchId', ${id}::uuid, 'retainedExaminationNumbers', (SELECT jsonb_agg(examination_number) FROM moved)),
          'Follow-up intake created for delayed examination', ${childHash}
        FROM created
      )
      SELECT id, "publicId", "actNumber", "initialBullionNumber" FROM created
    `),
  ]);
  const record = readRows(results[1])[0];
  if (!record) return c.json({ ok: false, message: "Энэ бүртгэлийг тусгаарлах боломжгүй байна. Гэрчилгээ үүссэн эсвэл өгөгдөл өөрчлөгдсөн байж болно." }, 409);
  return c.json({ ok: true, data: record }, 201);
});

bullionRoutes.post("/intakes/:id/assign", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) {
    const batch = visibleBatches(user).find((record) => record.id === id && record.status === "sample_taken");
    if (!batch) return c.json({ ok: false }, 404);
    await assignInMemory(batch, user, c.env);
  } else {
    const db = createDatabase(c.env.DATABASE_URL);
    await db.batch([db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`), db.execute(await assignmentQuery(id, user))]);
  }
  return c.json({ ok: true });
});

bullionRoutes.get("/intakes/:id/chemists", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const id = c.req.param("id");
  if (!isUuid(id)) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) {
    const batch = visibleBatches(user).find((b) => b.id === id);
    if (!batch) return c.json({ ok: false }, 404);
    const staff = await (await getAuthStore(c.env))!.listStaff(user);
    return c.json({ ok: true, data: staff.filter((p) => p.organizationId === batchOwners.get(id) && p.role === "chemist")
      .map((p) => ({ id: p.id, fullName: p.fullName, status: p.status })) });
  }
  const db = createDatabase(c.env.DATABASE_URL);
  const batch = readRows(await db.execute<{ assayCenterId: string }>(sql`SELECT assay_center_id AS "assayCenterId" FROM bullion_intake_batches
    WHERE id = ${id} AND (${user.role} = 'system_admin' OR assay_center_id = ${user.organizationId})`))[0];
  if (!batch) return c.json({ ok: false }, 404);
  const data = readRows(await db.execute(sql`SELECT id, full_name AS "fullName", status FROM users
    WHERE organization_id = ${batch.assayCenterId} AND role = 'chemist' ORDER BY full_name, id`));
  return c.json({ ok: true, data });
});

bullionRoutes.patch("/intakes/:id/assignment", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const id = c.req.param("id");
  const body = object(await c.req.json().catch(() => null));
  if (!isUuid(id) || !isUuid(text(body.itemId)) || !(body.chemistId === null || isUuid(text(body.chemistId)))
    || !(body.expectedChemistId === null || isUuid(text(body.expectedChemistId)))) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) {
    const staff = await (await getAuthStore(c.env))!.listStaff(user);
    const batch = visibleBatches(user).find((b) => b.id === id);
    const item = batch?.items.find((i) => i.id === body.itemId);
    const chemist = staff.find((p) => p.id === body.chemistId && p.role === "chemist" && p.status === "active" && p.organizationId === batchOwners.get(id));
    if (!item || (body.chemistId !== null && !chemist)) return c.json({ ok: false }, 404);
    if (batch!.status !== "sample_taken" || (item.assignedChemistId ?? null) !== body.expectedChemistId
      || memoryExaminations.get(item.id)?.input.status === "submitted") return c.json({ ok: false }, 409);
    item.assignedChemistId = chemist?.id ?? null; item.assignedChemistName = chemist?.fullName ?? null;
    item.assignedAt = chemist ? new Date().toISOString() : null;
    return c.json({ ok: true });
  }
  const db = createDatabase(c.env.DATABASE_URL);
  const eventId = crypto.randomUUID();
  const hash = await sha256Base64Url(JSON.stringify({ eventId, userId: user.id, id, body }));
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute(sql`
      WITH target AS MATERIALIZED (
        SELECT i.id, i.assigned_chemist_id FROM bullion_intake_items i
        JOIN bullion_intake_batches b ON b.id = i.batch_id
        LEFT JOIN users u ON u.id = ${body.chemistId}::uuid AND u.organization_id = b.assay_center_id
          AND u.role = 'chemist' AND u.status = 'active'
        WHERE b.id = ${id} AND i.id = ${body.itemId}::uuid AND b.status = 'sample_taken'
          AND (${body.chemistId}::uuid IS NULL OR u.id IS NOT NULL)
          AND (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
          AND i.assigned_chemist_id IS NOT DISTINCT FROM ${body.expectedChemistId}::uuid
          AND COALESCE((SELECT e.status::text FROM bullion_examination_revisions e WHERE e.bullion_item_id = i.id ORDER BY e.revision_no DESC LIMIT 1), 'draft') = 'draft'
        FOR UPDATE OF i
      ), updated AS (
        UPDATE bullion_intake_items SET assigned_chemist_id = ${body.chemistId}::uuid,
          assigned_at = CASE WHEN ${body.chemistId}::uuid IS NULL THEN NULL ELSE now() END
        WHERE id IN (SELECT id FROM target) RETURNING id
      ), audit AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, old_values, new_values, reason, entry_hash)
        SELECT ${eventId}, ${user.id}, ${user.organizationId}, 'bullion_sample.reassigned', 'bullion_intake_items', u.id,
          jsonb_build_object('assignedChemistId', t.assigned_chemist_id), jsonb_build_object('assignedChemistId', ${body.chemistId}::text),
          'Director changed sample assignment', ${hash} FROM updated u JOIN target t ON t.id = u.id
      ) SELECT id FROM updated
    `),
  ]);
  if (!readRows(results[1]).length) return c.json({ ok: false, message: "Хуваарилалт өөрчлөгдсөн, дүн илгээгдсэн эсвэл химич сонгох боломжгүй байна. Жагсаалтыг шинэчилнэ үү." }, 409);
  return c.json({ ok: true });
});

bullionRoutes.post("/examinations", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (user.role !== "chemist") {
    return c.json({ ok: false, message: "Шинжилгээний дүн оруулах эрхгүй байна." }, 403);
  }

  const input = normalizeExamination(await c.req.json().catch(() => null));
  const validation = validateExamination(input);
  if (validation) return c.json({ ok: false, message: validation }, 400);
  const sample = (await listSamples(c.env, user)).find((sample) => sample.id === input.bullionItemId);
  if (!sample) return c.json({ ok: false, message: "Дээж олдсонгүй." }, 404);
  if (!["pending", "draft"].includes(sample.status) || sample.revisionNo !== (input.expectedRevision ?? 0)) {
    return c.json({ ok: false, message: "Дүн өөрчлөгдсөн эсвэл хяналтад илгээгдсэн байна. Жагсаалтыг шинэчилнэ үү." }, 409);
  }
  input.examinationNo = sample.analysisNo;
  input.sampleWeightGrams = sample.sampleWeightMilligrams / 1000;
  input.delta = sample.delta;
  if (sample.metal === "gold") {
    const calculated = calculateBullion(input.weightEntries, input.sampleWeightGrams, sample.delta);
    if (input.status === "submitted" && (calculated.errors.length || calculated.goldResult == null || calculated.silverResult == null)) {
      return c.json({ ok: false, message: calculated.errors.join(" ") || "Мөнгөний сорьц бодох Нэмэлт мөрийг оруулна уу." }, 400);
    }
    input.weightEntries = calculated.weightEntries;
    input.goldResult = calculated.goldResult;
    input.silverResult = calculated.silverResult;
    input.measurementEntries = ["Чек мөнгө", "Дээжийн үлдэгдэл жин", "Шинжилгээний хорогдол", "Королько, корточка"].map((label, index) => ({
      label, reading: [input.measurementEntries[0]?.reading ?? 0, calculated.remainingMilligrams, calculated.lossMilligrams, calculated.returnedMilligrams][index],
    }));
  }
  if (sample.metal === "silver") {
    const calculated = calculateSilverBullion(input.weightEntries, input.sampleWeightGrams, {
      method: input.silverMethod ?? "titrimetric",
      titerMilligramsPerMilliliter: input.silverTiterMilligramsPerMilliliter ?? 0,
      // Blank volume is not part of the approved silver examination screen.
      blankVolumeMilliliters: undefined,
    });
    if (input.status === "submitted" && (calculated.errors.length || calculated.silverResult == null)) {
      return c.json({ ok: false, message: calculated.errors.join(" ") || "Мөнгөний сорьцыг бодож чадсангүй." }, 400);
    }
    input.weightEntries = calculated.weightEntries;
    input.goldResult = undefined;
    input.silverResult = calculated.silverResult;
    input.measurementEntries = calculated.weightEntries.map((entry, index) => ({
      label: `${index + 1}-р мөр`, reading: entry.outputWeightGrams, silverAssay: entry.silverAssay,
    }));
  }
  if (!c.env.DATABASE_URL) {
    if ((memoryExaminations.get(sample.id)?.revisionNo ?? 0) !== (input.expectedRevision ?? 0)) return c.json({ ok: false }, 409);
    const revisionNo = sample.revisionNo + 1;
    memoryExaminations.set(sample.id, { revisionNo, input, submittedAt: input.status === "submitted" ? new Date().toISOString() : null });
    return c.json({ ok: true, record: { ...input, revisionNo } }, 201);
  }

  const result = await createExaminationInDatabase(createDatabase(c.env.DATABASE_URL), user, input);
  if (result === "item_not_found") {
    return c.json({ ok: false, message: "Сонгосон гулдмай олдсонгүй." }, 404);
  }
  if (!result) return c.json({ ok: false, message: "Дүн өөрчлөгдсөн байна. Дахин ачаална уу." }, 409);
  return c.json({ ok: true, record: result }, 201);
});

async function listIntakesFromDatabase(db: AppDatabase, user: AuthenticatedUser): Promise<BullionIntakeBatchRecord[]> {
  const organizationFilter = user.role === "system_admin" ? sql`` : sql`WHERE b.assay_center_id = ${user.organizationId}`;
  const result = await db.execute<IntakeRow>(sql`
    SELECT b.id, b.public_id AS "publicId", b.metal, b.received_at AS "receivedAt", b.branch_name AS "branchName",
      b.province, b.district, b.dispatch_reference AS "dispatchReference", b.split_from_batch_id AS "splitFromBatchId", b.act_number AS "actNumber", b.act_date::text AS "actDate", b.initial_bullion_number AS "initialBullionNumber",
      b.piece_count AS "pieceCount", b.delta::float AS delta, b.silver_titer::float AS "silverTiter", b.status, b.created_at AS "createdAt",
      EXISTS (SELECT 1 FROM audit_logs audit WHERE audit.action IN ('bullion_intake.updated', 'bullion_intake.split') AND audit.entity_type = 'bullion_intake_batches' AND audit.entity_id = b.id) AS "wasEdited",
      c.id AS "customerId", c.display_name AS "customerName", u.full_name AS "receivedByName",
      COALESCE(json_agg(json_build_object('id', i.id, 'sequenceNo', i.sequence_no, 'analysisNo', i.examination_number::text,
        'bullionNo', i.bullion_no, 'grossWeightBeforeGrams', i.gross_weight_before_grams::float,
        'grossWeightAfterGrams', i.gross_weight_after_grams::float, 'slagWeightGrams', i.slag_weight_grams::float,
        'sampleWeightMilligrams', i.sample_weight_milligrams::float,
        'assignedChemistId', i.assigned_chemist_id, 'assignedChemistName', chemist.full_name,
        'assignedAt', i.assigned_at) ORDER BY i.sequence_no)
        FILTER (WHERE i.id IS NOT NULL), '[]'::json) AS items
    FROM bullion_intake_batches b
    JOIN customers c ON c.id = b.customer_id
    JOIN users u ON u.id = b.received_by_user_id
    LEFT JOIN bullion_intake_items i ON i.batch_id = b.id
    LEFT JOIN users chemist ON chemist.id = i.assigned_chemist_id
    ${organizationFilter}
    GROUP BY b.id, c.id, c.display_name, u.full_name
    ORDER BY b.created_at DESC LIMIT 100
  `);
  return readRows(result).map(mapIntakeRow);
}

async function createIntakeInDatabase(
  db: AppDatabase, user: AuthenticatedUser, input: CreateBullionIntakeInput,
): Promise<BullionIntakeBatchRecord | "customer_not_found"> {
  const now = new Date().toISOString();
  const batchId = crypto.randomUUID();
  const items = input.items.map((item, index) => ({ ...item, id: crypto.randomUUID(), sequenceNo: index + 1 }));
  const auditId = crypto.randomUUID();
  const entryHash = await sha256Base64Url(JSON.stringify({ auditId, batchId, actor: user.id, input, now }));
  // The separate lock statement ensures allocation reads a fresh snapshot after waiting.
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute<{ publicId: string; nextNumber: string; nextActNumber: string; displayName: string; examinationNumbers: Record<string, string>; bullionNumbers: Record<string, string> }>(sql`
      WITH customer AS (${customerSequenceQuery(input.customerId, user)}),
      created AS (
        INSERT INTO bullion_intake_batches (
          id, public_id, assay_center_id, customer_id, received_by_user_id, metal, received_at,
          branch_name, province, district, dispatch_reference, act_number, act_date, initial_bullion_number, piece_count, delta, silver_titer, status
        ) SELECT ${batchId}::uuid,
          c."nextRegistrationNumber",
          c."organizationId", c.id, ${user.id}::uuid, ${input.metal},
          ${input.receivedAt || now}::timestamptz, ${input.branchName || null}, ${input.province || null},
          ${input.district || null}, ${input.dispatchReference || null}, c."nextActNumber", ${input.actDate || null}::date, c."nextNumber",
          ${items.length}, ${input.delta ?? 0}, ${input.silverTiter ?? null}, ${input.status ?? "draft"}
        FROM customer c RETURNING *
      ), inserted_items AS (
        INSERT INTO bullion_intake_items (
          id, batch_id, sequence_no, bullion_no, gross_weight_before_grams,
          gross_weight_after_grams, slag_weight_grams, sample_weight_milligrams, assigned_chemist_id, assigned_at
        ) SELECT r.id, b.id, r."sequenceNo",
          lpad((c."nextSequence" + r."sequenceNo" - 1)::text, GREATEST(4, length((c."nextSequence" + r."sequenceNo" - 1)::text)), '0'),
          r."grossWeightBeforeGrams", r."grossWeightAfterGrams", r."slagWeightGrams", r."sampleWeightMilligrams",
          daily_assignment.chemist_id, CASE WHEN daily_assignment.chemist_id IS NULL THEN NULL ELSE now() END
        FROM created b JOIN customer c ON c.id = b.customer_id CROSS JOIN jsonb_to_recordset(${JSON.stringify(items)}::jsonb)
          AS r(id uuid, "sequenceNo" int, "grossWeightBeforeGrams" numeric,
            "grossWeightAfterGrams" numeric, "slagWeightGrams" numeric, "sampleWeightMilligrams" numeric)
        LEFT JOIN LATERAL (
          SELECT eligible.chemist_id FROM (
            SELECT assignment.chemist_id, row_number() OVER (ORDER BY assignment.chemist_id) AS position,
              count(*) OVER () AS total
            FROM bullion_daily_chemist_assignments assignment
            JOIN users chemist ON chemist.id = assignment.chemist_id AND chemist.organization_id = b.assay_center_id
              AND chemist.role = 'chemist' AND chemist.status = 'active'
            LEFT JOIN chemist_daily_availability availability ON availability.organization_id = assignment.organization_id
              AND availability.chemist_id = assignment.chemist_id AND availability.assignment_date = assignment.assignment_date
            WHERE assignment.organization_id = b.assay_center_id AND assignment.metal = b.metal
              AND assignment.assignment_date = (b.received_at AT TIME ZONE 'Asia/Ulaanbaatar')::date
              AND NOT COALESCE(availability.is_on_vacation, false)
          ) eligible
          WHERE eligible.position = (((r."sequenceNo" - 1)::bigint % eligible.total) + 1)
        ) daily_assignment ON true
        ORDER BY r."sequenceNo"
        RETURNING id, examination_number, bullion_no
      ), audited AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, entry_hash)
        SELECT ${auditId}::uuid, ${user.id}::uuid, ${user.organizationId}::uuid,
          'bullion_intake.created', 'bullion_intake_batches', b.id,
          jsonb_build_object('publicId', b.public_id, 'pieceCount', (SELECT count(*) FROM inserted_items)),
          'Bullion workflow action', ${entryHash} FROM created b
      )
      SELECT b.public_id AS "publicId", b.initial_bullion_number AS "nextNumber", c."nextActNumber", c."displayName",
        (SELECT json_object_agg(id, examination_number::text) FROM inserted_items) AS "examinationNumbers",
        (SELECT json_object_agg(id, bullion_no) FROM inserted_items) AS "bullionNumbers"
      FROM created b JOIN customer c ON c.id = b.customer_id
    `),
    db.execute(await assignmentQuery(batchId, user)),
  ]);
  const allocated = readRows(results[1])[0];
  if (!allocated) return "customer_not_found";
  return {
    id: batchId, publicId: allocated.publicId, customerId: input.customerId, customerName: allocated.displayName,
    receivedByName: user.fullName, metal: input.metal, receivedAt: input.receivedAt || now,
    branchName: input.branchName, province: input.province, district: input.district,
    dispatchReference: input.dispatchReference, actNumber: allocated.nextActNumber, actDate: input.actDate, initialBullionNumber: allocated.nextNumber,
    pieceCount: items.length, delta: input.delta, silverTiter: input.silverTiter ?? null, status: input.status, createdAt: now,
    items: items.map((item) => ({ ...item, bullionNo: allocated.bullionNumbers[item.id], analysisNo: allocated.examinationNumbers[item.id] })),
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
  if (item.nextRevisionNo !== (input.expectedRevision ?? 0) + 1) return null;
  const id = crypto.randomUUID();
  const results = await db.batch([db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`), db.execute<{ id: string }>(sql`
    INSERT INTO bullion_examination_revisions (
      id, bullion_item_id, revision_no, examination_no, entered_by_user_id, status, delta, sample_weight_grams,
      weight_entries, measurement_entries, gold_result, silver_result, silver_method, silver_titer_mg_per_ml, silver_blank_volume_ml, reexamination_requested, notes, submitted_at
    ) SELECT ${id}, ${item.id}, ${item.nextRevisionNo}, ${input.examinationNo}, ${user.id}, ${input.status},
      ${input.delta ?? 0}, ${input.sampleWeightGrams}, ${JSON.stringify(input.weightEntries)}::jsonb,
      ${JSON.stringify(input.measurementEntries)}::jsonb, ${input.goldResult ?? null}, ${input.silverResult ?? null},
      ${input.silverMethod ?? null}, ${input.silverTiterMilligramsPerMilliliter ?? null}, ${input.silverBlankVolumeMilliliters ?? null},
      ${input.reexaminationRequested ?? false}, ${input.notes || null},
      ${input.status === "submitted" ? new Date() : null}
    FROM bullion_intake_items i WHERE i.id = ${item.id}
      AND (${user.role} <> 'chemist' OR i.assigned_chemist_id = ${user.id})
      AND COALESCE((SELECT e.status::text FROM bullion_examination_revisions e WHERE e.bullion_item_id = i.id ORDER BY revision_no DESC LIMIT 1), 'draft') = 'draft'
    ON CONFLICT (bullion_item_id, revision_no) DO NOTHING RETURNING id
  `)]);
  const inserted = readRows(results[1]);
  if (!inserted.length) return null;
  await appendAuditLog(db, user, "bullion_examination.saved", "bullion_examination_revisions", id, { bullionItemId: item.id, revisionNo: item.nextRevisionNo, status: input.status });
  return { id, ...input, revisionNo: item.nextRevisionNo };
}

function createIntakeInMemory(user: AuthenticatedUser, input: CreateBullionIntakeInput): BullionIntakeBatchRecord {
  const initialNumber = memoryNextNumber(user);
  const registrationNumber = memoryNextRegistrationNumber(user);
  const now = new Date().toISOString();
  const record: BullionIntakeBatchRecord = {
    id: crypto.randomUUID(), publicId: formatBullionNumber(registrationNumber.prefix, registrationNumber.value),
    customerId: input.customerId, customerName: "Харилцагч", receivedByName: user.fullName, metal: input.metal,
    receivedAt: input.receivedAt ?? now, branchName: input.branchName, province: input.province, district: input.district,
    dispatchReference: input.dispatchReference, actNumber: memoryNextActNumber(user), actDate: input.actDate, initialBullionNumber: input.initialBullionNumber,
    pieceCount: input.items.length, delta: input.delta, silverTiter: input.silverTiter ?? null, status: input.status, createdAt: now,
    items: input.items.map((item, index) => ({ ...item, id: crypto.randomUUID(), sequenceNo: index + 1 })),
  };
  record.initialBullionNumber = formatBullionNumber(initialNumber.prefix, initialNumber.value);
  record.items = record.items.map((item, index) => ({ ...item, bullionNo: formatBullionNumber(initialNumber.prefix, initialNumber.value + index), analysisNo: String(nextMemoryExaminationNumber++) }));
  inMemoryBatches.unshift(record);
  batchOwners.set(record.id, user.organizationId);
  record.customerName = localCustomerForCenter(input.customerId, user)?.displayName ?? "Харилцагч";
  return record;
}

function normalizeIntake(value: unknown): CreateBullionIntakeInput {
  const body = object(value);
  return {
    customerId: text(body.customerId), metal: body.metal === "silver" ? "silver" : "gold", receivedAt: text(body.receivedAt),
    branchName: text(body.branchName), province: text(body.province), district: text(body.district), dispatchReference: text(body.dispatchReference), actNumber: text(body.actNumber), actDate: text(body.actDate),
    initialBullionNumber: text(body.initialBullionNumber), delta: number(body.delta), silverTiter: number(body.silverTiter), status: body.status === "sample_taken" ? "sample_taken" : body.status === "ready_for_sampling" ? "ready_for_sampling" : "draft",
    items: Array.isArray(body.items) ? body.items.map((item) => {
      const row = object(item);
      const after = number(row.grossWeightAfterGrams);
      return { analysisNo: text(row.analysisNo), bullionNo: text(row.bullionNo), grossWeightBeforeGrams: number(row.grossWeightBeforeGrams) ?? 0,
        grossWeightAfterGrams: after, slagWeightGrams: number(row.slagWeightGrams), sampleWeightMilligrams: number(row.sampleWeightMilligrams) };
    }) : [],
  };
}

function normalizeJewelryIntake(value: unknown): CreateJewelryIntakeInput {
  const body = object(value);
  return {
    customerId: text(body.customerId), receivedAt: text(body.receivedAt), itemName: text(body.itemName),
    metal: text(body.metal) === "silver" ? "silver" : "gold",
    spoonType: text(body.spoonType) === "Халбагатай" ? "Халбагатай" : "Халбагагүй",
    qualityKind: text(body.qualityKind) === "titer" ? "titer" : "delta",
    qualityValue: typeof body.qualityValue === "number" ? body.qualityValue : Number.NaN,
    weightBand: text(body.weightBand), totalWeightGrams: typeof body.totalWeightGrams === "number" ? body.totalWeightGrams : Number.NaN,
    pieceCount: typeof body.pieceCount === "number" ? body.pieceCount : Number.NaN,
    markingService: ["hallmark", "laser", "both"].includes(text(body.markingService)) ? text(body.markingService) as "hallmark" | "laser" | "both" : "none",
  };
}

function validateJewelryIntake(input: CreateJewelryIntakeInput): string | null {
  const weightBands = new Set(["0-10 гр", "10-50 гр", "50-100 гр", "100-500 гр", "500-1000 гр", "1000 гр дээш"]);
  if (!isUuid(input.customerId) || !input.receivedAt || input.itemName.length > 255 || !weightBands.has(input.weightBand)
    || !Number.isFinite(input.qualityValue) || !Number.isFinite(input.totalWeightGrams) || input.totalWeightGrams <= 0 || input.totalWeightGrams > 1000000
    || !Number.isInteger(input.pieceCount) || input.pieceCount < 1 || input.pieceCount > 10000
    || (input.metal === "gold" && input.qualityKind !== "delta") || (input.metal === "silver" && input.qualityKind !== "titer")) return "Эдлэлийн бүртгэлийн мэдээллийг зөв оруулна уу.";
  return null;
}

function fallbackJewelryServicePrice(metal: "gold" | "silver", totalWeightGrams: number, pieceCount: number, markingService: CreateJewelryIntakeInput["markingService"]) {
  const analysisPrice = metal === "silver" ? 25000 : totalWeightGrams <= 500 ? 50000 : totalWeightGrams <= 2000 ? 100000 : totalWeightGrams <= 4000 ? 150000 : totalWeightGrams <= 6000 ? 175000 : 250000;
  const hallmark = markingService === "hallmark" || markingService === "both" ? (metal === "gold" ? 2000 : 1000) * pieceCount : 0;
  const laser = markingService === "laser" || markingService === "both" ? (metal === "gold" ? 4000 : 2000) * pieceCount : 0;
  return analysisPrice + hallmark + laser;
}

function normalizeExamination(value: unknown): SubmitBullionExaminationInput {
  const body = object(value);
  return {
    calculationVersion: text(body.calculationVersion),
    bullionItemId: text(body.bullionItemId), examinationNo: text(body.examinationNo), sampleWeightGrams: number(body.sampleWeightGrams) ?? 0,
    expectedRevision: number(body.expectedRevision) ?? 0,
    delta: number(body.delta), status: body.status === "submitted" ? "submitted" : "draft",
    weightEntries: Array.isArray(body.weightEntries) ? body.weightEntries.map((entry) => {
      const row = object(entry); return { receivedWeightGrams: number(row.receivedWeightGrams) ?? 0,
        calculation: row.calculation === "yes" || row.calculation === "addition" ? row.calculation : "no", outputWeightGrams: number(row.outputWeightGrams) ?? 0, goldAssay: number(row.goldAssay), silverAssay: number(row.silverAssay) };
    }) : [],
    measurementEntries: Array.isArray(body.measurementEntries) ? body.measurementEntries.map((entry) => {
      const row = object(entry); return { label: text(row.label), reading: number(row.reading) ?? 0, goldAssay: number(row.goldAssay), silverAssay: number(row.silverAssay) };
    }) : [],
    goldResult: number(body.goldResult), silverResult: number(body.silverResult),
    silverMethod: body.silverMethod === "rhodanometric" ? "rhodanometric" : body.silverMethod === "titrimetric" ? "titrimetric" : undefined,
    silverTiterMilligramsPerMilliliter: number(body.silverTiterMilligramsPerMilliliter), silverBlankVolumeMilliliters: number(body.silverBlankVolumeMilliliters),
    reexaminationRequested: body.reexaminationRequested === true, notes: text(body.notes),
  };
}

function validateIntake(input: CreateBullionIntakeInput) {
  if (input.items.some((item) => item.grossWeightAfterGrams != null && item.grossWeightAfterGrams > item.grossWeightBeforeGrams)) return "Дараах жин өмнөх жингээс их байж болохгүй.";
  if (input.items.some((item) => item.slagWeightGrams != null && item.grossWeightAfterGrams != null && item.slagWeightGrams > item.grossWeightBeforeGrams - item.grossWeightAfterGrams)) return "Шлак жин нь хайлалтын жингийн зөрүүнээс их байж болохгүй.";
  if (input.status === "ready_for_sampling" && input.items.some((item) => (item.grossWeightAfterGrams ?? 0) <= 0)) return "Хайлалтын дараах жинг оруулна уу.";
  if (!isUuid(input.customerId)) return "Харилцагчийг сонгоно уу.";
  if (input.metal === "silver" && (!Number.isFinite(input.silverTiter) || (input.silverTiter ?? 0) <= 0)) return "Мөнгөний титрийг зөв оруулна уу.";
  if (!input.items.length || input.items.length > 100) return "1-100 гулдмайн мөр оруулна уу.";
  if (input.items.some((item) => item.grossWeightBeforeGrams <= 0)) return "Гулдмайн жинг зөв оруулна уу.";
  if (input.receivedAt && !Number.isFinite(Date.parse(input.receivedAt))) return "Огноог зөв оруулна уу.";
  if (input.actDate && (!/^\d{4}-\d{2}-\d{2}$/.test(input.actDate) || !Number.isFinite(Date.parse(input.actDate)))) return "Актны огноог зөв оруулна уу.";
  if (input.items.some((item) => item.bullionNo.length > 80 || (item.analysisNo?.length ?? 0) > 80
    || [item.grossWeightBeforeGrams, item.grossWeightAfterGrams, item.slagWeightGrams, item.sampleWeightMilligrams].some((value) => value != null && (!Number.isFinite(value) || value < 0 || value >= 10000000000)))) return "Жингийн утга буруу байна.";
  if (input.status === "sample_taken" && input.items.some((item) => (item.sampleWeightMilligrams ?? 0) <= 0 || (item.grossWeightAfterGrams ?? 0) <= 0)) return "Хайлалтын дараах жин, дээжийн жинг оруулна уу.";
  return null;
}
function validateExamination(input: SubmitBullionExaminationInput) {
  if (!isUuid(input.bullionItemId) || !input.examinationNo || input.sampleWeightGrams <= 0) return "Шинжилгээний дугаар, гулдмай, дээжийн жинг зөв оруулна уу.";
  if (!Number.isInteger(input.expectedRevision) || (input.expectedRevision ?? 0) < 0
    || [input.goldResult, input.silverResult].some((value) => value != null && (value < 0 || value > 1000))
    || input.weightEntries.some((entry) => entry.receivedWeightGrams < 0 || entry.outputWeightGrams < 0
      || (entry.goldAssay != null && (entry.goldAssay < 0 || entry.goldAssay > 1000))
      || (entry.silverAssay != null && (entry.silverAssay < 0 || entry.silverAssay > 1000))
      || (input.silverTiterMilligramsPerMilliliter != null && input.silverTiterMilligramsPerMilliliter <= 0)
      || (input.silverBlankVolumeMilliliters != null && input.silverBlankVolumeMilliliters <= 0))) return "Хэмжилтийн утга буруу байна.";
  return null;
}
async function appendAuditLog(db: AppDatabase, user: AuthenticatedUser, action: string, entityType: string, entityId: string, metadata: unknown) {
  const previous = readRows(await db.execute<{ entryHash: string | null }>(sql`SELECT entry_hash AS "entryHash" FROM audit_logs ORDER BY created_at DESC LIMIT 1`))[0]?.entryHash ?? null;
  const now = new Date();
  const hash = await sha256Base64Url(JSON.stringify({ userId: user.id, action, entityType, entityId, previous, now: now.toISOString() }));
  await db.execute(sql`INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, previous_hash, entry_hash, created_at)
    VALUES (${crypto.randomUUID()}, ${user.id}, ${user.organizationId}, ${action}, ${entityType}, ${entityId}, ${JSON.stringify(metadata)}::jsonb, 'Bullion workflow action', ${previous}, ${hash}, ${now})`);
}
function mapIntakeRow(row: IntakeRow): BullionIntakeBatchRecord { return { ...row, pieceCount: Number(row.pieceCount), delta: Number(row.delta), silverTiter: number(row.silverTiter) ?? null, receivedAt: iso(row.receivedAt), createdAt: iso(row.createdAt), items: Array.isArray(row.items) ? row.items : [] }; }
function iso(value: string | Date): string { return value instanceof Date ? value.toISOString() : value; }
function readRows<T>(result: T[] | { rows: T[] }): T[] { return Array.isArray(result) ? result : result.rows; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" ? value as Record<string, unknown> : {}; }
function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function number(value: unknown): number | undefined { const parsed = typeof value === "number" ? value : Number(value); return Number.isFinite(parsed) ? parsed : undefined; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isIsoDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)); }
function mongoliaDate(value: string | Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function localDate(): string { return mongoliaDate(); }
function dailyChemistKey(organizationId: string, date: string): string { return `${organizationId}:${date}`; }
type IntakeRow = Omit<BullionIntakeBatchRecord, "items" | "receivedAt" | "createdAt"> & { receivedAt: string | Date; createdAt: string | Date; items: BullionIntakeBatchRecord["items"]; };

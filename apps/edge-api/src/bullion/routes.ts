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
import { getAuthStore } from "../auth/auth-store";
import { localCustomerForCenter } from "../customers/routes";
import { formatBullionNumber } from "../../../../packages/shared/src/bullion-numbering";
import { isCenterManager } from "../../../../packages/shared/src/workspace-access";
import type { AnonymousSample } from "../../../../packages/shared/src/bullion-types";
import { calculateBullion, BULLION_CALCULATION_VERSION } from "../../../../packages/shared/src/bullion-calculation";
import { requestCertificate } from "./certificates";

export const bullionRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

const INTAKE_ROLES = new Set(["system_admin", "assay_admin", "lab_manager", "intake_officer"]);
const EXAMINATION_ROLES = new Set(["system_admin", "assay_admin", "chemist", "lab_manager"]);
const inMemoryBatches: BullionIntakeBatchRecord[] = [];
let nextMemoryExaminationNumber = 1;
const batchOwners = new Map<string, string>();
const memoryExaminations = new Map<string, { revisionNo: number; input: SubmitBullionExaminationInput; submittedAt: string | null }>();
const memorySubstitutions = new Map<string, { byName: string; transferredAt: string; recipientId: string }>();
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
  return c.json({ ok: true, data: user.role === "chemist" ? samples.filter((sample) => sample.status !== "approved") : samples });
});

bullionRoutes.get("/samples/:id/print-chemists", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (user.role !== "chemist") return c.json({ ok: false }, 403);
  const sample = (await listSamples(c.env, user)).find((s) => s.id === c.req.param("id"));
  if (!sample) return c.json({ ok: false }, 404);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "Хэвлэхэд өгөгдлийн сан шаардлагатай." }, 503);
  const data = readRows(await createDatabase(c.env.DATABASE_URL).execute(sql`
    SELECT u.id, u.full_name AS "fullName" FROM users u
    JOIN bullion_intake_batches b ON b.assay_center_id = u.organization_id
    JOIN bullion_intake_items i ON i.batch_id = b.id
    WHERE i.id = ${sample.id} AND u.role = 'chemist' AND u.status = 'active' ORDER BY u.full_name, u.id
  `));
  return c.json({ ok: true, data });
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

bullionRoutes.post("/samples/:id/print", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (user.role !== "chemist") return c.json({ ok: false }, 403);
  const sample = (await listSamples(c.env, user)).find((s) => s.id === c.req.param("id"));
  if (!sample) return c.json({ ok: false }, 404);
  if (sample.status !== "submitted") return c.json({ ok: false, message: "Эхлээд дүнг хяналтад илгээнэ үү." }, 409);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "Хэвлэхэд өгөгдлийн сан шаардлагатай." }, 503);
  const body = object(await c.req.json().catch(() => null));
  const chemistId = text(body.chemistId) || user.id;
  if (!isUuid(chemistId)) return c.json({ ok: false }, 400);
  const db = createDatabase(c.env.DATABASE_URL);
  const report = readRows(await db.execute(sql`
    SELECT c.display_name AS "customerName", o.name AS "centerName", o.type AS "centerType", o.metadata AS "printMetadata", i.bullion_no AS "bullionNo",
      i.gross_weight_after_grams::float AS "bullionWeightGrams", b.dispatch_reference AS "origin", b.public_id AS "registrationNo",
      u.full_name AS "chemistName",
      (SELECT CASE WHEN count(*) = 1 THEN min(manager.full_name) END FROM users manager
        WHERE manager.organization_id = b.assay_center_id AND manager.role = 'lab_manager'
          AND manager.status = 'active') AS "managerName"
    FROM bullion_intake_items i JOIN bullion_intake_batches b ON b.id = i.batch_id
    JOIN customers c ON c.id = b.customer_id JOIN organizations o ON o.id = b.assay_center_id
    JOIN users u ON u.id = ${chemistId} AND u.organization_id = b.assay_center_id AND u.status = 'active'
    WHERE i.id = ${sample.id} AND (u.role = 'chemist' OR u.id = ${user.id})
      AND (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
      AND (${user.role} <> 'chemist' OR i.assigned_chemist_id = ${user.id})
  `))[0];
  if (!report) return c.json({ ok: false, message: "Хэвлэх химичийг зөв сонгоно уу." }, 400);
  const schema = readRows(await db.execute<{ ready: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'bullion_certificates' AND column_name = 'issue_year') AS ready`))[0];
  if (!schema?.ready) return c.json({ ok: false, message: "Нэгдсэн сорилтын дүн хэвлэхийн өмнө өгөгдлийн сангийн шинэчлэл (0004, 0005) хийх шаардлагатай." }, 503);
  const certificate = await requestCertificate(db, user, sample.id);
  if (!certificate) return c.json({ ok: false, message: "Энэ хүсэлтийн бүх дээжийн шинжилгээний дүнг хяналтад илгээсний дараа нэгдсэн сорилтын дүнг хэвлэнэ үү. Төвийн дугаарлалтын тохиргоог мөн шалгана уу." }, 409);
  const data = { ...report, sample, certificateNo: certificate.certificateNo, entries: certificate.entries,
    certificateYear: certificate.issueYear, issuedAt: certificate.issuedAt, printedAt: new Date().toISOString() };
  await appendAuditLog(db, user, "bullion_examination.print_requested", "bullion_intake_items", sample.id,
    { revisionNo: sample.revisionNo, printedByUserId: user.id, selectedChemistId: chemistId, report: data });
  c.header("Cache-Control", "no-store");
  return c.json({ ok: true, data });
});

async function listSamples(env: EdgeApiEnv, user: AuthenticatedUser): Promise<AnonymousSample[]> {
  if (!env.DATABASE_URL) return visibleBatches(user).flatMap((batch) => batch.items
    .filter((item) => batch.status === "sample_taken" && (item.sampleWeightMilligrams ?? 0) > 0
      && (user.role !== "chemist" || item.assignedChemistId === user.id))
    .map((item) => {
      const revision = memoryExaminations.get(item.id);
      const substitution = memorySubstitutions.get(item.id);
      return { id: item.id, analysisNo: item.analysisNo!, metal: batch.metal,
        ...(isCenterManager(user.role) ? { batchId: batch.id, assignedChemistId: item.assignedChemistId ?? null, assignedChemistName: item.assignedChemistName ?? null,
          assignedAt: item.assignedAt ?? null, completedAt: revision?.submittedAt ?? null } : {}),
        ...(substitution?.recipientId === user.id ? { substitutedByName: substitution.byName, substitutedAt: substitution.transferredAt } : {}),
        receivedAt: batch.receivedAt || batch.createdAt, sampleWeightMilligrams: item.sampleWeightMilligrams!,
        delta: batch.delta ?? -0.03125, revisionNo: revision?.revisionNo ?? 0,
        status: revision?.input.status ?? "pending", examination: revision?.input ?? null };
    }));
  const result = await createDatabase(env.DATABASE_URL).execute<AnonymousSample>(sql`
    SELECT i.id, b.id AS "batchId", i.assigned_chemist_id AS "assignedChemistId", i.assigned_at AS "assignedAt", e.submitted_at AS "completedAt",
      (SELECT full_name FROM users WHERE id = i.assigned_chemist_id) AS "assignedChemistName",
      transfer."substitutedByName", transfer."substitutedAt",
      i.examination_number::text AS "analysisNo", b.metal,
      b.received_at AS "receivedAt", i.sample_weight_milligrams::float AS "sampleWeightMilligrams",
      b.delta::float AS delta, COALESCE(e.revision_no, 0) AS "revisionNo", COALESCE(e.status::text, 'pending') AS status,
      CASE WHEN e.id IS NULL THEN NULL ELSE json_build_object(
        'bullionItemId', i.id, 'examinationNo', i.examination_number::text, 'sampleWeightGrams', e.sample_weight_grams::float,
        'delta', e.delta::float, 'status', e.status, 'weightEntries', e.weight_entries,
        'measurementEntries', e.measurement_entries, 'goldResult', e.gold_result::float, 'silverResult', e.silver_result::float,
        'reexaminationRequested', e.reexamination_requested, 'notes', e.notes) END AS examination
    FROM bullion_intake_items i JOIN bullion_intake_batches b ON b.id = i.batch_id
    LEFT JOIN LATERAL (SELECT * FROM bullion_examination_revisions WHERE bullion_item_id = i.id ORDER BY revision_no DESC LIMIT 1) e ON true
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
    if (isCenterManager(user.role)) return sample;
    const anonymous = { ...sample };
    delete anonymous.batchId; delete anonymous.assignedChemistId; delete anonymous.assignedChemistName;
    delete anonymous.assignedAt; delete anonymous.completedAt;
    return anonymous;
  });
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

function customerSequenceQuery(customerId: string, user: AuthenticatedUser) {
  return sql`SELECT c.id, c.display_name AS "displayName", c.assay_center_id AS "organizationId", numbering.prefix,
      bullion.value AS "nextSequence", numbering.prefix || lpad(bullion.value::text, GREATEST(4, length(bullion.value::text)), '0') AS "nextNumber",
      numbering.prefix || lpad(registration.value::text, GREATEST(4, length(registration.value::text)), '0') AS "nextRegistrationNumber"
    FROM customers c
    JOIN organizations o ON o.id = c.assay_center_id
    CROSS JOIN LATERAL (SELECT COALESCE(o.metadata->>'bullionPrefix', CASE WHEN o.type = 'private_assay_center' THEN '55' ELSE '' END) AS prefix) numbering
    CROSS JOIN LATERAL (SELECT COALESCE(max(CASE WHEN i.bullion_no ~ ('^' || numbering.prefix || '[0-9]{4,12}$')
      THEN substring(i.bullion_no FROM length(numbering.prefix) + 1)::bigint END), 0) + 1 AS value
      FROM bullion_intake_items i JOIN bullion_intake_batches b ON b.id = i.batch_id
      WHERE b.assay_center_id = o.id) bullion
    CROSS JOIN LATERAL (SELECT COALESCE(max(CASE WHEN b.public_id ~ ('^' || numbering.prefix || '[0-9]{4,12}$')
      THEN substring(b.public_id FROM length(numbering.prefix) + 1)::bigint END), 0) + 1 AS value
      FROM bullion_intake_batches b WHERE b.assay_center_id = o.id) registration
    WHERE c.id = ${customerId} AND (${user.role} = 'system_admin' OR c.assay_center_id = ${user.organizationId})`;
}

function memoryNextNumber(user: AuthenticatedUser): { prefix: string; value: number } {
  const prefix = user.organizationType === "private_assay_center" ? "55" : "";
  const issued = inMemoryBatches.filter((batch) => batchOwners.get(batch.id) === user.organizationId)
    .flatMap((batch) => batch.items).map((item) => new RegExp(`^${prefix}[0-9]{4,12}$`).test(item.bullionNo) ? Number(item.bullionNo.slice(prefix.length)) : 0);
  return { prefix, value: issued.reduce((max, value) => Math.max(max, value), 0) + 1 };
}

function memoryNextRegistrationNumber(user: AuthenticatedUser): { prefix: string; value: number } {
  const prefix = user.organizationType === "private_assay_center" ? "55" : "";
  const issued = inMemoryBatches.filter((batch) => batchOwners.get(batch.id) === user.organizationId)
    .map((batch) => new RegExp(`^${prefix}[0-9]{4,12}$`).test(batch.publicId) ? Number(batch.publicId.slice(prefix.length)) : 0);
  return { prefix, value: issued.reduce((max, value) => Math.max(max, value), 0) + 1 };
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
    return c.json({ ok: true, nextNumber: formatBullionNumber(next.prefix, next.value), prefix: next.prefix });
  }
  const customer = readRows(await createDatabase(c.env.DATABASE_URL).execute<{ nextNumber: string; prefix: string }>(customerSequenceQuery(customerId, user)))[0];
  if (!customer) return c.json({ ok: false }, 404);
  return c.json({ ok: true, nextNumber: customer.nextNumber, prefix: customer.prefix });
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
  if (!c.env.DATABASE_URL) await assignInMemory(record, user, c.env);
  return c.json({ ok: true, record }, 201);
});

bullionRoutes.patch("/intakes/:id", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!INTAKE_ROLES.has(user.role)) return c.json({ ok: false }, 403);
  const id = c.req.param("id");
  const body = object(await c.req.json().catch(() => null));
  const rows = Array.isArray(body.items) ? body.items.map(object) : [];
  if (!isUuid(id) || !rows.length || rows.length > 100 || !["draft", "ready_for_sampling", "sample_taken"].includes(text(body.status))
    || Object.keys(body).some((key) => !["items", "status"].includes(key))
    || rows.some((row) => !isUuid(text(row.id)) || Object.keys(row).some((key) => !["id", "grossWeightAfterGrams", "slagWeightGrams", "sampleWeightMilligrams"].includes(key))
      || [row.grossWeightAfterGrams, row.slagWeightGrams, row.sampleWeightMilligrams].some((value) => value != null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)))) {
    return c.json({ ok: false, message: "Жингийн утгыг зөв оруулна уу." }, 400);
  }
  if (user.role === "intake_officer" && (body.status === "sample_taken" || rows.some((row) => "sampleWeightMilligrams" in row))) return c.json({ ok: false }, 403);
  if (body.status === "ready_for_sampling" && rows.some((row) => Number(row.grossWeightAfterGrams ?? 0) <= 0)) return c.json({ ok: false, message: "Хайлалтын дараах жинг оруулна уу." }, 400);
  if (body.status === "sample_taken" && rows.some((row) => Number(row.sampleWeightMilligrams ?? 0) <= 0 || Number(row.grossWeightAfterGrams ?? 0) <= 0)) {
    return c.json({ ok: false, message: "Хайлалтын дараах жин, дээжийн жинг оруулна уу." }, 400);
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) return c.json({ ok: false }, 400);
  const changes = rows.map((row) => ({ id: row.id, after: row.grossWeightAfterGrams ?? null,
    slag: row.slagWeightGrams ?? null, sample: row.sampleWeightMilligrams ?? null }));
  if (!c.env.DATABASE_URL) {
    const batch = visibleBatches(user).find((batch) => batch.id === id);
    if (!batch) return c.json({ ok: false }, 404);
    if ((batch.status !== "draft" && !(batch.status === "ready_for_sampling" && isCenterManager(user.role) && body.status !== "draft")) || changes.length !== batch.items.length || batch.items.some((item) => !changes.some((change) => change.id === item.id))) return c.json({ ok: false }, 409);
    if (batch.items.some((item) => {
      const after = changes.find((change) => change.id === item.id)!.after;
      return after != null && Number(after) > item.grossWeightBeforeGrams;
    })) return c.json({ ok: false, message: "Дараах жин өмнөх жингээс их байж болохгүй." }, 400);
    for (const item of batch.items) {
      const change = changes.find((change) => change.id === item.id)!;
      item.grossWeightAfterGrams = change.after as number | undefined;
      item.slagWeightGrams = change.after == null ? undefined : Number((item.grossWeightBeforeGrams - Number(change.after)).toFixed(4));
      if (isCenterManager(user.role)) item.sampleWeightMilligrams = change.sample as number | undefined;
    }
    batch.status = body.status as "draft" | "ready_for_sampling" | "sample_taken";
    await assignInMemory(batch, user, c.env);
    return c.json({ ok: true, record: batch });
  }
  const db = createDatabase(c.env.DATABASE_URL);
  const eventId = crypto.randomUUID();
  const hash = await sha256Base64Url(JSON.stringify({ eventId, actor: user.id, id, changes, status: body.status }));
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206825)`),
    db.execute<{ id: string }>(sql`
    WITH incoming AS (SELECT * FROM jsonb_to_recordset(${JSON.stringify(changes)}::jsonb)
      AS r(id uuid, after numeric, slag numeric, sample numeric)),
    target AS MATERIALIZED (
      SELECT b.id FROM bullion_intake_batches b WHERE b.id = ${id}
        AND (b.status = 'draft' OR (b.status = 'ready_for_sampling' AND ${user.role} <> 'intake_officer' AND ${body.status} <> 'draft'))
        AND (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
        AND (SELECT count(*) FROM bullion_intake_items WHERE batch_id = b.id) = ${changes.length}
        AND NOT EXISTS (SELECT 1 FROM incoming r WHERE NOT EXISTS (SELECT 1 FROM bullion_intake_items i WHERE i.id = r.id AND i.batch_id = b.id))
        AND NOT EXISTS (SELECT 1 FROM incoming r JOIN bullion_intake_items i ON i.id = r.id WHERE r.after > i.gross_weight_before_grams)
      FOR UPDATE
    ), previous AS MATERIALIZED (
      SELECT i.id, i.gross_weight_after_grams, i.slag_weight_grams, i.sample_weight_milligrams
      FROM bullion_intake_items i JOIN target t ON t.id = i.batch_id
    ), changed AS (
      UPDATE bullion_intake_items i SET gross_weight_after_grams = r.after, slag_weight_grams = i.gross_weight_before_grams - round(r.after, 4),
        sample_weight_milligrams = CASE WHEN ${user.role} = 'intake_officer' THEN i.sample_weight_milligrams ELSE r.sample END
      FROM incoming r WHERE i.id = r.id AND i.batch_id IN (SELECT id FROM target)
      RETURNING i.id, i.gross_weight_after_grams, i.slag_weight_grams, i.sample_weight_milligrams
    ), batch AS (
      UPDATE bullion_intake_batches SET status = ${body.status}, updated_at = now()
      WHERE id IN (SELECT id FROM target) AND (SELECT count(*) FROM changed) = ${changes.length} RETURNING id
    ), audit AS (
      INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, old_values, new_values, reason, entry_hash)
      SELECT ${eventId}, ${user.id}, ${user.organizationId}, 'bullion_intake.updated', 'bullion_intake_batches', batch.id,
        (SELECT jsonb_agg(to_jsonb(previous)) FROM previous), jsonb_build_object('status', ${body.status}::text, 'items', (SELECT jsonb_agg(to_jsonb(changed)) FROM changed)), 'Intake weights updated', ${hash} FROM batch
    ) SELECT id FROM batch
  `),
    db.execute(await assignmentQuery(id, user, eventId)),
  ]);
  const result = readRows(results[1]);
  if (!result.length) return c.json({ ok: false, message: "Бүртгэл өөрчлөгдсөн эсвэл жин буруу байна. Дараах жин өмнөх жингээс их байж болохгүй." }, 409);
  return c.json({ ok: true });
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
  if (input.calculationVersion === BULLION_CALCULATION_VERSION) {
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
      b.province, b.district, b.dispatch_reference AS "dispatchReference", b.initial_bullion_number AS "initialBullionNumber",
      b.piece_count AS "pieceCount", b.delta::float AS delta, b.status, b.created_at AS "createdAt",
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
    db.execute<{ publicId: string; nextNumber: string; displayName: string; examinationNumbers: Record<string, string>; bullionNumbers: Record<string, string> }>(sql`
      WITH customer AS (${customerSequenceQuery(input.customerId, user)}),
      created AS (
        INSERT INTO bullion_intake_batches (
          id, public_id, assay_center_id, customer_id, received_by_user_id, metal, received_at,
          branch_name, province, district, dispatch_reference, initial_bullion_number, piece_count, delta, status
        ) SELECT ${batchId}::uuid,
          c."nextRegistrationNumber",
          c."organizationId", c.id, ${user.id}::uuid, ${input.metal},
          ${input.receivedAt || now}::timestamptz, ${input.branchName || null}, ${input.province || null},
          ${input.district || null}, ${input.dispatchReference || null}, c."nextNumber",
          ${items.length}, ${input.delta ?? 0}, ${input.status ?? "draft"}
        FROM customer c RETURNING *
      ), inserted_items AS (
        INSERT INTO bullion_intake_items (
          id, batch_id, sequence_no, bullion_no, gross_weight_before_grams,
          gross_weight_after_grams, slag_weight_grams, sample_weight_milligrams
        ) SELECT r.id, b.id, r."sequenceNo",
          c.prefix || lpad((c."nextSequence" + r."sequenceNo" - 1)::text, GREATEST(4, length((c."nextSequence" + r."sequenceNo" - 1)::text)), '0'),
          r."grossWeightBeforeGrams", r."grossWeightAfterGrams", r."slagWeightGrams", r."sampleWeightMilligrams"
        FROM created b JOIN customer c ON c.id = b.customer_id CROSS JOIN jsonb_to_recordset(${JSON.stringify(items)}::jsonb)
          AS r(id uuid, "sequenceNo" int, "grossWeightBeforeGrams" numeric,
            "grossWeightAfterGrams" numeric, "slagWeightGrams" numeric, "sampleWeightMilligrams" numeric)
        ORDER BY r."sequenceNo"
        RETURNING id, examination_number, bullion_no
      ), audited AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, new_values, reason, entry_hash)
        SELECT ${auditId}::uuid, ${user.id}::uuid, ${user.organizationId}::uuid,
          'bullion_intake.created', 'bullion_intake_batches', b.id,
          jsonb_build_object('publicId', b.public_id, 'pieceCount', (SELECT count(*) FROM inserted_items)),
          'Bullion workflow action', ${entryHash} FROM created b
      )
      SELECT b.public_id AS "publicId", b.initial_bullion_number AS "nextNumber", c."displayName",
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
    dispatchReference: input.dispatchReference, initialBullionNumber: allocated.nextNumber,
    pieceCount: items.length, delta: input.delta, status: input.status, createdAt: now,
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
      weight_entries, measurement_entries, gold_result, silver_result, reexamination_requested, notes, submitted_at
    ) SELECT ${id}, ${item.id}, ${item.nextRevisionNo}, ${input.examinationNo}, ${user.id}, ${input.status},
      ${input.delta ?? 0}, ${input.sampleWeightGrams}, ${JSON.stringify(input.weightEntries)}::jsonb,
      ${JSON.stringify(input.measurementEntries)}::jsonb, ${input.goldResult ?? null}, ${input.silverResult ?? null},
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
    dispatchReference: input.dispatchReference, initialBullionNumber: input.initialBullionNumber,
    pieceCount: input.items.length, delta: input.delta, status: input.status, createdAt: now,
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
    branchName: text(body.branchName), province: text(body.province), district: text(body.district), dispatchReference: text(body.dispatchReference),
    initialBullionNumber: text(body.initialBullionNumber), delta: number(body.delta), status: body.status === "sample_taken" ? "sample_taken" : body.status === "ready_for_sampling" ? "ready_for_sampling" : "draft",
    items: Array.isArray(body.items) ? body.items.map((item) => {
      const row = object(item);
      const before = number(row.grossWeightBeforeGrams) ?? 0;
      const after = number(row.grossWeightAfterGrams);
      return { analysisNo: text(row.analysisNo), bullionNo: text(row.bullionNo), grossWeightBeforeGrams: number(row.grossWeightBeforeGrams) ?? 0,
        grossWeightAfterGrams: after, slagWeightGrams: after == null ? undefined : Number((before - after).toFixed(4)), sampleWeightMilligrams: number(row.sampleWeightMilligrams) };
    }) : [],
  };
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
        calculation: row.calculation === "yes" || row.calculation === "addition" ? row.calculation : "no", outputWeightGrams: number(row.outputWeightGrams) ?? 0, goldAssay: number(row.goldAssay) };
    }) : [],
    measurementEntries: Array.isArray(body.measurementEntries) ? body.measurementEntries.map((entry) => {
      const row = object(entry); return { label: text(row.label), reading: number(row.reading) ?? 0, goldAssay: number(row.goldAssay), silverAssay: number(row.silverAssay) };
    }) : [],
    goldResult: number(body.goldResult), silverResult: number(body.silverResult), reexaminationRequested: body.reexaminationRequested === true, notes: text(body.notes),
  };
}

function validateIntake(input: CreateBullionIntakeInput) {
  if (input.items.some((item) => item.grossWeightAfterGrams != null && item.grossWeightAfterGrams > item.grossWeightBeforeGrams)) return "Дараах жин өмнөх жингээс их байж болохгүй.";
  if (input.status === "ready_for_sampling" && input.items.some((item) => (item.grossWeightAfterGrams ?? 0) <= 0)) return "Хайлалтын дараах жинг оруулна уу.";
  if (!isUuid(input.customerId)) return "Харилцагчийг сонгоно уу.";
  if (!input.items.length || input.items.length > 100) return "1-100 гулдмайн мөр оруулна уу.";
  if (input.items.some((item) => item.grossWeightBeforeGrams <= 0)) return "Гулдмайн жинг зөв оруулна уу.";
  if (input.receivedAt && !Number.isFinite(Date.parse(input.receivedAt))) return "Огноог зөв оруулна уу.";
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
      || (entry.goldAssay != null && (entry.goldAssay < 0 || entry.goldAssay > 1000)))) return "Хэмжилтийн утга буруу байна.";
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

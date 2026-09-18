import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDatabase } from "../../../../packages/db/src";
import { decryptField, isValidFieldEncryptionKey } from "../../../../packages/security/src";
import { isCenterManager } from "../../../../packages/shared/src/workspace-access";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const reportRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

async function revealRegistrationNumber(value: string | null, encryptionKey?: string): Promise<string | null> {
  if (!value) return null;
  if (!value.startsWith("v1.")) return value;
  if (!isValidFieldEncryptionKey(encryptionKey)) return null;
  try { return await decryptField(value, encryptionKey); } catch { return null; }
}

reportRoutes.get("/summary", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const period = c.req.query("period") ?? "day";
  if (period !== "day" && period !== "month" && period !== "year") return c.json({ ok: false, message: "Тоймын хугацааг зөв сонгоно уу." }, 400);
  if (!c.env.DATABASE_URL) {
    const { getMemoryDashboardSummary } = await import("./routes");
    return c.json({ ok: true, data: getMemoryDashboardSummary(user, period) });
  }

  const allCenters = user.role === "system_admin" ? sql`true` : sql`false`;
  const result = await createDatabase(c.env.DATABASE_URL).execute(sql`
    WITH scope AS (
      SELECT ${allCenters} AS "allCenters", ${user.organizationId}::uuid AS "organizationId"
    ), bounds AS (
      SELECT
        CASE ${period}
          WHEN 'month' THEN date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar')
          WHEN 'year' THEN date_trunc('year', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar')
          ELSE date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar')
        END AS "startLocal",
        CASE ${period}
          WHEN 'month' THEN date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar') + interval '1 month'
          WHEN 'year' THEN date_trunc('year', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar') + interval '1 year'
          ELSE date_trunc('day', CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar') + interval '1 day'
        END AS "endLocal"
    ), items AS (
      SELECT b.id AS "batchId", b.metal, b.received_at AS "receivedAt", i.id, i.gross_weight_before_grams,
        i.assigned_chemist_id AS "assignedChemistId",
        latest.status AS "examinationStatus"
      FROM bullion_intake_batches b
      JOIN bullion_intake_items i ON i.batch_id = b.id
      LEFT JOIN LATERAL (
        SELECT status FROM bullion_examination_revisions e
        WHERE e.bullion_item_id = i.id
        ORDER BY e.revision_no DESC
        LIMIT 1
      ) latest ON true
      CROSS JOIN scope s
      WHERE s."allCenters" OR b.assay_center_id = s."organizationId"
    ), period_items AS (
      SELECT i.* FROM items i CROSS JOIN bounds b
      WHERE i."receivedAt" >= (b."startLocal" AT TIME ZONE 'Asia/Ulaanbaatar')
        AND i."receivedAt" < (b."endLocal" AT TIME ZONE 'Asia/Ulaanbaatar')
    ), customer_totals AS (
      SELECT count(*) FILTER (WHERE c.type = 'individual')::int AS "individualCustomers",
        count(*) FILTER (WHERE c.type = 'legal_entity')::int AS "companyCustomers"
      FROM customers c
      CROSS JOIN scope s
      CROSS JOIN bounds b
      WHERE (s."allCenters" OR c.assay_center_id = s."organizationId")
        AND c.created_at >= (b."startLocal" AT TIME ZONE 'Asia/Ulaanbaatar')
        AND c.created_at < (b."endLocal" AT TIME ZONE 'Asia/Ulaanbaatar')
    ), user_totals AS (
      SELECT count(*)::int AS "userCount"
      FROM users u
      CROSS JOIN scope s
      CROSS JOIN bounds b
      WHERE (s."allCenters" OR u.organization_id = s."organizationId")
        AND u.created_at >= (b."startLocal" AT TIME ZONE 'Asia/Ulaanbaatar')
        AND u.created_at < (b."endLocal" AT TIME ZONE 'Asia/Ulaanbaatar')
    )
    SELECT
      count(*) FILTER (WHERE p.metal = 'gold')::int AS "goldReceivedToday",
      count(*) FILTER (WHERE p.metal = 'silver')::int AS "silverReceivedToday",
      count(*) FILTER (WHERE i."assignedChemistId" IS NOT NULL AND COALESCE(i."examinationStatus"::text, 'pending') <> 'submitted')::int AS "withChemistCount",
      count(*) FILTER (WHERE p."assignedChemistId" IS NOT NULL AND COALESCE(p."examinationStatus"::text, 'pending') <> 'submitted')::int AS "todayInExaminationCount",
      COALESCE(sum(p.gross_weight_before_grams) FILTER (WHERE p.metal = 'gold'), 0)::float AS "totalGoldGrams",
      COALESCE(sum(p.gross_weight_before_grams) FILTER (WHERE p.metal = 'silver'), 0)::float AS "totalSilverGrams",
      (SELECT "userCount" FROM user_totals) AS "userCount",
      (SELECT "individualCustomers" FROM customer_totals) AS "individualCustomers",
      (SELECT "companyCustomers" FROM customer_totals) AS "companyCustomers"
    FROM items i
    LEFT JOIN period_items p ON p.id = i.id
  `);
  return c.json({ ok: true, data: (Array.isArray(result) ? result : result.rows)[0] });
});

reportRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const from = c.req.query("from") || "2000-01-01";
  const to = c.req.query("to") || ulaanbaatarIsoDate();
  if (![from, to].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date) || from > to) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) {
    const { getMemoryPrivateAssayReport } = await import("./routes");
    return c.json({ ok: true, data: getMemoryPrivateAssayReport(user, from, to) });
  }
  const result = await createDatabase(c.env.DATABASE_URL).execute(sql`
    SELECT
      c.display_name AS "organizationName",
      c.registration_number_encrypted AS "registrationNumberEncrypted",
      b.received_at AS "receivedAt",
      b.public_id AS "registrationNo",
      i.bullion_no AS "bullionNo",
      i.examination_number::text AS "analysisNo",
      b.metal,
      i.gross_weight_before_grams::float AS "grossWeightBeforeGrams",
      i.gross_weight_after_grams::float AS "grossWeightAfterGrams",
      i.sample_weight_milligrams::float AS "sampleWeightMilligrams",
      CASE WHEN i.gross_weight_after_grams IS NULL THEN NULL
        ELSE (i.gross_weight_before_grams - i.gross_weight_after_grams - COALESCE(i.slag_weight_grams, 0))::float END AS "lossGrams",
      e.sample_weight_grams::float AS "receivedWeightGrams",
      (SELECT entry ->> 'reading' FROM jsonb_array_elements(COALESCE(e.measurement_entries, '[]'::jsonb)) entry
        WHERE entry ->> 'label' = 'Дээжийн үлдэгдэл жин' LIMIT 1)::float AS "remainingMilligrams",
      (SELECT entry ->> 'reading' FROM jsonb_array_elements(COALESCE(e.measurement_entries, '[]'::jsonb)) entry
        WHERE entry ->> 'label' = 'Королько, корточка' LIMIT 1)::float AS "korolkoMilligrams",
      e.gold_result::float AS "goldFinenessPermille",
      e.silver_result::float AS "silverFinenessPermille",
      COALESCE(e.delta, b.delta)::float AS delta,
      b.dispatch_reference AS origin,
      COALESCE(chemist.full_name, assigned_chemist.full_name) AS "chemistName",
      b.act_number AS "actNumber",
      b.act_date::text AS "actDate"
    FROM bullion_intake_batches b
    JOIN bullion_intake_items i ON i.batch_id = b.id
    JOIN customers c ON c.id = b.customer_id
    LEFT JOIN LATERAL (
      SELECT * FROM bullion_examination_revisions
      WHERE bullion_item_id = i.id
      ORDER BY revision_no DESC
      LIMIT 1
    ) e ON true
    LEFT JOIN users chemist ON chemist.id = e.entered_by_user_id
    LEFT JOIN users assigned_chemist ON assigned_chemist.id = i.assigned_chemist_id
    WHERE (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
      AND b.received_at >= (${from}::date::timestamp AT TIME ZONE 'Asia/Ulaanbaatar')
      AND b.received_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Ulaanbaatar')
    ORDER BY b.received_at DESC, b.public_id DESC, i.sequence_no ASC
  `);
  const sourceRows = (Array.isArray(result) ? result : result.rows) as Array<Record<string, unknown> & { registrationNumberEncrypted: string | null }>;
  const data = await Promise.all(sourceRows.map(async ({ registrationNumberEncrypted, ...row }) => ({
    ...row,
    customerRegistrationNumber: await revealRegistrationNumber(registrationNumberEncrypted, c.env.FIELD_ENCRYPTION_KEY),
  })));
  return c.json({ ok: true, data });
});

function ulaanbaatarIsoDate(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

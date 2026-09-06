import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDatabase } from "../../../../packages/db/src";
import { isCenterManager } from "../../../../packages/shared/src/workspace-access";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const reportRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

reportRoutes.get("/summary", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  if (!c.env.DATABASE_URL) {
    const { getMemoryDashboardSummary } = await import("./routes");
    return c.json({ ok: true, data: getMemoryDashboardSummary(user) });
  }

  const allCenters = user.role === "system_admin" ? sql`true` : sql`false`;
  const result = await createDatabase(c.env.DATABASE_URL).execute(sql`
    WITH scope AS (
      SELECT ${allCenters} AS "allCenters", ${user.organizationId}::uuid AS "organizationId"
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
    ), today AS (
      SELECT * FROM items
      WHERE "receivedAt" >= (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar')::date)::timestamp AT TIME ZONE 'Asia/Ulaanbaatar')
        AND "receivedAt" < ((((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Ulaanbaatar')::date + 1)::timestamp) AT TIME ZONE 'Asia/Ulaanbaatar')
    ), customer_totals AS (
      SELECT count(*) FILTER (WHERE c.type = 'individual')::int AS "individualCustomers",
        count(*) FILTER (WHERE c.type = 'legal_entity')::int AS "companyCustomers"
      FROM customers c
      JOIN users creator ON creator.id = c.created_by_user_id
      CROSS JOIN scope s
      WHERE s."allCenters" OR creator.organization_id = s."organizationId"
    ), user_totals AS (
      SELECT count(*)::int AS "userCount"
      FROM users u
      CROSS JOIN scope s
      WHERE s."allCenters" OR u.organization_id = s."organizationId"
    )
    SELECT
      count(*) FILTER (WHERE t.metal = 'gold')::int AS "goldReceivedToday",
      count(*) FILTER (WHERE t.metal = 'silver')::int AS "silverReceivedToday",
      count(*) FILTER (WHERE i."assignedChemistId" IS NOT NULL AND COALESCE(i."examinationStatus"::text, 'pending') <> 'submitted')::int AS "withChemistCount",
      count(*) FILTER (WHERE t."assignedChemistId" IS NOT NULL AND COALESCE(t."examinationStatus"::text, 'pending') <> 'submitted')::int AS "todayInExaminationCount",
      COALESCE(sum(i.gross_weight_before_grams) FILTER (WHERE i.metal = 'gold'), 0)::float AS "totalGoldGrams",
      COALESCE(sum(i.gross_weight_before_grams) FILTER (WHERE i.metal = 'silver'), 0)::float AS "totalSilverGrams",
      (SELECT "userCount" FROM user_totals) AS "userCount",
      (SELECT "individualCustomers" FROM customer_totals) AS "individualCustomers",
      (SELECT "companyCustomers" FROM customer_totals) AS "companyCustomers"
    FROM items i
    LEFT JOIN today t ON t.id = i.id
  `);
  return c.json({ ok: true, data: (Array.isArray(result) ? result : result.rows)[0] });
});

reportRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const from = c.req.query("from") || "2000-01-01";
  const to = c.req.query("to") || new Date().toISOString().slice(0, 10);
  if (![from, to].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date))
    && new Date(date).toISOString().slice(0, 10) === date) || from > to) return c.json({ ok: false }, 400);
  if (!c.env.DATABASE_URL) {
    const { getMemoryReport } = await import("./routes");
    return c.json({ ok: true, data: getMemoryReport(user, from, to) });
  }
  const result = await createDatabase(c.env.DATABASE_URL).execute(sql`
    SELECT b.metal, count(i.id)::int AS "bullionCount",
      count(i.id) FILTER (WHERE i.sample_weight_milligrams > 0)::int AS "sampleCount",
      COALESCE(sum(i.gross_weight_before_grams), 0)::float AS "receivedGrams",
      COALESCE(sum(i.gross_weight_after_grams), 0)::float AS "afterGrams",
      count(i.id) FILTER (WHERE e.status = 'submitted')::int AS "submittedCount"
    FROM bullion_intake_batches b JOIN bullion_intake_items i ON i.batch_id = b.id
    LEFT JOIN LATERAL (SELECT status FROM bullion_examination_revisions WHERE bullion_item_id = i.id ORDER BY revision_no DESC LIMIT 1) e ON true
    WHERE (${user.role} = 'system_admin' OR b.assay_center_id = ${user.organizationId})
      AND b.received_at >= (${from}::date::timestamp AT TIME ZONE 'Asia/Ulaanbaatar')
      AND b.received_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Ulaanbaatar')
    GROUP BY b.metal
  `);
  return c.json({ ok: true, data: Array.isArray(result) ? result : result.rows });
});

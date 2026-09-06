import { sql } from "drizzle-orm";
import { Hono } from "hono";

import { createDatabase } from "../../../../packages/db/src";
import { sha256Base64Url } from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const integrationClientRoutes = new Hono<{ Bindings: EdgeApiEnv }>();
const rows = <T,>(result: T[] | { rows: T[] }) => Array.isArray(result) ? result : result.rows;

integrationClientRoutes.use("*", async (c, next) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (user.role !== "system_admin") return c.json({ ok: false }, 403);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "API тохиргоонд өгөгдлийн сан шаардлагатай." }, 503);
  await next();
});

integrationClientRoutes.get("/", async (c) => {
  const data = rows(await createDatabase(c.env.DATABASE_URL!).execute<ApiClientSettingsRecord>(sql`
    SELECT client.id, client.name, client.client_id AS "clientId", client.status::text AS status,
      client.scopes, client.allowed_ip_cidrs AS "allowedIpCidrs", client.last_used_at::text AS "lastUsedAt",
      organization.name AS "organizationName", organization.code AS "organizationCode", organization.type AS "organizationType"
    FROM api_clients client
    INNER JOIN organizations organization ON organization.id = client.organization_id
    WHERE organization.type IN ('bank_of_mongolia', 'commercial_bank')
    ORDER BY organization.type, organization.name, client.name
  `));
  return c.json({ ok: true, data });
});

integrationClientRoutes.patch("/:id/ip-allowlist", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const allowedIpCidrs = normalizeAllowlist(body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>).allowedIpCidrs : null);
  if (!isUuid(id) || !allowedIpCidrs) return c.json({ ok: false, message: "IP хаяг эсвэл CIDR жагсаалтыг зөв оруулна уу." }, 400);
  if (allowedIpCidrs.length === 0) return c.json({ ok: false, message: "Хамгийн багадаа нэг зөвшөөрөгдсөн IP хаяг оруулна уу." }, 400);

  const user = (await getAuthenticatedUserFromRequest(c.req.raw, c.env))!;
  const db = createDatabase(c.env.DATABASE_URL!);
  const auditId = crypto.randomUUID();
  const entryHash = await sha256Base64Url(JSON.stringify({ auditId, id, allowedIpCidrs, actor: user.id }));
  const result = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206827)`),
    db.execute<ApiClientSettingsRecord>(sql`
      WITH previous AS MATERIALIZED (
        SELECT client.id, client.allowed_ip_cidrs AS "allowedIpCidrs"
        FROM api_clients client
        INNER JOIN organizations organization ON organization.id = client.organization_id
        WHERE client.id = ${id}::uuid AND organization.type IN ('bank_of_mongolia', 'commercial_bank')
        FOR UPDATE OF client
      ), changed AS (
        UPDATE api_clients SET allowed_ip_cidrs = ${allowedIpCidrs}
        WHERE id IN (SELECT id FROM previous)
        RETURNING id, name, client_id AS "clientId", status::text AS status, scopes,
          allowed_ip_cidrs AS "allowedIpCidrs", last_used_at::text AS "lastUsedAt", organization_id
      ), audit AS (
        INSERT INTO audit_logs (id, actor_user_id, actor_organization_id, action, entity_type, entity_id, old_values, new_values, reason, entry_hash)
        SELECT ${auditId}::uuid, ${user.id}::uuid, ${user.organizationId}::uuid,
          'integration_client.ip_allowlist.updated', 'api_clients', changed.id,
          jsonb_build_object('allowedIpCidrs', previous."allowedIpCidrs"),
          jsonb_build_object('allowedIpCidrs', changed."allowedIpCidrs"),
          'External API network access allowlist updated', ${entryHash}
        FROM changed JOIN previous ON previous.id = changed.id
      )
      SELECT changed.id, changed.name, changed."clientId", changed.status, changed.scopes,
        changed."allowedIpCidrs", changed."lastUsedAt", organization.name AS "organizationName",
        organization.code AS "organizationCode", organization.type AS "organizationType"
      FROM changed JOIN organizations organization ON organization.id = changed.organization_id
    `),
  ]);
  const record = rows(result[1])[0];
  if (!record) return c.json({ ok: false, message: "API client олдсонгүй." }, 404);
  return c.json({ ok: true, data: record });
});

function normalizeAllowlist(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 50 || value.some((entry) => typeof entry !== "string")) return null;
  const unique = [...new Set(value.map((entry) => entry.trim()).filter(Boolean))];
  return unique.every(isIpv4Cidr) ? unique : null;
}

function isIpv4Cidr(value: string): boolean {
  const [ip, prefix] = value.split("/");
  if (!ip || value.split("/").length > 2 || !isIpv4(ip)) return false;
  return prefix === undefined || (/^\d{1,2}$/.test(prefix) && Number(prefix) >= 0 && Number(prefix) <= 32);
}

function isIpv4(value: string): boolean {
  return value.split(".").length === 4 && value.split(".").every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

type ApiClientSettingsRecord = {
  id: string;
  name: string;
  clientId: string;
  status: string;
  scopes: string[];
  allowedIpCidrs: string[];
  lastUsedAt: string | null;
  organizationName: string;
  organizationCode: string;
  organizationType: string;
};

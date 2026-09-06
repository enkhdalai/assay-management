import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDatabase } from "../../../../packages/db/src";
import { sha256Base64Url } from "../../../../packages/security/src";
import type { OrganizationRecord } from "../../../../packages/shared/src/organization-types";
import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const organizationRoutes = new Hono<{ Bindings: EdgeApiEnv }>();
const rows = <T,>(result: T[] | { rows: T[] }) => Array.isArray(result) ? result : result.rows;

organizationRoutes.use("*", async (c, next) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (user.role !== "system_admin") return c.json({ ok: false }, 403);
  if (!c.env.DATABASE_URL) return c.json({ ok: false, message: "Байгууллага удирдахад өгөгдлийн сан шаардлагатай." }, 503);
  await next();
});

organizationRoutes.get("/", async (c) => {
  const data = rows(await createDatabase(c.env.DATABASE_URL!).execute<OrganizationRecord>(sql`
    SELECT id, name, code, type, status, updated_at::text AS "updatedAt", metadata->>'bullionPrefix' AS "bullionPrefix" FROM organizations ORDER BY name, id
  `));
  return c.json({ ok: true, data });
});

organizationRoutes.on(["POST", "PATCH"], ["/", "/:id"], async (c) => {
  const editing = c.req.method === "PATCH";
  const id = editing ? c.req.param("id") : crypto.randomUUID();
  const body = await c.req.json().catch(() => null);
  const types = ["private_assay_center", "government_assay_center"];
  if (!body || typeof body !== "object" || Array.isArray(body)
    || Object.keys(body).some(key => !["name", "code", "type", "expectedUpdatedAt", "bullionPrefix"].includes(key))
    || (body.bullionPrefix !== undefined && ![null, "", "55", "22", "27"].includes(body.bullionPrefix))
    || typeof body.name !== "string" || body.name.trim().length < 2 || body.name.length > 255
    || typeof body.code !== "string" || !/^[A-Z0-9_-]{2,32}$/.test(body.code.trim().toUpperCase())
    || typeof body.type !== "string"
    || !(editing ? [...types, "system_operator", "commercial_bank", "bank_of_mongolia"] : types).includes(body.type)
    || !id || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
    || (editing && (typeof body.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(body.expectedUpdatedAt))))) {
    return c.json({ ok: false, message: "Байгууллагын нэр, код, төрлийг зөв оруулна уу." }, 400);
  }
  const user = (await getAuthenticatedUserFromRequest(c.req.raw, c.env))!;
  const db = createDatabase(c.env.DATABASE_URL!);
  const name = body.name.trim(), code = body.code.trim().toUpperCase();
  const action = editing ? "organization.updated" : "organization.created";
  const hash = await sha256Base64Url(JSON.stringify({ id, action, body, actor: user.id, nonce: crypto.randomUUID() }));
  // The write and its audit record commit together; stale edits never overwrite newer data.
  const result = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206826)`),
    db.execute<OrganizationRecord>(sql`
      WITH previous AS MATERIALIZED (SELECT * FROM organizations WHERE id = ${id}::uuid),
      changed AS (${editing ? sql`
        UPDATE organizations SET name = ${name}, code = ${code}, type = ${body.type}::organization_type, updated_at = now(),
          metadata = ${body.bullionPrefix === undefined ? sql`metadata` : sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify({ bullionPrefix: body.bullionPrefix })}::jsonb`}
        WHERE id = ${id}::uuid AND updated_at = ${body.expectedUpdatedAt}::timestamptz
          AND (type = ${body.type}::organization_type OR ${body.type} IN ('private_assay_center', 'government_assay_center'))
          AND NOT EXISTS (SELECT 1 FROM organizations WHERE code = ${code} AND id <> ${id}::uuid)
        RETURNING *
      ` : sql`
        INSERT INTO organizations (id, name, code, type, metadata) VALUES (${id}::uuid, ${name}, ${code}, ${body.type}::organization_type, ${JSON.stringify({ bullionPrefix: body.bullionPrefix ?? null })}::jsonb)
        ON CONFLICT (code) DO NOTHING RETURNING *
      `}), audit AS (
        INSERT INTO audit_logs (actor_user_id, actor_organization_id, action, entity_type, entity_id, old_values, new_values, reason, previous_hash, entry_hash)
        SELECT ${user.id}::uuid, ${user.organizationId}::uuid, ${action}, 'organizations', id,
          (SELECT to_jsonb(previous) FROM previous), to_jsonb(changed), 'Organization settings',
          (SELECT entry_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1), ${hash} FROM changed
      ) SELECT id, name, code, type, status, updated_at::text AS "updatedAt", metadata->>'bullionPrefix' AS "bullionPrefix" FROM changed
    `),
  ]);
  const record = rows(result[1])[0];
  if (!record) return c.json({ ok: false, message: "Код давхардсан эсвэл мэдээлэл өөрчлөгдсөн байна. Жагсаалтыг шинэчилнэ үү." }, 409);
  return c.json({ ok: true, record }, editing ? 200 : 201);
});

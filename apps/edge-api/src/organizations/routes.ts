import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { createDatabase } from "../../../../packages/db/src";
import { sha256Base64Url } from "../../../../packages/security/src";
import type { OrganizationConnections, OrganizationRecord } from "../../../../packages/shared/src/organization-types";
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

organizationRoutes.get("/:id/connections", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return c.json({ ok: false }, 400);
  const db = createDatabase(c.env.DATABASE_URL!);
  const organization = rows(await db.execute<OrganizationRecord>(sql`
    SELECT id, name, code, type, status, updated_at::text AS "updatedAt", metadata->>'bullionPrefix' AS "bullionPrefix"
    FROM organizations WHERE id = ${id}::uuid
  `))[0];
  if (!organization) return c.json({ ok: false }, 404);
  const [staff, customers] = await Promise.all([
    db.execute<OrganizationConnections["staff"][number]>(sql`
      SELECT id, full_name AS "fullName", email, role::text AS role, status::text AS status, created_at::text AS "createdAt"
      FROM users WHERE organization_id = ${id}::uuid ORDER BY full_name, id
    `),
    db.execute<OrganizationConnections["customers"][number]>(sql`
      SELECT c.id, c.display_name AS "displayName", c.type,
        count(b.id)::int AS "intakeCount", max(b.received_at)::text AS "lastReceivedAt"
      FROM customers c JOIN users creator ON creator.id = c.created_by_user_id
      LEFT JOIN bullion_intake_batches b ON b.customer_id = c.id
      WHERE creator.organization_id = ${id}::uuid
      GROUP BY c.id, c.display_name, c.type
      ORDER BY max(b.received_at) DESC NULLS LAST, c.display_name, c.id
    `),
  ]);
  return c.json({ ok: true, data: { organization, staff: rows(staff), customers: rows(customers) } satisfies OrganizationConnections });
});

organizationRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) return c.json({ ok: false }, 400);
  const user = (await getAuthenticatedUserFromRequest(c.req.raw, c.env))!;
  const db = createDatabase(c.env.DATABASE_URL!);
  const hash = await sha256Base64Url(JSON.stringify({ id, action: "organization.deleted", actor: user.id, nonce: crypto.randomUUID() }));
  const result = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(741206826)`),
    db.execute<{ id: string }>(sql`
      WITH target AS MATERIALIZED (
        SELECT id, name, code, type, status FROM organizations
        WHERE id = ${id}::uuid AND type IN ('private_assay_center', 'government_assay_center')
          AND NOT EXISTS (SELECT 1 FROM users WHERE organization_id = ${id}::uuid)
          AND NOT EXISTS (SELECT 1 FROM bullion_intake_batches WHERE assay_center_id = ${id}::uuid)
          AND NOT EXISTS (SELECT 1 FROM bullion_certificates WHERE assay_center_id = ${id}::uuid)
        FOR UPDATE
      ), audit AS (
        INSERT INTO audit_logs (actor_user_id, actor_organization_id, action, entity_type, entity_id, old_values, reason, previous_hash, entry_hash)
        SELECT ${user.id}::uuid, ${user.organizationId}::uuid, 'organization.deleted', 'organizations', id, to_jsonb(target), 'Unused assay center deleted',
          (SELECT entry_hash FROM audit_logs ORDER BY created_at DESC LIMIT 1), ${hash} FROM target
      ), deleted AS (
        DELETE FROM organizations WHERE id IN (SELECT id FROM target) RETURNING id
      ) SELECT id FROM deleted
    `),
  ]);
  if (!rows(result[1]).length) return c.json({ ok: false, message: "Ажилтан, харилцагч, гулдмай эсвэл гэрчилгээтэй сорьцын төвийг устгах боломжгүй. Төвийг архивлана уу." }, 409);
  return c.json({ ok: true });
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

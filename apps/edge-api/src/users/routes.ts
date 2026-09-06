import { Hono } from "hono";
import { isCenterManager } from "../../../../packages/shared/src/workspace-access";
import type { EdgeApiEnv } from "../app";
import { getAuthStore } from "../auth/auth-store";
import { getAuthenticatedUserFromRequest } from "../auth/http";

export const userRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

userRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const store = await getAuthStore(c.env);
  return c.json({ ok: true, data: await store!.listStaff(user) });
});

userRoutes.patch("/:id", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  if (!isCenterManager(user.role)) return c.json({ ok: false }, 403);
  const input = await c.req.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input)
    || Object.keys(input).some((key) => !["fullName", "role", "status", "reason"].includes(key))
    || typeof input.fullName !== "string" || input.fullName.trim().length < 2 || input.fullName.length > 200
    || !["chemist", "intake_officer"].includes(input.role) || !["active", "disabled"].includes(input.status)
    || typeof input.reason !== "string" || input.reason.trim().length < 3 || input.reason.length > 1000
    || !/^[0-9a-f-]{36}$/i.test(c.req.param("id"))) {
    return c.json({ ok: false, message: "Нэр, эрх, төлөв, өөрчлөлтийн шалтгааныг зөв оруулна уу." }, 400);
  }
  const store = await getAuthStore(c.env);
  const updated = await store!.updateStaff(c.req.param("id"), { ...input, fullName: input.fullName.trim(), reason: input.reason.trim() }, user);
  if (!updated) return c.json({ ok: false, message: "Засах эрхтэй ажилтан олдсонгүй." }, 404);
  return c.json({ ok: true });
});

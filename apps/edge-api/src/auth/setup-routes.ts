import { Hono } from "hono";

import type { EdgeApiEnv } from "../app";
import { getAuthStore } from "./auth-store";
import { setAuthCookie } from "./cookies";

export const setupRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

setupRoutes.get("/status", async (c) => {
  const store = await getAuthStore(c.env);
  if (!store) {
    return c.json({
      configured: false,
      needsFirstAdmin: false,
      message: "DATABASE_URL тохируулаагүй байна.",
    });
  }

  return c.json(await store.getSetupStatus());
});

setupRoutes.post("/first-admin", async (c) => {
  const store = await getAuthStore(c.env);
  if (!store) {
    return c.json(
      {
        ok: false,
        message: "Эхний админ үүсгэхийн өмнө DATABASE_URL тохируулна уу.",
      },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const result = await store
    .createFirstAdmin({
      setupToken: readText(body?.setupToken),
      organizationName: readText(body?.organizationName),
      organizationCode: readText(body?.organizationCode),
      email: readText(body?.email),
      fullName: readText(body?.fullName),
      password: readText(body?.password),
    })
    .catch(() => null);

  if (!result?.ok) {
    return c.json(
      {
        ok: false,
        message:
          result?.reason === "disabled"
            ? "Системийн эхний админ аль хэдийн үүссэн эсвэл setup token тохируулаагүй байна."
            : "Setup token эсвэл хэрэглэгчийн мэдээлэл буруу байна.",
      },
      403,
    );
  }

  setAuthCookie(c, result.token, result.expiresAt);
  return c.json({ ok: true, user: result.user });
});

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

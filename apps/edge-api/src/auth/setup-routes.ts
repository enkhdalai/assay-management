import { Hono } from "hono";

import { assertAcceptablePassword } from "../../../../packages/security/src";
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
        message: "Эхний супер админ үүсгэхийн өмнө DATABASE_URL тохируулна уу.",
      },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const input = {
    setupToken: readText(body?.setupToken),
    organizationName: readText(body?.organizationName),
    organizationCode: readText(body?.organizationCode),
    email: readText(body?.email),
    fullName: readText(body?.fullName),
    password: readText(body?.password),
  };
  const validationMessage = validateFirstAdminInput(input);

  if (validationMessage) {
    return c.json({ ok: false, message: validationMessage }, 400);
  }

  const result = await store
    .createFirstAdmin(input)
    .catch(() => null);

  if (!result?.ok) {
    return c.json(
      {
        ok: false,
        message:
          result?.reason === "disabled"
            ? "Системийн эхний супер админ аль хэдийн үүссэн эсвэл setup token тохируулаагүй байна."
            : "Setup token эсвэл хэрэглэгчийн мэдээлэл буруу байна.",
      },
      403,
    );
  }

  setAuthCookie(c, result.token, result.expiresAt);
  return c.json({ ok: true, user: result.user });
});

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateFirstAdminInput(input: {
  setupToken: string;
  organizationName: string;
  organizationCode: string;
  email: string;
  fullName: string;
  password: string;
}): string | null {
  if (!input.setupToken) return "Setup token оруулна уу.";
  if (input.organizationName.length < 2) return "Байгууллагын нэрийг зөв оруулна уу.";
  if (input.organizationCode.length < 2) return "Байгууллагын код дор хаяж 2 тэмдэгттэй байна.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    return "Супер админы имэйл хаягийг зөв оруулна уу.";
  }
  if (input.fullName.length < 2) return "Супер админы овог нэрийг зөв оруулна уу.";

  try {
    assertAcceptablePassword(input.password);
  } catch {
    return "Нууц үг дор хаяж 12 тэмдэгттэй, том үсэг, жижиг үсэг, тоо агуулсан байна.";
  }

  return null;
}

import { deleteCookie, getCookie } from "hono/cookie";
import { Hono } from "hono";

import { AUTH_SESSION_COOKIE } from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { getAuthStore } from "./auth-store";
import { canCreateInvitations, setAuthCookie } from "./cookies";
import { getAuthenticatedUserFromRequest } from "./http";
import { isFailedLoginRateLimited } from "../security/middleware";

export const authRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

authRoutes.post("/login", async (c) => {
  const store = await getAuthStore(c.env);
  if (!store) {
    return c.json(
      {
        ok: false,
        message: "Нэвтрэх үйлчилгээний өгөгдлийн сан хараахан холбогдоогүй байна.",
      },
      503,
    );
  }

  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email : "";
  const password = typeof body?.password === "string" ? body.password : "";

  if (!email || !password) {
    return c.json({ ok: false, message: "Имэйл болон нууц үгээ оруулна уу." }, 400);
  }

  const result = await store.login(email, password);

  if (!result.ok) {
    if (isFailedLoginRateLimited(c.req.raw, c.env)) {
      c.header("Retry-After", "900");
      return c.json({ ok: false, message: "Хэт олон амжилтгүй оролдлого хийсэн байна. 15 минутын дараа дахин оролдоно уу." }, 429);
    }
    const message =
      result.reason === "locked"
        ? "Хэт олон амжилтгүй оролдлого хийсэн тул түр түгжигдсэн байна."
        : "Имэйл эсвэл нууц үг буруу байна.";

    return c.json({ ok: false, message }, 401);
  }

  setAuthCookie(c, result.token, result.expiresAt);

  return c.json({
    ok: true,
    user: result.user,
  });
});

authRoutes.post("/logout", async (c) => {
  const store = await getAuthStore(c.env);
  await store?.revokeSession(getCookie(c, AUTH_SESSION_COOKIE));

  deleteCookie(c, AUTH_SESSION_COOKIE, {
    path: "/",
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
  });

  return c.json({ ok: true });
});

authRoutes.get("/me", async (c) => {
  const store = await getAuthStore(c.env);
  if (!store) return c.json({ ok: false }, 401);

  const token = getCookie(c, AUTH_SESSION_COOKIE);
  const user = await store.getUserBySessionToken(token);

  if (!user) return c.json({ ok: false }, 401);

  const expiresAt = await store.getSessionExpiresAt(token);
  if (!expiresAt) return c.json({ ok: false }, 401);

  return c.json({ ok: true, user, expiresAt: expiresAt.toISOString() });
});

authRoutes.post("/session/extend", async (c) => {
  const store = await getAuthStore(c.env);
  if (!store) return c.json({ ok: false }, 401);

  const token = getCookie(c, AUTH_SESSION_COOKIE);
  const expiresAt = await store.extendSession(token);
  if (!expiresAt || !token) return c.json({ ok: false, message: "Хэрэглэгчийн сесс дууссан байна." }, 401);

  setAuthCookie(c, token, expiresAt);
  return c.json({ ok: true, expiresAt: expiresAt.toISOString() });
});

authRoutes.post("/password", async (c) => {
  const store = await getAuthStore(c.env);
  if (!store) return c.json({ ok: false }, 401);

  const body = await c.req.json().catch(() => null);
  const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
  if (!currentPassword || !newPassword) return c.json({ ok: false, message: "Одоогийн болон шинэ нууц үгээ оруулна уу." }, 400);

  try {
    const updated = await store.changePassword(getCookie(c, AUTH_SESSION_COOKIE), currentPassword, newPassword);
    if (!updated) return c.json({ ok: false, message: "Одоогийн нууц үг буруу эсвэл сесс дууссан байна." }, 401);
    return c.json({ ok: true });
  } catch {
    return c.json({ ok: false, message: "Шинэ нууц үг нь 12-оос доошгүй тэмдэгттэй, том жижиг үсэг болон тоо агуулсан байна." }, 400);
  }
});

authRoutes.post("/invitations", async (c) => {
  const store = await getAuthStore(c.env);
  if (!store) return c.json({ ok: false, message: "Нэвтрэх үйлчилгээ идэвхгүй байна." }, 503);

  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);
  if (!canCreateInvitations(user)) {
    return c.json({ ok: false, message: "Хэрэглэгч урих эрхгүй байна." }, 403);
  }

  const body = await c.req.json().catch(() => null);

  if (!canInviteRole(user, readText(body?.role), readText(body?.organizationId) || user.organizationId)) {
    return c.json({ ok: false, message: "Зөвхөн өөрийн төвийн химич, хайлагчийг урих эрхтэй." }, 403);
  }

  try {
    const invitation = await store.createInvitation(
      {
        organizationId: readText(body?.organizationId) || user.organizationId,
        email: readText(body?.email),
        role: readText(body?.role),
      },
      user,
    );

    return c.json({ ok: true, invitation });
  } catch {
    return c.json({ ok: false, message: "Урилга үүсгэх боломжгүй байна." }, 400);
  }
});

authRoutes.post("/invitations/accept", async (c) => {
  const store = await getAuthStore(c.env);
  if (!store) return c.json({ ok: false, message: "Нэвтрэх үйлчилгээ идэвхгүй байна." }, 503);

  const body = await c.req.json().catch(() => null);
  const result = await store
    .acceptInvitation({
      token: readText(body?.token),
      fullName: readText(body?.fullName),
      password: readText(body?.password),
    })
    .catch(() => null);

  if (!result?.ok) {
    return c.json({ ok: false, message: "Урилга хүчингүй, цуцлагдсан эсвэл аль хэдийн ашиглагдсан байна." }, 400);
  }

  setAuthCookie(c, result.token, result.expiresAt);
  return c.json({ ok: true, user: result.user });
});

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
import { canInviteRole } from "../../../../packages/shared/src/workspace-access";

import { setCookie } from "hono/cookie";
import type { Context } from "hono";

import {
  AUTH_SESSION_COOKIE,
  SESSION_TTL_SECONDS,
} from "../../../../packages/security/src";
import type { AuthenticatedUser } from "../../../../packages/security/src";
import { isCenterManager } from "../../../../packages/shared/src/workspace-access";

export function setAuthCookie(
  c: Context,
  token: string,
  expiresAt: Date,
): void {
  setCookie(c, AUTH_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
    expires: expiresAt,
  });
}

export function canCreateInvitations(user: AuthenticatedUser): boolean {
  return isCenterManager(user.role);
}

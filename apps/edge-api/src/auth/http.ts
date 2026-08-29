import {
  AUTH_SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type AuthenticatedUser,
} from "../../../../packages/security/src";
import type { EdgeApiEnv } from "../app";
import { getAuthStore } from "./auth-store";

export { AUTH_SESSION_COOKIE, SESSION_TTL_SECONDS };

export async function getAuthenticatedUserFromRequest(
  request: Request,
  env?: Pick<
    EdgeApiEnv,
    | "DATABASE_URL"
    | "AUTH_DEV_LOGIN_ENABLED"
    | "AUTH_DEV_SEED_EMAIL"
    | "AUTH_DEV_SEED_PASSWORD"
  >,
): Promise<AuthenticatedUser | null> {
  const store = await getAuthStore(env);
  if (!store) return null;

  const cookie = request.headers.get("cookie");
  const token = readCookie(cookie, AUTH_SESSION_COOKIE);

  return store.getUserBySessionToken(token);
}

export function readCookie(
  cookieHeader: string | null,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined;

  const cookies = cookieHeader.split(";");
  for (const cookie of cookies) {
    const [rawName, ...rawValue] = cookie.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }

  return undefined;
}

export function isPublicWebPath(pathname: string): boolean {
  return (
    pathname === "/login" ||
    pathname === "/setup" ||
    pathname === "/invite" ||
    pathname === "/favicon.svg" ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/assets/") ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/__debug") ||
    pathname.startsWith("/_vinext/")
  );
}

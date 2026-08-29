import { randomBase64Url, sha256Base64Url } from "./encoding";

export const AUTH_SESSION_COOKIE = "assay_session";
export const SESSION_TOKEN_BYTES = 32;
export const SESSION_TTL_SECONDS = 60 * 60 * 8;

export type AuthenticatedUser = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
  email: string;
  fullName: string;
};

export function createSessionToken(): string {
  return randomBase64Url(SESSION_TOKEN_BYTES);
}

export async function hashSessionToken(token: string): Promise<string> {
  return sha256Base64Url(token);
}

export function sessionExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
}

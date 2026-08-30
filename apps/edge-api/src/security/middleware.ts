import type { MiddlewareHandler } from "hono";

import type { EdgeApiEnv } from "../app";

const MAX_JSON_BODY_BYTES = 64 * 1024;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const MEMORY_BUCKETS = new Map<string, { count: number; resetAt: number }>();

/**
 * Common policy for every browser-facing API route. Authorization remains in
 * the route modules, but request origin, response headers, and abuse limits
 * should never be reimplemented one endpoint at a time.
 */
export const apiSecurityMiddleware: MiddlewareHandler<{ Bindings: EdgeApiEnv }> = async (
  c,
  next,
) => {
  const request = c.req.raw;
  const method = request.method.toUpperCase();
  const url = new URL(request.url);
  const requestId = request.headers.get("x-request-id")?.trim() || crypto.randomUUID();

  if (!isValidRequestId(requestId)) {
    return securityError(c, 400, "Хүсэлтийн дугаар буруу байна.", requestId);
  }

  if (!SAFE_METHODS.has(method) && !isAllowedBrowserOrigin(request, url.origin)) {
    return securityError(c, 403, "Хүсэлтийн эх сурвалж зөвшөөрөгдөөгүй байна.", requestId);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BODY_BYTES) {
    return securityError(c, 413, "Хүсэлтийн хэмжээ хэтэрсэн байна.", requestId);
  }

  if (requiresJsonBody(request, method, url.pathname) && !isJsonRequest(request)) {
    return securityError(c, 415, "Зөвхөн JSON хүсэлт зөвшөөрнө.", requestId);
  }

  if (isRateLimited(request, c.env, url.pathname)) {
    const response = securityError(c, 429, "Хэт олон хүсэлт илгээгдлээ. Дараа дахин оролдоно уу.", requestId);
    response.headers.set("Retry-After", "60");
    return response;
  }

  await next();
  applyApiSecurityHeaders(c.res.headers, requestId);
};

export function applyApiSecurityHeaders(headers: Headers, requestId: string): void {
  headers.set("X-Request-Id", requestId);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Cache-Control", "no-store, private, max-age=0");
}

export function getTrustedClientIp(request: Request, allowLocalForwardedIp = false): string | null {
  const cloudflareIp = request.headers.get("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;
  if (!allowLocalForwardedIp) return null;

  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
}

function securityError(
  c: Parameters<MiddlewareHandler<{ Bindings: EdgeApiEnv }>>[0],
  status: number,
  message: string,
  requestId: string,
) {
  const response = c.json({ ok: false, message, requestId }, status as 400 | 403 | 413 | 415 | 429);
  applyApiSecurityHeaders(response.headers, requestId);
  return response;
}

function requiresJsonBody(request: Request, method: string, pathname: string): boolean {
  if (SAFE_METHODS.has(method)) return false;
  if (method === "POST" && pathname === "/api/auth/logout") return false;

  // A few command endpoints are deliberately body-less. Only enforce the JSON
  // media type when the caller declares that it is sending request content.
  const contentLength = request.headers.get("content-length");
  return contentLength !== null && Number(contentLength) > 0;
}

function isJsonRequest(request: Request): boolean {
  return request.headers.get("content-type")?.toLowerCase().includes("application/json") ?? false;
}

function isAllowedBrowserOrigin(request: Request, expectedOrigin: string): boolean {
  const origin = request.headers.get("origin");
  // Non-browser service requests have no Origin header. Those routes still have
  // their own authentication (for example the BOM HMAC policy).
  return !origin || origin === expectedOrigin;
}

function isValidRequestId(value: string): boolean {
  return value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function isRateLimited(request: Request, env: EdgeApiEnv, pathname: string): boolean {
  if (env.AUTH_DEV_LOGIN_ENABLED === "true" || env.RATE_LIMITING_ENABLED === "false") {
    return false;
  }

  const ip = getTrustedClientIp(request) ?? "unknown";
  const policy = ratePolicy(pathname);
  const key = `${policy.name}:${ip}`;
  const now = Date.now();
  const bucket = MEMORY_BUCKETS.get(key);

  if (!bucket || bucket.resetAt <= now) {
    MEMORY_BUCKETS.set(key, { count: 1, resetAt: now + policy.windowMs });
    return false;
  }

  bucket.count += 1;
  return bucket.count > policy.maxRequests;
}

function ratePolicy(pathname: string): { name: string; maxRequests: number; windowMs: number } {
  if (pathname === "/api/auth/login") {
    return { name: "login", maxRequests: 10, windowMs: 15 * 60 * 1000 };
  }
  if (pathname.startsWith("/api/setup/")) {
    return { name: "setup", maxRequests: 5, windowMs: 15 * 60 * 1000 };
  }
  if (pathname.startsWith("/api/bom/")) {
    return { name: "bom", maxRequests: 120, windowMs: 60 * 1000 };
  }
  return { name: "api", maxRequests: 240, windowMs: 60 * 1000 };
}

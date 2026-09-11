import { Hono } from "hono";

import { assayResultRoutes } from "./assay-results/routes";
import { assayRoutes } from "./assays/routes";
import { authRoutes } from "./auth/routes";
import { setupRoutes } from "./auth/setup-routes";
import { bomRoutes } from "./bom/routes";
import { bankRoutes } from "./banks/routes";
import { bullionRoutes } from "./bullion/routes";
import { customerRoutes } from "./customers/routes";
import { apiSecurityMiddleware, applyApiSecurityHeaders } from "./security/middleware";
import { userRoutes } from "./users/routes";
import { organizationRoutes } from "./organizations/routes";
import { reportRoutes } from "./bullion/reports";
import { integrationClientRoutes } from "./integrations/routes";
import { getAuthenticatedUserFromRequest } from "./auth/http";

export type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

export type EdgeApiEnv = {
  ASSETS: AssetFetcher;
  DB?: unknown;
  DATABASE_URL?: string;
  APP_ENV?: string;
  FIELD_ENCRYPTION_KEY?: string;
  AUTH_SETUP_TOKEN_HASH?: string;
  AUTH_DEV_LOGIN_ENABLED?: string;
  AUTH_DEV_SEED_EMAIL?: string;
  AUTH_DEV_SEED_PASSWORD?: string;
  RATE_LIMITING_ENABLED?: string;
  BOM_API_CLIENT_ID?: string;
  BOM_API_SIGNING_SECRET?: string;
  // Public CA material used to establish the MonPass/eSign certificate path.
  // The leaf certificate and private key remain in the user's token.
  MONPASS_TRUST_ROOT_CA_PEM?: string;
  MONPASS_TRUST_ISSUING_CA_PEM?: string;
  MONPASS_TRUST_CLASS2_4_CA_PEM?: string;
  MONPASS_OCSP_URL?: string;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: {
          format: string;
          quality: number;
        }): Promise<{ response(): Response }>;
      };
    };
  };
};

export const edgeApi = new Hono<{ Bindings: EdgeApiEnv }>().basePath("/api");

edgeApi.use("*", apiSecurityMiddleware);
// Restricted workspaces are allowlisted, including access to legacy APIs.
edgeApi.use("/v1/*", async (c, next) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  const path = c.req.path.replace(/\/$/, "");
  const method = c.req.method;
  if (user.role === "chemist") {
    const allowed = (path === "/api/v1/bullion/samples" && method === "GET")
      || (path === "/api/v1/bullion/examinations" && method === "POST")
      || (/^\/api\/v1\/bullion\/samples\/[0-9a-f-]+\/substitute-chemists$/.test(path) && method === "GET")
      || (/^\/api\/v1\/bullion\/samples\/[0-9a-f-]+\/substitute$/.test(path) && method === "POST");
    if (!allowed) return c.json({ ok: false, message: "Энэ хэсэгт хандах эрхгүй." }, 403);
  }
  if (user.role === "intake_officer") {
    const allowed = (path === "/api/v1/customers/lookup" && method === "GET")
      || (path === "/api/v1/customers" && method === "POST")
      || (path === "/api/v1/bullion/intakes" && ["GET", "POST"].includes(method))
      || (path === "/api/v1/bullion/intakes/next-number" && method === "GET")
      || (/^\/api\/v1\/bullion\/intakes\/[0-9a-f-]+$/.test(path) && method === "PATCH");
    if (!allowed) return c.json({ ok: false, message: "Энэ хэсэгт хандах эрхгүй." }, 403);
  }
  await next();
});

edgeApi.route("/auth", authRoutes);
edgeApi.route("/v1/assays", assayRoutes);
edgeApi.route("/v1/assay-results", assayResultRoutes);
edgeApi.route("/v1/customers", customerRoutes);
edgeApi.route("/v1/users", userRoutes);
edgeApi.route("/v1/organizations", organizationRoutes);
edgeApi.route("/v1/banks", bankRoutes);
edgeApi.route("/v1/bullion", bullionRoutes);
edgeApi.route("/v1/reports", reportRoutes);
edgeApi.route("/v1/integration-clients", integrationClientRoutes);
edgeApi.route("/setup", setupRoutes);
edgeApi.route("/bom/v1", bomRoutes);

edgeApi.get("/health", (c) =>
  c.json({
    ok: true,
    service: "assay-management",
    mode: "private-admin",
  }),
);

edgeApi.notFound((c) => {
  const requestId = c.req.header("x-request-id")?.trim() || crypto.randomUUID();
  const response = c.json({ ok: false, message: "API зам олдсонгүй.", requestId }, 404);
  applyApiSecurityHeaders(response.headers, requestId);
  return response;
});

edgeApi.onError((error, c) => {
  // Keep operational detail out of responses; sensitive requests can contain
  // financial and personal data. The request ID is safe to share for support.
  const requestId = c.req.header("x-request-id")?.trim() || crypto.randomUUID();
  const category = classifyOperationalError(error);
  console.error("Assay API request failed", {
    requestId,
    name: error instanceof Error ? error.name : "UnknownError",
    // This stays in the server log. Neon error details are essential for
    // diagnosing operational SQL failures, but must not be returned to clients.
    message: error instanceof Error ? error.message : String(error),
    category,
  });
  const response = c.json(
    { ok: false, message: "Системийн алдаа гарлаа.", requestId, code: category },
    500,
  );
  applyApiSecurityHeaders(response.headers, requestId);
  return response;
});

function classifyOperationalError(error: unknown): string {
  const message = error instanceof Error ? error.message.toLowerCase() : "";

  if (message.startsWith("auth_login_failed:")) {
    return message.replace("auth_login_failed:", "auth_");
  }

  if (message.includes("cpu") && message.includes("limit")) return "worker_cpu_limit";
  if (message.includes("relation") && message.includes("does not exist")) {
    return "database_schema_missing";
  }
  if (
    message.includes("database") ||
    message.includes("neon") ||
    message.includes("connect") ||
    message.includes("fetch failed")
  ) {
    return "database_connection_failed";
  }
  if (message.includes("pbkdf2") || message.includes("crypto")) return "password_crypto_failed";

  return "unexpected";
}

import { Hono } from "hono";

import { assayResultRoutes } from "./assay-results/routes";
import { assayRoutes } from "./assays/routes";
import { authRoutes } from "./auth/routes";
import { setupRoutes } from "./auth/setup-routes";
import { bomRoutes } from "./bom/routes";
import { bankRoutes } from "./banks/routes";
import { customerRoutes } from "./customers/routes";
import { apiSecurityMiddleware, applyApiSecurityHeaders } from "./security/middleware";
import { userRoutes } from "./users/routes";

export type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

export type EdgeApiEnv = {
  ASSETS: AssetFetcher;
  DB?: unknown;
  DATABASE_URL?: string;
  AUTH_SETUP_TOKEN_HASH?: string;
  AUTH_DEV_LOGIN_ENABLED?: string;
  AUTH_DEV_SEED_EMAIL?: string;
  AUTH_DEV_SEED_PASSWORD?: string;
  RATE_LIMITING_ENABLED?: string;
  BOM_API_CLIENT_ID?: string;
  BOM_API_SIGNING_SECRET?: string;
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

edgeApi.route("/auth", authRoutes);
edgeApi.route("/v1/assays", assayRoutes);
edgeApi.route("/v1/assay-results", assayResultRoutes);
edgeApi.route("/v1/customers", customerRoutes);
edgeApi.route("/v1/users", userRoutes);
edgeApi.route("/v1/banks", bankRoutes);
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
  console.error("Assay API request failed", { name: error.name });
  const requestId = c.req.header("x-request-id")?.trim() || crypto.randomUUID();
  const response = c.json({ ok: false, message: "Системийн алдаа гарлаа.", requestId }, 500);
  applyApiSecurityHeaders(response.headers, requestId);
  return response;
});

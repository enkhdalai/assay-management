import { Hono } from "hono";

import type { AssayApiRecord } from "../../../packages/shared/src/assay-types";
import { getAuthenticatedUserFromRequest } from "./auth/http";
import { authRoutes } from "./auth/routes";
import { setupRoutes } from "./auth/setup-routes";

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

const sampleAssay: AssayApiRecord = {
  id: "AC-260820-014",
  customerName: "Б. Энхбат",
  metal: "gold",
  grossWeightGrams: 126.45,
  purityPercent: 89.72,
  fineWeightGrams: 113.45,
  status: "manager_review",
  allocations: [
    { bankName: "Хаан банк", allocatedGrams: 70 },
    { bankName: "Голомт банк", allocatedGrams: 56.45 },
  ],
};

export const edgeApi = new Hono<{ Bindings: EdgeApiEnv }>().basePath("/api");

edgeApi.route("/auth", authRoutes);
edgeApi.route("/setup", setupRoutes);

edgeApi.get("/health", (c) =>
  c.json({
    ok: true,
    service: "assay-management",
    mode: "private-admin",
  }),
);

edgeApi.get("/v1/assays", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false, message: "Нэвтрэх шаардлагатай." }, 401);

  return c.json({
    data: [sampleAssay],
    securityNote:
      "Production endpoints will require signed requests, scoped roles, and append-only audit logging.",
  });
});

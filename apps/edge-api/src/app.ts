import { Hono } from "hono";

import type { AssayApiRecord } from "../../../packages/shared/src/assay-types";

export type AssetFetcher = {
  fetch(request: Request): Promise<Response>;
};

export type EdgeApiEnv = {
  ASSETS: AssetFetcher;
  DB?: unknown;
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

edgeApi.get("/health", (c) =>
  c.json({
    ok: true,
    service: "assay-management",
    mode: "private-admin",
  }),
);

edgeApi.get("/v1/assays", (c) =>
  c.json({
    data: [sampleAssay],
    securityNote:
      "Production endpoints will require signed requests, scoped roles, and append-only audit logging.",
  }),
);

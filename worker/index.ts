/** Cloudflare Worker entry point for the vinext-starter template. */
import { Hono } from "hono";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const api = new Hono<{ Bindings: Env }>().basePath("/api");

api.get("/health", (c) =>
  c.json({
    ok: true,
    service: "assay-management",
    mode: "private-admin",
  }),
);

api.get("/v1/assays", (c) =>
  c.json({
    data: [
      {
        id: "AC-260820-014",
        customer_name: "Б. Энхбат",
        metal: "gold",
        gross_weight_grams: 126.45,
        purity_percent: 89.72,
        fine_weight_grams: 113.45,
        status: "manager_review",
        allocations: [
          { bank: "Хаан банк", allocated_grams: 70 },
          { bank: "Голомт банк", allocated_grams: 56.45 },
        ],
      },
    ],
    security_note:
      "Production endpoints will require signed requests, scoped roles, and append-only audit logging.",
  }),
);

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;

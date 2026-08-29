/** Cloudflare Worker entry point for the assay management platform. */
import { edgeApi, type EdgeApiEnv } from "../apps/edge-api/src/app";
import {
  getAuthenticatedUserFromRequest,
  isPublicWebPath,
} from "../apps/edge-api/src/auth/http";
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

type Env = EdgeApiEnv & {
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
};

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return edgeApi.fetch(request, env);
    }

    if (url.pathname === "/login") {
      const user = await getAuthenticatedUserFromRequest(request, env);
      if (user) return Response.redirect(new URL("/", request.url), 303);
    } else if (!isPublicWebPath(url.pathname)) {
      const user = await getAuthenticatedUserFromRequest(request, env);
      if (!user) {
        const loginUrl = new URL("/login", request.url);
        loginUrl.searchParams.set("return_to", `${url.pathname}${url.search}`);
        return Response.redirect(loginUrl, 303);
      }
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

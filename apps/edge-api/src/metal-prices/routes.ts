import { Hono } from "hono";

import type { EdgeApiEnv } from "../app";
import { getAuthenticatedUserFromRequest } from "../auth/http";

type MetalPrice = { buy: number; sell: number; change: { absolute: number; percent: number } | null };
type MetalPrices = { rateDate: string; gold: MetalPrice; silver: MetalPrice };

let cachedPrices: { value: MetalPrices; expiresAt: number } | null = null;
let pendingPriceRequest: Promise<MetalPrices> | null = null;

export const metalPriceRoutes = new Hono<{ Bindings: EdgeApiEnv }>();

metalPriceRoutes.get("/", async (c) => {
  const user = await getAuthenticatedUserFromRequest(c.req.raw, c.env);
  if (!user) return c.json({ ok: false }, 401);
  try {
    return c.json({ ok: true, data: await getMetalPrices() });
  } catch {
    return c.json({ ok: false, message: "Монголбанкны үнэт металлын ханшийг авах боломжгүй байна." }, 502);
  }
});

async function getMetalPrices(): Promise<MetalPrices> {
  if (cachedPrices && cachedPrices.expiresAt > Date.now()) return cachedPrices.value;
  if (!pendingPriceRequest) {
    pendingPriceRequest = fetchMetalPrices().finally(() => { pendingPriceRequest = null; });
  }
  return pendingPriceRequest;
}

async function fetchMetalPrices(): Promise<MetalPrices> {
  const response = await fetch("https://www.mongolbank.mn/api/v1/pm", {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 60, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Mongolbank returned ${response.status}`);
  const body = await response.json() as { success?: boolean; result?: Record<string, unknown> };
  const result = body.success ? body.result : undefined;
  const rateDate = requiredText(result?.RATE_DATE);
  const gold = { buy: requiredNumber(result?.GOLD_BUY), sell: requiredNumber(result?.GOLD_SELL) };
  const silver = { buy: requiredNumber(result?.SILVER_BUY), sell: requiredNumber(result?.SILVER_SELL) };
  const historyResponse = await fetch(`https://www.mongolbank.mn/api/v1/pm/range?startDate=${daysBefore(rateDate, 14)}&endDate=${rateDate}`, {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  const historyBody = historyResponse.ok
    ? await historyResponse.json() as { success?: boolean; result?: Array<Record<string, unknown>> }
    : undefined;
  const previous = historyBody?.success
    ? (historyBody.result ?? []).filter((entry) => typeof entry.RATE_DATE === "string" && entry.RATE_DATE < rateDate).sort((a, b) => String(b.RATE_DATE).localeCompare(String(a.RATE_DATE)))[0]
    : undefined;
  const value: MetalPrices = {
    rateDate,
    gold: { ...gold, change: priceChange(gold.buy, previous?.GOLD_BUY) },
    silver: { ...silver, change: priceChange(silver.buy, previous?.SILVER_BUY) },
  };
  cachedPrices = { value, expiresAt: Date.now() + 5 * 60_000 };
  return value;
}

function daysBefore(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function priceChange(current: number, previous: unknown): { absolute: number; percent: number } | null {
  const prior = Number(String(previous ?? "").replaceAll(",", ""));
  if (!Number.isFinite(prior) || prior === 0) return null;
  const absolute = current - prior;
  return { absolute, percent: absolute / prior * 100 };
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Missing metal price date");
  return value;
}

function requiredNumber(value: unknown): number {
  const parsed = Number(String(value).replaceAll(",", ""));
  if (!Number.isFinite(parsed)) throw new Error("Invalid metal price");
  return parsed;
}

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
  const body = response.ok ? await response.json().catch(() => null) as { success?: boolean; result?: Record<string, unknown> } | null : null;
  const current = parseRate(body?.success ? body.result : undefined);
  const activeRate = current ?? await latestPublishedRate(todayInMongolia());
  const rateDate = activeRate.rateDate;
  const gold = activeRate.gold;
  const silver = activeRate.silver;
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

async function latestPublishedRate(endDate: string): Promise<{ rateDate: string; gold: Omit<MetalPrice, "change">; silver: Omit<MetalPrice, "change"> }> {
  const response = await fetch(`https://www.mongolbank.mn/api/v1/pm/range?startDate=${daysBefore(endDate, 14)}&endDate=${endDate}`, {
    headers: { accept: "application/json" },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  const body = response.ok
    ? await response.json().catch(() => null) as { success?: boolean; result?: Array<Record<string, unknown>> } | null
    : null;
  const latest = body?.success ? [...(body.result ?? [])].sort((left, right) => String(right.RATE_DATE).localeCompare(String(left.RATE_DATE))).find(parseRate) : undefined;
  const parsed = latest && parseRate(latest);
  if (!parsed) throw new Error("Mongolbank did not return a recent metal price");
  return parsed;
}

function parseRate(value: Record<string, unknown> | undefined): { rateDate: string; gold: Omit<MetalPrice, "change">; silver: Omit<MetalPrice, "change"> } | null {
  try {
    return {
      rateDate: requiredText(value?.RATE_DATE),
      gold: { buy: requiredNumber(value?.GOLD_BUY), sell: requiredNumber(value?.GOLD_SELL) },
      silver: { buy: requiredNumber(value?.SILVER_BUY), sell: requiredNumber(value?.SILVER_SELL) },
    };
  } catch { return null; }
}

function todayInMongolia(): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ulaanbaatar", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
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

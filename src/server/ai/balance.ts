import { DateTime } from "luxon";

import { formatUsd } from "@/lib/format-usd";
import { cabinetMonthlyAiLimit, isAiLiveEnabled } from "@/server/ai/live-guard";
import { createAiFetch } from "@/server/http/outbound-fetch";

export { formatUsd };

export type AiBalanceResult = {
  remainingUsd: number | null;
  source: "credit_grants" | "subscription" | "none";
  message: string;
};

const TIMEOUT_MS = 5_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function parseCreditGrants(json: unknown): number | null {
  const body = asRecord(json);
  if (!body) {
    return null;
  }
  const available = asFiniteNumber(body.total_available);
  if (available != null) {
    return available;
  }
  const granted = asFiniteNumber(body.total_granted);
  const used = asFiniteNumber(body.total_used);
  if (granted != null && used != null) {
    return granted - used;
  }
  const nested = asRecord(body.data);
  if (nested) {
    return parseCreditGrants(nested);
  }
  return asFiniteNumber(body.balance);
}

export function remainingFromSubscription(subscription: unknown, usage: unknown): number | null {
  const sub = asRecord(subscription);
  const usedBody = asRecord(usage);
  if (!sub || !usedBody) {
    return null;
  }
  const limit =
    asFiniteNumber(sub.hard_limit_usd) ?? asFiniteNumber(sub.system_hard_limit_usd) ?? asFiniteNumber(sub.soft_limit_usd);
  const rawUsage = asFiniteNumber(usedBody.total_usage);
  if (limit == null || rawUsage == null) {
    return null;
  }
  const usedUsd = rawUsage > limit ? rawUsage / 100 : rawUsage;
  return limit - usedUsd;
}

export function creditGrantUrls(baseUrl: string) {
  const base = baseUrl.replace(/\/$/, "");
  const origin = base.replace(/\/v1$/, "");
  return [
    `${origin}/dashboard/billing/credit_grants`,
    `${base}/dashboard/billing/credit_grants`,
    `${origin}/v1/dashboard/billing/credit_grants`,
  ];
}

async function readJson(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

async function getJson(
  fetchImpl: typeof fetch,
  url: string,
  apiKey: string,
): Promise<{ ok: boolean; status: number; json: unknown }> {
  const response = await fetchImpl(url, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { ok: response.ok, status: response.status, json: await readJson(response) };
}

export async function fetchAiBalance(options: {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}): Promise<AiBalanceResult> {
  if (!options.fetchImpl && (!isAiLiveEnabled() || cabinetMonthlyAiLimit() == null)) {
    return {
      remainingUsd: null,
      source: "none",
      message: "Платные AI-запросы выключены. Остаток ChatGPT не запрашивается, пока не согласован бюджет.",
    };
  }
  const fetchImpl = options.fetchImpl ?? createAiFetch();
  const empty: AiBalanceResult = {
    remainingUsd: null,
    source: "none",
    message: "Ключ не дал прочитать остаток. Цифра не выдумывается.",
  };

  try {
    const grantReads = await Promise.all(
      creditGrantUrls(options.baseUrl).map((url) => getJson(fetchImpl, url, options.apiKey)),
    );
    for (const result of grantReads) {
      if (!result.ok) {
        continue;
      }
      const remaining = parseCreditGrants(result.json);
      if (remaining == null) {
        continue;
      }
      return {
        remainingUsd: remaining,
        source: "credit_grants",
        message: remaining <= 0 ? "На счёте ChatGPT нет средств." : "Остаток с prepaid-счёта ChatGPT.",
      };
    }

    const origin = options.baseUrl.replace(/\/$/, "").replace(/\/v1$/, "");
    const now = DateTime.fromJSDate(options.now?.() ?? new Date(), { zone: "utc" });
    const start = now.startOf("month").toFormat("yyyy-MM-dd");
    const end = now.plus({ days: 1 }).toFormat("yyyy-MM-dd");
    const [subscription, usage] = await Promise.all([
      getJson(fetchImpl, `${origin}/dashboard/billing/subscription`, options.apiKey),
      getJson(fetchImpl, `${origin}/dashboard/billing/usage?start_date=${start}&end_date=${end}`, options.apiKey),
    ]);
    if (subscription.ok && usage.ok) {
      const remaining = remainingFromSubscription(subscription.json, usage.json);
      if (remaining != null) {
        return {
          remainingUsd: remaining,
          source: "subscription",
          message: remaining <= 0 ? "Лимит ChatGPT на месяц исчерпан." : "Остаток лимита ChatGPT на этот месяц.",
        };
      }
    }
    return empty;
  } catch {
    return {
      remainingUsd: null,
      source: "none",
      message: "Сеть до ChatGPT не ответила. Остаток неизвестен, цифра не подставляется.",
    };
  }
}

import { AccessError } from "@/modules/access/permissions";

export type PaidAiDenial = "live_disabled" | "budget_unset" | "budget_exhausted";

export function isAiLiveEnabled() {
  return process.env.AI_LIVE_ENABLED === "true";
}

export function cabinetMonthlyAiLimit(): number | null {
  const raw = process.env.AI_MONTHLY_HARD_LIMIT?.trim();
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

export function assertAiLiveEnabled() {
  if (!isAiLiveEnabled()) {
    throw new AccessError(
      403,
      "Платные AI-запросы выключены. Не включайте AI_LIVE_ENABLED, пока не согласован бюджет.",
    );
  }
}

export function assertPaidAiAllowed() {
  assertAiLiveEnabled();
  if (cabinetMonthlyAiLimit() == null) {
    throw new AccessError(
      403,
      "Платные AI-запросы выключены: не задан AI_MONTHLY_HARD_LIMIT. Это общий лимит кабинета, не тариф.",
    );
  }
}

export function paidAiDenialMessage(reason: PaidAiDenial, limit?: number) {
  if (reason === "live_disabled") {
    return "Платные AI-запросы выключены. Не включайте AI_LIVE_ENABLED, пока не согласован бюджет.";
  }
  if (reason === "budget_unset") {
    return "Платные AI-запросы выключены: не задан AI_MONTHLY_HARD_LIMIT. Это общий лимит кабинета, не тариф.";
  }
  return `Общий лимит AI-запросов кабинета на месяц исчерпан (${limit ?? 0}).`;
}

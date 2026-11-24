import { AccessError } from "@/modules/access/permissions";

export function isAiLiveEnabled() {
  return process.env.AI_LIVE_ENABLED === "true";
}

export function assertAiLiveEnabled() {
  if (!isAiLiveEnabled()) {
    throw new AccessError(
      403,
      "Платные AI-запросы выключены. Не включайте AI_LIVE_ENABLED, пока не согласован бюджет.",
    );
  }
}

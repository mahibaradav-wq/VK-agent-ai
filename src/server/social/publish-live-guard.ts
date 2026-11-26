import type { PublishOutcome } from "@/server/social/types";

/**
 * Fail-closed live social publish across all environments (production,
 * development, test). Real VK/Telegram publishing requires explicit
 * `SOCIAL_PUBLISH_LIVE=true` (strict equality).
 */
export function isSocialPublishLiveEnabled() {
  return process.env.SOCIAL_PUBLISH_LIVE === "true";
}

export function socialPublishLiveBlockedOutcome(): Extract<PublishOutcome, { kind: "permanent_failure" }> {
  return {
    kind: "permanent_failure",
    code: "social_publish_disabled",
    message:
      "Живые публикации в VK/Telegram выключены. Задайте SOCIAL_PUBLISH_LIVE=true только после явного решения владельца.",
  };
}

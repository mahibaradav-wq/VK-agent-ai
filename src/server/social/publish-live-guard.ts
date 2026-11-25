import type { PublishOutcome } from "@/server/social/types";

/**
 * Fail-closed live social publish on the production cabinet path
 * (`POLKA_REQUIRE_PROD_SECRETS=true`, as set in docker-compose.prod.yml).
 * Local/dev/tests keep adapters usable (tokens still required); set
 * `SOCIAL_PUBLISH_LIVE=false` to force-block locally.
 */
export function isSocialPublishLiveEnabled() {
  if (process.env.POLKA_REQUIRE_PROD_SECRETS === "true") {
    return process.env.SOCIAL_PUBLISH_LIVE === "true";
  }
  return process.env.SOCIAL_PUBLISH_LIVE !== "false";
}

export function socialPublishLiveBlockedOutcome(): PublishOutcome {
  return {
    kind: "permanent_failure",
    code: "social_publish_disabled",
    message:
      "Живые публикации в VK/Telegram выключены. Задайте SOCIAL_PUBLISH_LIVE=true только после явного решения владельца.",
  };
}

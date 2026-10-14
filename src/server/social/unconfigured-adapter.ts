import type { SocialAdapter } from "@/server/social/types";

export function createUnconfiguredAdapter(platform: string): SocialAdapter {
  return {
    platform,
    async publish() {
      return {
        kind: "permanent_failure",
        code: "integration_not_configured",
        message: `Публикация в ${platform} недоступна: требуется настройка официальной интеграции.`,
      };
    },
  };
}

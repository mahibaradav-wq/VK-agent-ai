import type { SocialAdapter } from "@/server/social/types";

export function createVkAdapter(): SocialAdapter {
  return {
    platform: "vk",
    async publish() {
      return {
        kind: "permanent_failure",
        code: "integration_not_configured",
        message:
          "Публикация во ВКонтакте недоступна: нужен официальный VK ID. Authorization Code Flow отключён с 25 июня 2024, право wall выдаётся через поддержку. Пароль VK не принимается.",
      };
    },
  };
}

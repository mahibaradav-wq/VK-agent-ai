import { vkUnavailableMessage } from "@/modules/posts/platforms";
import type { SocialAdapter } from "@/server/social/types";

export function createVkAdapter(): SocialAdapter {
  return {
    platform: "vk",
    async publish() {
      return {
        kind: "permanent_failure",
        code: "integration_not_configured",
        message: vkUnavailableMessage,
      };
    },
  };
}

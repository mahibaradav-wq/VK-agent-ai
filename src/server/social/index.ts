import type { PrismaClient } from "@prisma/client";

import { createTelegramAdapter } from "@/server/social/telegram-adapter";
import { createUnconfiguredAdapter } from "@/server/social/unconfigured-adapter";
import { createVkAdapter } from "@/server/social/vk-adapter";
import type { AdapterRegistry, SocialAdapter } from "@/server/social/types";

export type { AdapterRegistry, PublishInput, PublishOutcome, SocialAdapter } from "@/server/social/types";
export { createUnconfiguredAdapter } from "@/server/social/unconfigured-adapter";
export { createTelegramAdapter } from "@/server/social/telegram-adapter";
export { createVkAdapter } from "@/server/social/vk-adapter";
export { FIRST_SOCIAL_PLATFORM, socialPlatformCatalog } from "@/modules/social/catalog";

export function createAdapterRegistry(adapters: SocialAdapter[] = []): AdapterRegistry {
  const map = new Map(adapters.map((adapter) => [adapter.platform, adapter]));
  return {
    get(platform: string) {
      return map.get(platform) ?? createUnconfiguredAdapter(platform);
    },
  };
}

export function createDefaultAdapters(db: PrismaClient): AdapterRegistry {
  return createAdapterRegistry([createTelegramAdapter({ db }), createVkAdapter()]);
}

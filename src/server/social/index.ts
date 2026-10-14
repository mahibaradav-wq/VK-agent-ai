import { createUnconfiguredAdapter } from "@/server/social/unconfigured-adapter";
import type { AdapterRegistry, SocialAdapter } from "@/server/social/types";

export type { AdapterRegistry, PublishInput, PublishOutcome, SocialAdapter } from "@/server/social/types";
export { createUnconfiguredAdapter } from "@/server/social/unconfigured-adapter";

export function createAdapterRegistry(adapters: SocialAdapter[] = []): AdapterRegistry {
  const map = new Map(adapters.map((adapter) => [adapter.platform, adapter]));
  return {
    get(platform: string) {
      return map.get(platform) ?? createUnconfiguredAdapter(platform);
    },
  };
}

export function createDefaultAdapters(): AdapterRegistry {
  return createAdapterRegistry();
}

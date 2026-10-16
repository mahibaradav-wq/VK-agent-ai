import { AccessError } from "@/modules/access/permissions";
import type { QueueDriver } from "@/server/queue/types";

export function createUnconfiguredQueue(): QueueDriver {
  return {
    driver: "unconfigured",
    ready: false,
    async addPublishJob() {
      throw new AccessError(400, "Очередь публикаций недоступна: требуется настройка интеграции Redis/BullMQ.");
    },
  };
}

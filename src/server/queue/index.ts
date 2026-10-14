import { createBullmqQueue } from "@/server/queue/bullmq-queue";
import { createInlineQueue } from "@/server/queue/inline-queue";
import { createUnconfiguredQueue } from "@/server/queue/unconfigured-queue";
import type { QueueDriver } from "@/server/queue/types";

export type { QueueDriver } from "@/server/queue/types";
export { createBullmqQueue, PUBLISH_QUEUE_NAME } from "@/server/queue/bullmq-queue";
export { createInlineQueue } from "@/server/queue/inline-queue";
export { createUnconfiguredQueue } from "@/server/queue/unconfigured-queue";

export function createQueueFromEnv(): QueueDriver {
  const driver = process.env.QUEUE_DRIVER?.trim() || (process.env.REDIS_URL?.trim() ? "redis" : "inline");

  if (driver === "redis") {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      return createUnconfiguredQueue();
    }
    return createBullmqQueue(url);
  }

  if (driver === "unconfigured") {
    return createUnconfiguredQueue();
  }

  return createInlineQueue();
}

const globalForQueue = globalThis as typeof globalThis & { publishQueue?: QueueDriver };

export function getPublishQueue(): QueueDriver {
  globalForQueue.publishQueue ??= createQueueFromEnv();
  return globalForQueue.publishQueue;
}

import { Queue } from "bullmq";
import IORedis from "ioredis";

import type { QueueDriver } from "@/server/queue/types";

export const PUBLISH_QUEUE_NAME = "polka-publish";

export function createBullmqQueue(redisUrl: string): QueueDriver {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(PUBLISH_QUEUE_NAME, { connection });

  return {
    driver: "redis",
    ready: true,
    async addPublishJob(jobId, delayMs = 0) {
      await queue.add(
        "publish",
        { jobId },
        {
          delay: delayMs,
          removeOnComplete: 200,
          removeOnFail: 200,
        },
      );
    },
    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}

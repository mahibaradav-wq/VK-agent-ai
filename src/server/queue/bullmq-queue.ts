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
      try {
        await queue.add(
          "publish",
          { jobId },
          {
            // Stable id prevents duplicate BullMQ entries for the same PostgreSQL job.
            jobId: `publish:${jobId}`,
            delay: delayMs,
            removeOnComplete: 200,
            removeOnFail: 200,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/already exists|duplicate/i.test(message)) {
          return;
        }
        throw error;
      }
    },
    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}

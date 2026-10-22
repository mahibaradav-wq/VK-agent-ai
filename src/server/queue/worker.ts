import { Worker } from "bullmq";
import IORedis from "ioredis";
import os from "node:os";

import { createPublishService } from "@/modules/publishing/publish-service";
import { PUBLISH_QUEUE_NAME } from "@/server/queue/bullmq-queue";
import { prisma } from "@/server/db/prisma";

const workerId = `${os.hostname()}:${process.pid}`;
const redisUrl = process.env.REDIS_URL?.trim();
const publishing = createPublishService(prisma);

async function tick() {
  await publishing.enqueueDueSchedules();
  await publishing.processDueJobs(workerId);
}

async function main() {
  console.info(`[polka-worker] start ${workerId}`);
  await tick();

  const timer = setInterval(() => {
    void tick().catch((error: unknown) => {
      console.error("[polka-worker] poll failed", error);
    });
  }, 5_000);

  let bull: Worker | undefined;
  let connection: IORedis | undefined;
  if (redisUrl) {
    connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    bull = new Worker(
      PUBLISH_QUEUE_NAME,
      async (job) => {
        const jobId = String(job.data.jobId ?? "");
        if (!jobId) {
          return;
        }
        await publishing.processJob(jobId, workerId);
      },
      { connection },
    );
    bull.on("failed", (job, error) => {
      console.error(`[polka-worker] bullmq job ${job?.id} failed`, error);
    });
    console.info("[polka-worker] BullMQ connected");
  } else {
    console.warn("[polka-worker] REDIS_URL не задан: обработчик забирает задачи из PostgreSQL.");
  }

  const shutdown = async () => {
    clearInterval(timer);
    await bull?.close();
    await connection?.quit();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error: unknown) => {
  console.error("[polka-worker] fatal", error);
  process.exit(1);
});

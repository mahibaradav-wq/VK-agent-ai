import { Worker } from "bullmq";
import IORedis from "ioredis";
import dns from "node:dns";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

dns.setDefaultResultOrder("ipv4first");

import { recoverPendingOverageSettlements, sanitizeDiagnosticError } from "@/modules/ai/paid-settlement";
import { createPublishService } from "@/modules/publishing/publish-service";
import { PUBLISH_QUEUE_NAME } from "@/server/queue/bullmq-queue";
import { prisma } from "@/server/db/prisma";
import { assertAuthSecret, assertProductionCabinetGuards } from "@/server/security/secrets";

const workerId = `${os.hostname()}:${process.pid}`;
const redisUrl = process.env.REDIS_URL?.trim();
const publishing = createPublishService(prisma);

export async function runWorkerTick(id = workerId) {
  await recoverPendingOverageSettlements(prisma)
    .then((summary) => {
      if (summary.failed > 0) {
        console.error("[polka-worker] ai overage recovery incomplete", sanitizeDiagnosticError(JSON.stringify(summary)));
      }
    })
    .catch((error: unknown) => {
      console.error("[polka-worker] ai overage recovery failed", sanitizeDiagnosticError(error));
    });
  await publishing.enqueueDueSchedules();
  await publishing.processDueJobs(id);
}

export function createWorkerLoop(options: {
  runTick: () => Promise<void>;
  onTickError?: (error: unknown) => void;
  close?: () => Promise<void>;
  intervalMs?: number;
}) {
  let activeTick: Promise<void> | null = null;
  let stopping = false;
  let shutdownPromise: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const triggerTick = () => {
    if (stopping) {
      return activeTick ?? Promise.resolve();
    }
    if (activeTick) {
      return activeTick;
    }
    const run = options
      .runTick()
      .catch((error: unknown) => {
        options.onTickError?.(error);
      })
      .finally(() => {
        if (activeTick === run) {
          activeTick = null;
        }
      });
    activeTick = run;
    return run;
  };

  return {
    triggerTick,
    startTimer() {
      if (!timer && !stopping) {
        timer = setInterval(() => {
          void triggerTick();
        }, options.intervalMs ?? 5_000);
      }
    },
    shutdown() {
      if (shutdownPromise) {
        return shutdownPromise;
      }
      stopping = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      shutdownPromise = (async () => {
        if (activeTick) {
          await activeTick;
        }
        await options.close?.();
      })();
      return shutdownPromise;
    },
    isStopping() {
      return stopping;
    },
  };
}

function assertWorkerBootGuards() {
  assertAuthSecret();
  if (process.env.POLKA_REQUIRE_PROD_SECRETS === "true" || process.env.NODE_ENV === "production") {
    assertProductionCabinetGuards();
  }
}

export async function startWorkerLoop(options: {
  runTick: () => Promise<void>;
  onTickError?: (error: unknown) => void;
  onShutdownError?: (error: unknown) => void;
  close?: () => Promise<void>;
  intervalMs?: number;
  onSignal: (signal: "SIGINT" | "SIGTERM", handler: () => void) => void;
  exit?: () => void;
}) {
  const loop = createWorkerLoop(options);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void loop.shutdown().then(
      () => options.exit?.(),
      (error: unknown) => options.onShutdownError?.(error),
    );
  };

  // Install signal handlers before the first awaited tick. SIGTERM during startup
  // must wait for that tick and close resources instead of terminating immediately.
  options.onSignal("SIGINT", shutdown);
  options.onSignal("SIGTERM", shutdown);

  await loop.triggerTick();
  loop.startTimer();
  return loop;
}

async function main() {
  assertWorkerBootGuards();
  console.info(`[polka-worker] start ${workerId}`);

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
      console.error(`[polka-worker] bullmq job ${job?.id} failed`, sanitizeDiagnosticError(error));
    });
    console.info("[polka-worker] BullMQ connected");
  } else {
    console.warn("[polka-worker] REDIS_URL не задан: обработчик забирает задачи из PostgreSQL.");
  }

  await startWorkerLoop({
    runTick: () => runWorkerTick(workerId),
    onTickError: (error) => {
      console.error("[polka-worker] poll failed", sanitizeDiagnosticError(error));
    },
    onShutdownError: (error) => {
      console.error("[polka-worker] shutdown failed", sanitizeDiagnosticError(error));
      process.exit(1);
    },
    close: async () => {
      await bull?.close();
      await connection?.quit();
      await prisma.$disconnect();
    },
    onSignal: (signal, handler) => process.on(signal, handler),
    exit: () => process.exit(0),
  });
}

const isMainEntry =
  Boolean(process.argv[1]) &&
  !process.env.VITEST &&
  pathToFileURL(path.resolve(process.argv[1]!)).href === import.meta.url;

if (isMainEntry) {
  void main().catch((error: unknown) => {
    console.error("[polka-worker] fatal", sanitizeDiagnosticError(error));
    process.exit(1);
  });
}

import type { QueueDriver } from "@/server/queue/types";

export type InlineQueuedJob = {
  jobId: string;
  delayMs: number;
};

export function createInlineQueue(): QueueDriver & { jobs: InlineQueuedJob[] } {
  const jobs: InlineQueuedJob[] = [];
  return {
    driver: "inline",
    ready: true,
    jobs,
    async addPublishJob(jobId, delayMs = 0) {
      jobs.push({ jobId, delayMs });
    },
  };
}

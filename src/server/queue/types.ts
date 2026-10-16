export type QueueDriver = {
  driver: "redis" | "inline" | "unconfigured";
  ready: boolean;
  addPublishJob: (jobId: string, delayMs?: number) => Promise<void>;
  close?: () => Promise<void>;
};

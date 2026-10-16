import type { PostStatus, PostTargetStatus } from "@prisma/client";

export function aggregatePostStatus(targets: Array<{ status: PostTargetStatus }>): PostStatus {
  const active = targets.filter((target) => target.status !== "cancelled");
  if (active.length === 0) {
    return "cancelled";
  }
  if (active.every((target) => target.status === "published")) {
    return "published";
  }
  if (active.some((target) => target.status === "publishing")) {
    return "publishing";
  }
  if (active.some((target) => target.status === "queued")) {
    return "queued";
  }
  if (active.some((target) => target.status === "scheduled")) {
    return "scheduled";
  }
  return "failed";
}

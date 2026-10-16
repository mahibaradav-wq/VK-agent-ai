import type { Prisma, PrismaClient, PublishAttemptKind, PublishJobStatus } from "@prisma/client";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { assertApprovedVersion } from "@/modules/collaboration/approval";
import { aggregatePostStatus } from "@/modules/publishing/aggregate";
import { defaultBackoffMs, nextBackoffMs } from "@/modules/publishing/backoff";
import { createDefaultAdapters, type AdapterRegistry, type PublishOutcome } from "@/server/social";
import { getPublishQueue, type QueueDriver } from "@/server/queue";

const jobInclude = {
  post: {
    include: {
      project: true,
      targets: { orderBy: { platform: "asc" as const } },
      versions: { orderBy: { number: "desc" as const } },
      media: { include: { media: true }, orderBy: { sortOrder: "asc" as const } },
      schedule: true,
    },
  },
  attempts: { orderBy: { startedAt: "desc" as const } },
} satisfies Prisma.PublishJobInclude;

export type PublishJobRecord = Prisma.PublishJobGetPayload<{ include: typeof jobInclude }>;

const enqueueableTargetStatuses = ["approved", "scheduled", "failed", "queued"] as const;

const postLoadInclude = {
  targets: true,
  versions: { orderBy: { number: "desc" as const } },
  media: { include: { media: true }, orderBy: { sortOrder: "asc" as const } },
  schedule: true,
} satisfies Prisma.PostInclude;

type LoadedPost = Prisma.PostGetPayload<{ include: typeof postLoadInclude }>;

function currentVersion(post: { versions: LoadedPost["versions"] }) {
  return post.versions.find((version) => !version.supersededAt) ?? post.versions[0] ?? null;
}

function jobKey(postId: string, versionId: string) {
  return `post:${postId}:version:${versionId}`;
}

function lastAttempt(attempts: Array<{ targetId: string; kind: PublishAttemptKind; attemptNumber: number }>, targetId: string) {
  return attempts
    .filter((attempt) => attempt.targetId === targetId)
    .sort((left, right) => right.attemptNumber - left.attemptNumber)[0];
}

function statusFromKind(kind: PublishAttemptKind) {
  if (kind === "success") {
    return "published" as const;
  }
  if (kind === "unknown") {
    return "requires_manual_check" as const;
  }
  return "failed" as const;
}

function isActiveJob(status: PublishJobStatus) {
  return status === "pending" || status === "claimed" || status === "processing";
}

export function createPublishService(
  db: PrismaClient,
  options?: {
    queue?: QueueDriver;
    adapters?: AdapterRegistry;
    backoff?: number[];
    now?: () => Date;
  },
) {
  const access = createAccessService(db);
  const queue = options?.queue ?? getPublishQueue();
  const adapters = options?.adapters ?? createDefaultAdapters(db);
  const backoff = options?.backoff ?? defaultBackoffMs;
  const now = options?.now ?? (() => new Date());

  async function loadBoundPost(workspaceId: string, postId: string) {
    const post = await db.post.findUnique({
      where: { id: postId },
      include: postLoadInclude,
    });
    assertWorkspaceBound(workspaceId, post, "Публикация");
    return post;
  }

  async function dispatch(jobId: string, delayMs = 0) {
    try {
      await queue.addPublishJob(jobId, delayMs);
    } catch (error) {
      const message =
        error instanceof AccessError
          ? error.message
          : "Диспетчер очереди недоступен: требуется настройка интеграции Redis/BullMQ.";
      await db.publishJob.update({
        where: { id: jobId },
        data: { lastError: message },
      });
      throw error instanceof AccessError ? error : new AccessError(400, message);
    }
  }

  async function createOrReuseJob(post: LoadedPost, actorId: string | null) {
    const version = currentVersion(post);
    if (!version) {
      throw new AccessError(400, "У публикации нет версии для отправки.");
    }
    if (post.targets.length === 0) {
      throw new AccessError(400, "Добавьте хотя бы одну цель публикации.");
    }
    if (post.status === "cancelled") {
      throw new AccessError(403, "Отменённую публикацию нельзя ставить в очередь.");
    }
    if (post.status === "publishing") {
      throw new AccessError(403, "Публикация уже обрабатывается.");
    }
    await assertApprovedVersion(db, post);

    const retryable = post.targets.filter((target) =>
      enqueueableTargetStatuses.includes(target.status as (typeof enqueueableTargetStatuses)[number]),
    );
    if (retryable.length === 0) {
      const allDone = post.targets.every((target) => target.status === "published" || target.status === "cancelled");
      throw new AccessError(
        400,
        allDone
          ? "Все цели уже опубликованы, повторная отправка запрещена."
          : "Нет целей, которые можно поставить в очередь. Успешные и неопределённые цели повторно не отправляются.",
      );
    }

    const key = jobKey(post.id, version.id);

    const result = await db.$transaction(async (tx) => {
      const existing = await tx.publishJob.findUnique({ where: { idempotencyKey: key } });
      if (existing && isActiveJob(existing.status)) {
        return { job: existing, created: false as const, dispatch: existing.status === "pending" };
      }

      await tx.post.update({
        where: { id: post.id },
        data: { status: "queued" },
      });
      await tx.postTarget.updateMany({
        where: { postId: post.id, status: { in: [...enqueueableTargetStatuses] } },
        data: { status: "queued", lastError: null },
      });

      if (existing) {
        const job = await tx.publishJob.update({
          where: { id: existing.id },
          data: {
            status: "pending",
            attemptCount: 0,
            claimedAt: null,
            claimedBy: null,
            nextAttemptAt: null,
            lastError: null,
            createdById: actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "RETRY_PUBLISH_JOB",
            entityType: "publish_job",
            entityId: job.id,
            actorId,
            details: post.id,
          },
        });
        return { job, created: false as const, dispatch: true as const };
      }

      try {
        const job = await tx.publishJob.create({
          data: {
            workspaceId: post.workspaceId,
            postId: post.id,
            postVersionId: version.id,
            idempotencyKey: key,
            status: "pending",
            createdById: actorId,
          },
        });
        await tx.auditLog.create({
          data: {
            action: "ENQUEUE_PUBLISH_JOB",
            entityType: "publish_job",
            entityId: job.id,
            actorId,
            details: key,
          },
        });
        return { job, created: true as const, dispatch: true as const };
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
          const job = await tx.publishJob.findUniqueOrThrow({ where: { idempotencyKey: key } });
          return { job, created: false as const, dispatch: isActiveJob(job.status) && job.status === "pending" };
        }
        throw error;
      }
    });

    return result;
  }

  return {
    async list(userId: string, workspaceId: string) {
      await access.requirePermission(userId, workspaceId, "post.view");
      return db.publishJob.findMany({
        where: { workspaceId },
        include: jobInclude,
        orderBy: { createdAt: "desc" },
        take: 50,
      });
    },

    async getForPost(userId: string, workspaceId: string, postId: string) {
      await access.requirePermission(userId, workspaceId, "post.view");
      await loadBoundPost(workspaceId, postId);
      return db.publishJob.findFirst({
        where: { workspaceId, postId },
        include: jobInclude,
        orderBy: { createdAt: "desc" },
      });
    },

    async enqueue(userId: string, workspaceId: string, postId: string) {
      await access.requirePermission(userId, workspaceId, "post.update");
      const post = await loadBoundPost(workspaceId, postId);
      const { job, dispatch: shouldDispatch } = await createOrReuseJob(post, userId);
      if (shouldDispatch) {
        await dispatch(job.id);
      }
      return db.publishJob.findUniqueOrThrow({ where: { id: job.id }, include: jobInclude });
    },

    async enqueueDueSchedules(at = now(), workspaceId?: string) {
      const due = await db.schedule.findMany({
        where: {
          workspaceId: workspaceId || undefined,
          startsAt: { lte: at },
          post: { status: "scheduled" },
        },
        include: { post: { include: postLoadInclude } },
      });

      const jobs = [];
      for (const row of due) {
        try {
          const { job, dispatch: shouldDispatch } = await createOrReuseJob(row.post, null);
          if (shouldDispatch) {
            await dispatch(job.id);
          }
          jobs.push(job);
        } catch (error) {
          if (error instanceof AccessError) {
            continue;
          }
          throw error;
        }
      }
      return jobs;
    },

    async claim(jobId: string, workerId: string, at = now()) {
      const claimed = await db.publishJob.updateMany({
        where: {
          id: jobId,
          status: "pending",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: at } }],
        },
        data: {
          status: "claimed",
          claimedAt: at,
          claimedBy: workerId,
          attemptCount: { increment: 1 },
        },
      });
      if (claimed.count !== 1) {
        return null;
      }
      return db.publishJob.findUnique({ where: { id: jobId }, include: jobInclude });
    },

    async processJob(jobId: string, workerId: string, at = now()) {
      const claimed = await this.claim(jobId, workerId, at);
      if (!claimed) {
        return {
          skipped: true as const,
          job: await db.publishJob.findUnique({ where: { id: jobId }, include: jobInclude }),
        };
      }

      await db.publishJob.update({
        where: { id: jobId },
        data: { status: "processing" },
      });
      await db.post.update({
        where: { id: claimed.postId },
        data: { status: "publishing" },
      });

      const version =
        claimed.post.versions.find((item) => item.id === claimed.postVersionId) ?? currentVersion(claimed.post);
      if (!version) {
        await db.publishJob.update({
          where: { id: jobId },
          data: { status: "failed", lastError: "Нет версии публикации для отправки." },
        });
        await db.post.update({
          where: { id: claimed.postId },
          data: { status: "failed" },
        });
        return {
          skipped: false as const,
          job: await db.publishJob.findUnique({ where: { id: jobId }, include: jobInclude }),
        };
      }

      const attemptNumber = claimed.attemptCount;
      const eligible = claimed.post.targets.filter((target) => {
        if (target.status === "published" || target.status === "cancelled" || target.status === "requires_manual_check") {
          return false;
        }
        if (target.status === "queued" || target.status === "publishing") {
          return true;
        }
        if (target.status === "failed") {
          return attemptNumber <= 1 || lastAttempt(claimed.attempts, target.id)?.kind === "temporary_failure";
        }
        return false;
      });

      for (const target of eligible) {
        await db.postTarget.update({
          where: { id: target.id },
          data: { status: "publishing" },
        });

        const startedAt = now();
        let outcome: PublishOutcome;
        try {
          outcome = await adapters.get(target.platform).publish({
            platform: target.platform,
            workspaceId: claimed.workspaceId,
            postId: claimed.postId,
            targetId: target.id,
            versionId: version.id,
            title: version.title,
            body: version.body,
            mediaKeys: claimed.post.media.map((item) => item.media.storageKey),
          });
        } catch {
          outcome = {
            kind: "unknown",
            code: "adapter_exception",
            message: "Адаптер завершился с неопределённым результатом. Повторная отправка заблокирована до ручной проверки.",
          };
        }
        const finishedAt = now();

        await db.publishAttempt.create({
          data: {
            jobId,
            targetId: target.id,
            platform: target.platform,
            kind: outcome.kind,
            attemptNumber,
            errorCode: outcome.kind === "success" ? null : outcome.code,
            errorMessage: outcome.kind === "success" ? null : outcome.message,
            externalId: outcome.kind === "success" ? outcome.externalId : null,
            startedAt,
            finishedAt,
          },
        });

        await db.postTarget.update({
          where: { id: target.id },
          data: {
            status: statusFromKind(outcome.kind),
            externalId: outcome.kind === "success" ? (outcome.externalId ?? target.externalId) : target.externalId,
            lastError: outcome.kind === "success" ? null : `${outcome.code}: ${outcome.message}`,
          },
        });

        await db.auditLog.create({
          data: {
            action: "PUBLISH_ATTEMPT",
            entityType: "post_target",
            entityId: target.id,
            actorId: claimed.createdById,
            details: `${target.platform}:${outcome.kind}:${attemptNumber}`,
          },
        });
      }

      const post = await db.post.findUniqueOrThrow({
        where: { id: claimed.postId },
        include: { targets: true },
      });
      const attempts = await db.publishAttempt.findMany({
        where: { jobId },
        orderBy: { attemptNumber: "desc" },
      });

      const temporaryIds = post.targets
        .filter((target) => target.status === "failed" && lastAttempt(attempts, target.id)?.kind === "temporary_failure")
        .map((target) => target.id);
      const hasUnknown = post.targets.some((target) => target.status === "requires_manual_check");
      const postStatus = aggregatePostStatus(post.targets);

      let jobStatus: PublishJobStatus;
      let nextAttemptAt: Date | null = null;
      let lastError: string | null = null;

      if (postStatus === "published") {
        jobStatus = "completed";
      } else if (temporaryIds.length > 0 && claimed.attemptCount < claimed.maxAttempts) {
        jobStatus = "pending";
        nextAttemptAt = new Date(at.getTime() + nextBackoffMs(claimed.attemptCount, backoff));
        lastError = "Есть временные ошибки, будет повтор без повторной отправки успешных целей.";
        await db.postTarget.updateMany({
          where: { id: { in: temporaryIds } },
          data: { status: "queued" },
        });
        await db.post.update({
          where: { id: post.id },
          data: { status: "queued" },
        });
        try {
          await queue.addPublishJob(jobId, nextBackoffMs(claimed.attemptCount, backoff));
        } catch (error) {
          lastError =
            error instanceof AccessError
              ? `${lastError} ${error.message}`
              : `${lastError} Диспетчер очереди недоступен.`;
        }
      } else if (hasUnknown) {
        jobStatus = "requires_manual_check";
        lastError = "Неопределённый результат публикации. Повторная отправка заблокирована.";
        await db.post.update({ where: { id: post.id }, data: { status: postStatus } });
      } else {
        jobStatus = "failed";
        lastError = post.targets
          .filter((target) => target.lastError)
          .map((target) => `${target.platform}: ${target.lastError}`)
          .join("; ");
        await db.post.update({ where: { id: post.id }, data: { status: postStatus } });
      }

      if (jobStatus === "completed") {
        await db.post.update({ where: { id: post.id }, data: { status: "published" } });
      }

      await db.publishJob.update({
        where: { id: jobId },
        data: { status: jobStatus, nextAttemptAt, lastError },
      });

      return {
        skipped: false as const,
        job: await db.publishJob.findUnique({ where: { id: jobId }, include: jobInclude }),
      };
    },

    async processDueJobs(workerId: string, at = now(), workspaceId?: string) {
      const due = await db.publishJob.findMany({
        where: {
          workspaceId: workspaceId || undefined,
          status: "pending",
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: at } }],
        },
        orderBy: { createdAt: "asc" },
        take: 20,
      });
      const results = [];
      for (const job of due) {
        results.push(await this.processJob(job.id, workerId, at));
      }
      return results;
    },

    async runWorkspaceQueue(userId: string, workspaceId: string, workerId: string) {
      await access.requirePermission(userId, workspaceId, "post.update");
      const due = await this.enqueueDueSchedules(now(), workspaceId);
      const processed = await this.processDueJobs(workerId, now(), workspaceId);
      return { due, processed };
    },
  };
}

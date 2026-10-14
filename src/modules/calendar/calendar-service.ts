import type { PostStatus, PrismaClient } from "@prisma/client";
import { DateTime } from "luxon";

import { AccessError, assertWorkspaceBound } from "@/modules/access/permissions";
import { createAccessService } from "@/modules/access/access-service";
import { localDateTimeToUtc, parseTimezone, utcToDisplay, utcToLocalInput } from "@/modules/calendar/timezone";
import { parsePlatforms } from "@/modules/posts/platforms";
import { createPostService } from "@/modules/posts/post-service";

const postStatuses = [
  "draft",
  "pending_approval",
  "approved",
  "scheduled",
  "queued",
  "publishing",
  "published",
  "failed",
  "cancelled",
] as const satisfies readonly PostStatus[];

const blockedScheduleStatuses: PostStatus[] = ["queued", "publishing", "published", "cancelled"];

function parseStatus(value: string | undefined): PostStatus | undefined {
  if (!value) {
    return undefined;
  }
  if ((postStatuses as readonly string[]).includes(value)) {
    return value as PostStatus;
  }
  throw new AccessError(400, "Неизвестный статус публикации.");
}

export function createCalendarService(db: PrismaClient) {
  const access = createAccessService(db);
  const posts = createPostService(db);

  async function loadBoundPost(workspaceId: string, postId: string) {
    const post = await db.post.findUnique({
      where: { id: postId },
      include: { schedule: true, targets: true },
    });
    assertWorkspaceBound(workspaceId, post, "Публикация");
    return post;
  }

  return {
    async list(
      userId: string,
      workspaceId: string,
      input: {
        from: Date;
        to: Date;
        projectId?: string;
        platform?: string;
        status?: string;
        query?: string;
        timezone: string;
      },
    ) {
      await access.requirePermission(userId, workspaceId, "post.view");
      const viewTimezone = parseTimezone(input.timezone);
      const platform = input.platform ? parsePlatforms([input.platform])[0] : undefined;
      const status = parseStatus(input.status);
      const query = input.query?.trim();

      const rows = await db.schedule.findMany({
        where: {
          workspaceId,
          startsAt: { gte: input.from, lt: input.to },
          post: {
            workspaceId,
            projectId: input.projectId || undefined,
            status: status || undefined,
            targets: platform ? { some: { platform } } : undefined,
            versions: query
              ? {
                  some: {
                    supersededAt: null,
                    OR: [
                      { title: { contains: query, mode: "insensitive" } },
                      { body: { contains: query, mode: "insensitive" } },
                    ],
                  },
                }
              : undefined,
          },
        },
        include: {
          post: {
            include: {
              project: true,
              targets: true,
              versions: { where: { supersededAt: null }, take: 1, orderBy: { number: "desc" } },
            },
          },
        },
        orderBy: { startsAt: "asc" },
      });

      return rows.map((row) => ({
        id: row.id,
        postId: row.postId,
        workspaceId: row.workspaceId,
        startsAt: row.startsAt,
        timezone: row.timezone,
        localInput: utcToLocalInput(row.startsAt, row.timezone),
        viewDay: utcToLocalInput(row.startsAt, viewTimezone).slice(0, 10),
        displayTime: utcToDisplay(row.startsAt, viewTimezone),
        status: row.post.status,
        title: row.post.versions[0]?.title ?? "Без названия",
        projectId: row.post.projectId,
        projectName: row.post.project.name,
        projectColor: row.post.project.color,
        platforms: row.post.targets.map((target) => target.platform),
      }));
    },

    async schedule(
      userId: string,
      workspaceId: string,
      postId: string,
      input: { localDateTime: string; timezone: string },
    ) {
      await access.requirePermission(userId, workspaceId, "post.update");
      const post = await loadBoundPost(workspaceId, postId);
      if (blockedScheduleStatuses.includes(post.status)) {
        throw new AccessError(403, "Нельзя менять расписание публикации в текущем статусе.");
      }

      const timezone = parseTimezone(input.timezone);
      const startsAt = localDateTimeToUtc(input.localDateTime, timezone);

      const schedule = await db.$transaction(async (tx) => {
        const saved = await tx.schedule.upsert({
          where: { postId: post.id },
          create: { postId: post.id, workspaceId, startsAt, timezone },
          update: { startsAt, timezone },
        });
        await tx.post.update({
          where: { id: post.id },
          data: { status: "scheduled" },
        });
        await tx.postTarget.updateMany({
          where: { postId: post.id, status: { in: ["draft", "pending_approval", "approved", "scheduled", "failed"] } },
          data: { status: "scheduled" },
        });
        await tx.auditLog.create({
          data: {
            action: "SCHEDULE_POST",
            entityType: "post",
            entityId: post.id,
            actorId: userId,
            details: startsAt.toISOString(),
          },
        });
        return saved;
      });

      return schedule;
    },

    async createOnDate(
      userId: string,
      workspaceId: string,
      projectId: string,
      input: { date: string; timezone: string; title?: string },
    ) {
      await access.requirePermission(userId, workspaceId, "post.create");
      const timezone = parseTimezone(input.timezone);
      const day = DateTime.fromISO(input.date, { zone: timezone });
      if (!day.isValid) {
        throw new AccessError(400, "Некорректная дата календаря.");
      }

      const post = await posts.create(userId, workspaceId, projectId, input.title);
      const localDateTime = `${day.toISODate()}T12:00`;
      await this.schedule(userId, workspaceId, post.id, { localDateTime, timezone });
      return post;
    },
  };
}

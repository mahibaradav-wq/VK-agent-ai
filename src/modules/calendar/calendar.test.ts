import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAuthService } from "@/modules/auth/auth-service";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";

const auth = createAuthService(prisma, "http://localhost:3000");
const posts = createPostService(prisma);
const projects = createProjectService(prisma);
const calendar = createCalendarService(prisma);
const workspaces = createWorkspaceService(prisma);

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

async function expectAccess(promise: Promise<unknown>, status: 400 | 403 | 404, message: RegExp) {
  const error = await promise.then(
    () => {
      throw new Error("expected AccessError");
    },
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AccessError);
  expect(error).toMatchObject({ status, message: expect.stringMatching(message) });
}

async function registerOwner(label: string) {
  const address = email(label);
  const result = await auth.register(address, "password123");
  expect(result.ok).toBe(true);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: address },
    include: { memberships: true },
  });
  const workspaceId = user.memberships[0]?.workspaceId ?? "";
  const project = await projects.create(user.id, workspaceId, { name: `Проект ${label}` });
  return { address, userId: user.id, workspaceId, projectId: project.id };
}

describe("content calendar", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates on a date, reschedules in UTC, and filters by status and search", async () => {
    const owner = await registerOwner("cal-main");
    const created = await calendar.createOnDate(owner.userId, owner.workspaceId, owner.projectId, {
      date: "2026-10-14",
      timezone: "Europe/Moscow",
      title: "Борщ в полдень",
    });
    const scheduled = await prisma.schedule.findUniqueOrThrow({ where: { postId: created.id } });
    expect(scheduled.startsAt.toISOString()).toBe("2026-10-14T09:00:00.000Z");
    expect((await prisma.post.findUniqueOrThrow({ where: { id: created.id } })).status).toBe("scheduled");

    await posts.saveDraft(owner.userId, owner.workspaceId, created.id, {
      title: "Борщ в полдень",
      body: "Рецепт на неделю",
      platforms: ["vk"],
      mediaIds: [],
    });

    await calendar.schedule(owner.userId, owner.workspaceId, created.id, {
      localDateTime: "2026-10-15T18:30",
      timezone: "Europe/Moscow",
    });
    const moved = await prisma.schedule.findUniqueOrThrow({ where: { postId: created.id } });
    expect(moved.startsAt.toISOString()).toBe("2026-10-15T15:30:00.000Z");

    const from = new Date("2026-10-12T00:00:00.000Z");
    const to = new Date("2026-10-20T00:00:00.000Z");
    const listed = await calendar.list(owner.userId, owner.workspaceId, {
      from,
      to,
      timezone: "Europe/Moscow",
      status: "scheduled",
      query: "борщ",
      platform: "vk",
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.viewDay).toBe("2026-10-15");
    expect(listed[0]?.title).toContain("Борщ");

    const empty = await calendar.list(owner.userId, owner.workspaceId, {
      from,
      to,
      timezone: "Europe/Moscow",
      status: "draft",
    });
    expect(empty).toHaveLength(0);
  });

  it("blocks a Viewer from rescheduling and rejects a spoofed postId", async () => {
    const owner = await registerOwner("cal-acl");
    const other = await registerOwner("cal-other");
    const viewer = await registerOwner("cal-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const post = await calendar.createOnDate(owner.userId, owner.workspaceId, owner.projectId, {
      date: "2026-10-20",
      timezone: "Europe/Moscow",
      title: "Только владелец",
    });

    await expectAccess(
      calendar.schedule(viewer.userId, owner.workspaceId, post.id, {
        localDateTime: "2026-10-21T12:00",
        timezone: "Europe/Moscow",
      }),
      403,
      /Недостаточно прав/,
    );
    await expectAccess(
      calendar.schedule(other.userId, other.workspaceId, post.id, {
        localDateTime: "2026-10-21T12:00",
        timezone: "Europe/Moscow",
      }),
      403,
      /другому рабочему пространству/,
    );
    await expectAccess(
      calendar.list(other.userId, owner.workspaceId, {
        from: new Date("2026-10-01T00:00:00.000Z"),
        to: new Date("2026-11-01T00:00:00.000Z"),
        timezone: "Europe/Moscow",
      }),
      404,
      /не найдено/,
    );
  });
});

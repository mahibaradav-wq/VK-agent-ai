import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AccessError } from "@/modules/access/permissions";
import { createAnalyticsService } from "@/modules/analytics/analytics-service";
import { DEMO_NOTE } from "@/modules/analytics/metrics";
import { createAuthService } from "@/modules/auth/auth-service";
import { createProjectService } from "@/modules/projects/project-service";
import { createSocialService } from "@/modules/social/social-service";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";
import type { TelegramApiResult, TelegramTransport } from "@/server/social/telegram-api";

const auth = createAuthService(prisma, "http://localhost:3000");
const projects = createProjectService(prisma);
const workspaces = createWorkspaceService(prisma);
const BOT_TOKEN = "123456789:AAExampleTokenForTestsAbcdefghijkl";

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

function scriptedTelegram(
  script: Record<string, TelegramApiResult<unknown>> | ((method: string) => TelegramApiResult<unknown>),
): TelegramTransport & { calls: Array<{ method: string; token: string }> } {
  const calls: Array<{ method: string; token: string }> = [];
  return {
    calls,
    async request(token, method) {
      calls.push({ method, token });
      return typeof script === "function"
        ? script(method)
        : (script[method] ?? { ok: false, error_code: 400, description: "unexpected method" });
    },
  };
}

describe("analytics dashboard and collection", () => {
  const previousKey = process.env.TOKEN_ENCRYPTION_KEY;

  beforeAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = "stage10-analytics-tests";
    await prisma.$connect();
  });

  afterAll(async () => {
    process.env.TOKEN_ENCRYPTION_KEY = previousKey;
    await prisma.$disconnect();
  });

  it("shows labeled demo data when there are no real snapshots", async () => {
    const owner = await registerOwner("an-demo");
    const analytics = createAnalyticsService(prisma, { now: () => new Date("2026-10-15T12:00:00.000Z") });
    const dashboard = await analytics.dashboard(owner.userId, owner.workspaceId);
    expect(dashboard.mode).toBe("demo");
    expect(dashboard.demoUsed).toBe(true);
    expect(dashboard.note).toBe(DEMO_NOTE);
    expect(dashboard.series.length).toBeGreaterThan(0);
    expect(dashboard.snapshots.every((item) => item.source === "demo")).toBe(true);
    expect(JSON.stringify(dashboard.snapshots[0]?.rawPayload)).toContain("не метрики платформы");
  });

  it("collects Telegram followers, stores raw payload, and leaves impressions null", async () => {
    const owner = await registerOwner("an-tg");
    const transport = scriptedTelegram({
      getMe: { ok: true, result: { id: 1, is_bot: true, username: "metrics_bot" } },
      getChat: { ok: true, result: { id: -10055, title: "Кухня" } },
      getChatMemberCount: { ok: true, result: 321 },
    });
    const social = createSocialService(prisma, { telegram: transport });
    const account = await social.connectTelegram(owner.userId, owner.workspaceId, {
      token: BOT_TOKEN,
      chatId: "-10055",
      projectId: owner.projectId,
    });
    const analytics = createAnalyticsService(prisma, {
      telegram: transport,
      now: () => new Date("2026-10-15T15:00:00.000Z"),
    });
    const collected = await analytics.collect(owner.userId, owner.workspaceId);
    expect(collected.collected).toHaveLength(1);
    expect(collected.collected[0]?.followers).toBe(321);
    expect(collected.collected[0]?.impressions).toBeNull();
    expect(collected.collected[0]?.reach).toBeNull();
    expect(collected.collected[0]?.engagement).toBeNull();
    expect(collected.collected[0]?.postsPublished).toBe(0);
    expect(collected.collected[0]?.source).toBe("telegram");
    expect(JSON.stringify(collected.collected[0]?.rawPayload)).toContain("getChatMemberCount");
    expect(JSON.stringify(collected.collected[0])).not.toContain(BOT_TOKEN);
    expect(transport.calls.some((item) => item.method === "getChatMemberCount")).toBe(true);

    const dashboard = await analytics.dashboard(owner.userId, owner.workspaceId, {
      from: "2026-10-15",
      to: "2026-10-15",
    });
    expect(dashboard.mode).toBe("real");
    expect(dashboard.demoUsed).toBe(false);
    expect(dashboard.totals.followers.value).toBe(321);
    expect(dashboard.totals.impressions.value).toBeNull();
    expect(dashboard.totals.impressions.availability).toBe("unavailable");
    expect(dashboard.snapshots[0]?.collectedAt.toISOString()).toBe("2026-10-15T15:00:00.000Z");
    expect(dashboard.availability.find((item) => item.key === "impressions")?.availability).toBe("unavailable");

    await prisma.analyticsSnapshot.create({
      data: {
        workspaceId: owner.workspaceId,
        projectId: owner.projectId,
        socialAccountId: account.id,
        platform: "demo",
        source: "demo",
        collectedAt: new Date("2026-10-15T16:00:00.000Z"),
        periodStart: new Date("2026-10-15T00:00:00.000Z"),
        periodEnd: new Date("2026-10-15T23:59:59.999Z"),
        impressions: 9000,
        reach: 8000,
        followers: 99999,
        engagement: 400,
        postsPublished: 40,
        rawPayload: { demo: true },
      },
    });
    const mixed = await analytics.dashboard(owner.userId, owner.workspaceId, {
      from: "2026-10-15",
      to: "2026-10-15",
    });
    expect(mixed.mode).toBe("real");
    expect(mixed.demoExcluded).toBe(1);
    expect(mixed.totals.followers.value).toBe(321);
    expect(mixed.totals.impressions.value).toBeNull();
  });

  it("does not write a snapshot when Telegram rejects member count", async () => {
    const owner = await registerOwner("an-fail");
    const connectTransport = scriptedTelegram({
      getMe: { ok: true, result: { id: 2, is_bot: true, username: "x" } },
      getChat: { ok: true, result: { id: 9 } },
    });
    const social = createSocialService(prisma, { telegram: connectTransport });
    await social.connectTelegram(owner.userId, owner.workspaceId, { token: BOT_TOKEN, chatId: "9" });
    const analytics = createAnalyticsService(prisma, {
      telegram: scriptedTelegram({
        getChatMemberCount: { ok: false, error_code: 401, description: "Unauthorized" },
      }),
    });
    const result = await analytics.collect(owner.userId, owner.workspaceId);
    expect(result.collected).toHaveLength(0);
    expect(result.skipped[0]?.reason).toMatch(/Unauthorized/);
    expect(await prisma.analyticsSnapshot.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });

  it("skips VK without writing fake reach and blocks Viewer collect plus spoofed ids", async () => {
    const owner = await registerOwner("an-acl");
    const other = await registerOwner("an-other");
    const viewer = await registerOwner("an-viewer");
    await workspaces.addMember(owner.userId, owner.workspaceId, viewer.address, "Viewer");
    const social = createSocialService(prisma);
    const vk = await social.createRequiresSetup(owner.userId, owner.workspaceId, { platform: "vk" });
    const analytics = createAnalyticsService(prisma);

    const collected = await analytics.collect(owner.userId, owner.workspaceId, { socialAccountId: vk.id });
    expect(collected.collected).toHaveLength(0);
    expect(collected.skipped[0]?.reason).toMatch(/не собираются официальным API/);
    expect(await prisma.analyticsSnapshot.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);

    await expectAccess(analytics.collect(viewer.userId, owner.workspaceId), 403, /Недостаточно прав/);
    const viewerDash = await analytics.dashboard(viewer.userId, owner.workspaceId);
    expect(viewerDash.mode).toBe("demo");
    await expectAccess(analytics.dashboard(other.userId, owner.workspaceId), 404, /не найдено/);
    await expectAccess(
      analytics.dashboard(owner.userId, owner.workspaceId, { projectId: other.projectId }),
      403,
      /другому рабочему пространству/,
    );
  });
});

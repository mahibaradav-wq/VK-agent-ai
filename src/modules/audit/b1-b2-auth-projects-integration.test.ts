import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";

import { createAuthService } from "@/modules/auth/auth-service";
import { createAiService } from "@/modules/ai/ai-service";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import { createPostService } from "@/modules/posts/post-service";
import { PERSONAL_ACTIVE_PROJECT_LIMIT } from "@/modules/cabinet/limits";
import { createProjectService } from "@/modules/projects/project-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { createSocialService } from "@/modules/social/social-service";
import { AccessError } from "@/modules/access/permissions";
import { prisma } from "@/server/db/prisma";
import { createInlineQueue } from "@/server/queue";

const TEST_SECRET = "pr73-b1-b2-test-secret-not-for-production";
const COOKIE_NAME = "authjs.session-token";

const cookieJar = vi.hoisted(() => ({ value: "" }));

vi.mock("next/headers", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("next/headers");
  return {
    ...actual,
    headers: async () =>
      new Headers({
        cookie: cookieJar.value,
        host: "127.0.0.1:3000",
        "x-forwarded-proto": "http",
        "x-real-ip": "127.0.0.1",
      }),
    cookies: async () => ({
      get: (name: string) => {
        const part = cookieJar.value
          .split(";")
          .map((chunk) => chunk.trim())
          .find((chunk) => chunk.startsWith(`${name}=`));
        return part ? { name, value: part.slice(name.length + 1) } : undefined;
      },
      set: vi.fn(),
      delete: vi.fn(),
      getAll: () => [],
      has: () => false,
    }),
  };
});

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const authService = createAuthService(prisma, "http://127.0.0.1:3000");
const projects = createProjectService(prisma);
const posts = createPostService(prisma);
const calendar = createCalendarService(prisma);
const social = createSocialService(prisma);

function email(label: string) {
  return `pr73.${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

async function createOwner(label: string, password = "password123") {
  const address = email(label);
  const reg = await authService.register(address, password);
  expect(reg.ok).toBe(true);
  const mail = await prisma.devMailMessage.findFirstOrThrow({
    where: { to: address, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  const token = new URL(mail.url!, "http://127.0.0.1:3000").searchParams.get("token")!;
  expect((await authService.verifyEmail(token)).ok).toBe(true);
  const user = await prisma.user.findUniqueOrThrow({
    where: { email: address },
    include: { memberships: true },
  });
  const workspaceId = user.memberships[0]!.workspaceId;
  const starter = await prisma.project.findFirstOrThrow({ where: { workspaceId } });
  return { address, password, userId: user.id, workspaceId, starterProjectId: starter.id, sessionVersion: user.sessionVersion };
}

async function mintCookie(user: { userId: string; address: string; sessionVersion: number }) {
  const jwt = await encode({
    token: {
      sub: user.userId,
      email: user.address,
      sessionVersion: user.sessionVersion,
    },
    secret: TEST_SECRET,
    salt: COOKIE_NAME,
    maxAge: 3600,
  });
  return `${COOKIE_NAME}=${jwt}`;
}

describe("PR73 Block B1/B2: Auth, isolation, server actions/APIs & projects lifecycle", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET = TEST_SECRET;
    process.env.AUTH_URL = "http://127.0.0.1:3000";
    await prisma.$connect();
  });

  beforeEach(() => {
    cookieJar.value = "";
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("B1: enforces auth, workspace/project isolation across Server Actions and API routes", async () => {
    const ownerA = await createOwner("b1-a");
    const ownerB = await createOwner("b1-b");

    // 0) Password reset invalidates old cookie across Server Actions, and deleted user fails closed
    const oldCookieA = await mintCookie(ownerA);
    cookieJar.value = oldCookieA;
    const { createProject: createProjTest } = await import("@/modules/projects/actions");
    const okForm = new FormData();
    okForm.set("workspaceId", ownerA.workspaceId);
    okForm.set("name", "До сброса");
    await expect(createProjTest({ status: "idle", message: "" }, okForm)).resolves.toMatchObject({ status: "success" });

    await authService.requestPasswordReset(ownerA.address);
    const resetMail = await prisma.devMailMessage.findFirstOrThrow({
      where: { to: ownerA.address, kind: "reset_password" },
      orderBy: { createdAt: "desc" },
    });
    const resetToken = new URL(resetMail.url!, "http://127.0.0.1:3000").searchParams.get("token")!;
    await authService.resetPassword(resetToken, "newpassword123");

    // Old cookie now rejected on Server Action!
    await expect(createProjTest({ status: "idle", message: "" }, okForm)).resolves.toMatchObject({
      status: "invalid",
      message: /авторизация/i,
    });

    // Deleted user rejected on Node auth()
    const ownerDel = await createOwner("b1-del");
    cookieJar.value = await mintCookie(ownerDel);
    await prisma.user.delete({ where: { id: ownerDel.userId } });
    const { auth: nodeAuth } = await import("@/auth");
    expect((await nodeAuth())?.user?.id).toBeUndefined();
    cookieJar.value = "";
    // logoutUser delegates to signOut({ redirectTo: "/login" })
    const { logoutUser } = await import("@/modules/auth/actions");
    await expect(logoutUser()).rejects.toThrow();

    // 1) Unauthenticated calls to API routes return 401
    const apiRoutes = [
      () =>
        import("@/app/api/ai/connect/route").then(({ POST }) =>
          POST(new Request("http://127.0.0.1:3000/api/ai/connect", { method: "POST", body: new FormData() })),
        ),
      () =>
        import("@/app/api/ai/disconnect/route").then(({ POST }) =>
          POST(new Request("http://127.0.0.1:3000/api/ai/disconnect", { method: "POST", body: new FormData() })),
        ),
      () =>
        import("@/app/api/watch/ideas/route").then(({ POST }) =>
          POST(new Request("http://127.0.0.1:3000/api/watch/ideas", { method: "POST", body: new FormData() })),
        ),
      () =>
        import("@/app/api/watch/apply-idea/route").then(({ POST }) =>
          POST(new Request("http://127.0.0.1:3000/api/watch/apply-idea", { method: "POST", body: new FormData() })),
        ),
    ];
    for (const invoke of apiRoutes) {
      const response = await invoke();
      expect(response.status).toBe(401);
    }

    // 2) Unauthenticated Server Actions fail closed
    const { createProject, archiveProject, restoreProject } = await import("@/modules/projects/actions");
    const { selectWorkspace, selectProject, addWorkspaceMember } = await import("@/modules/workspaces/actions");
    const { generateAi } = await import("@/modules/ai/actions");
    const { publishNowPost, enqueuePost } = await import("@/modules/publishing/actions");
    const { grantPlatformAdmin } = await import("@/modules/admin/actions");

    const createForm = new FormData();
    createForm.set("workspaceId", ownerA.workspaceId);
    createForm.set("name", "Unauth");
    await expect(createProject({ status: "idle", message: "" }, createForm)).resolves.toMatchObject({
      status: "invalid",
      message: /авторизация/i,
    });
    await expect(archiveProject(createForm)).rejects.toMatchObject({ status: 403 });
    await expect(restoreProject(createForm)).rejects.toMatchObject({ status: 403 });
    await expect(selectWorkspace(createForm)).rejects.toMatchObject({ status: 403 });

    const genForm = new FormData();
    genForm.set("workspaceId", ownerA.workspaceId);
    genForm.set("kind", "ideas");
    genForm.set("prompt", "полки");
    await expect(generateAi({ status: "idle", message: "" }, genForm)).resolves.toMatchObject({
      status: "invalid",
      message: /авторизация/i,
    });

    const pubForm = new FormData();
    pubForm.set("workspaceId", ownerA.workspaceId);
    pubForm.set("postId", "missing");
    await expect(publishNowPost({ status: "idle", message: "" }, pubForm)).resolves.toMatchObject({
      status: "invalid",
      message: /авторизация/i,
    });
    await expect(enqueuePost({ status: "idle", message: "" }, pubForm)).resolves.toMatchObject({
      status: "invalid",
      message: /авторизация/i,
    });

    // 3) Authenticated Owner B cannot touch Owner A's workspace, project, or admin actions
    cookieJar.value = await mintCookie(ownerB);

    const foreignWs = new FormData();
    foreignWs.set("workspaceId", ownerA.workspaceId);
    foreignWs.set("projectId", ownerA.starterProjectId);
    await expect(selectWorkspace(foreignWs)).rejects.toMatchObject({ status: 403 });
    await expect(selectProject(foreignWs)).rejects.toMatchObject({ status: 404 });
    await expect(archiveProject(foreignWs)).rejects.toMatchObject({ status: 404 });

    const foreignMember = new FormData();
    foreignMember.set("workspaceId", ownerA.workspaceId);
    foreignMember.set("email", ownerB.address);
    foreignMember.set("role", "Admin");
    await expect(addWorkspaceMember({ status: "idle", message: "" }, foreignMember)).resolves.toMatchObject({
      status: "invalid",
      message: /не найдено/i,
    });

    const adminForm = new FormData();
    adminForm.set("email", ownerB.address);
    adminForm.set("role", "Support");
    await expect(grantPlatformAdmin({ status: "idle", message: "" }, adminForm)).resolves.toMatchObject({
      status: "invalid",
      message: /админки/i,
    });

    const foreignConnect = new FormData();
    foreignConnect.set("workspaceId", ownerA.workspaceId);
    foreignConnect.set("provider", "openai");
    foreignConnect.set("apiKey", "sk-1234567890abcdef");
    const { POST: connectPost } = await import("@/app/api/ai/connect/route");
    const connectResp = await connectPost(
      new Request("http://127.0.0.1:3000/api/ai/connect", { method: "POST", body: foreignConnect }),
    );
    expect(connectResp.status).toBe(404);
  });

  it("B1: health and session-check fail cleanly when DB is unavailable", async () => {
    const owner = await createOwner("b1-dbdown");
    const cookie = await mintCookie(owner);

    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(new Error("DB connection refused"));
    const { GET: getHealth } = await import("@/app/api/health/route");
    const healthResp = await getHealth();
    expect(healthResp.status).toBe(503);
    expect(await healthResp.json()).toEqual({ ok: false, db: "down" });

    vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(new Error("DB connection refused"));
    const { GET: sessionCheck } = await import("@/app/api/auth/session-check/route");
    const checkResp = await sessionCheck(
      new Request("http://127.0.0.1:3000/api/auth/session-check", { headers: { cookie } }),
    );
    expect(checkResp.status).toBe(503);
    expect(await checkResp.json()).toEqual({ valid: false });
  });

  it("B2: enforces 10-project limit on concurrent create/restore and blocks all operations on archived projects", async () => {
    const owner = await createOwner("b2-proj");
    const stranger = await createOwner("b2-stranger");

    // Starter project already occupies 1 of 10 slots; create 8 more -> 9 active
    const createdIds: string[] = [];
    for (let i = 2; i <= PERSONAL_ACTIVE_PROJECT_LIMIT - 1; i += 1) {
      const p = await projects.create(owner.userId, owner.workspaceId, { name: `Проект ${i}` });
      createdIds.push(p.id);
    }

    // Concurrent creation near limit (9 active, 3 parallel attempts -> only 1 succeeds)
    const concurrentCreate = await Promise.allSettled([
      projects.create(owner.userId, owner.workspaceId, { name: "Гонка 1" }),
      projects.create(owner.userId, owner.workspaceId, { name: "Гонка 2" }),
      projects.create(owner.userId, owner.workspaceId, { name: "Гонка 3" }),
    ]);
    expect(concurrentCreate.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(concurrentCreate.filter((r) => r.status === "rejected")).toHaveLength(2);

    // Archive 2 active projects -> 8 active
    const pA = createdIds[0]!;
    const pB = createdIds[1]!;
    await projects.archive(owner.userId, owner.workspaceId, pA);
    await projects.archive(owner.userId, owner.workspaceId, pB);

    // Verify archived project is excluded from active limit (create 1 -> 9 active)
    await projects.create(owner.userId, owner.workspaceId, { name: "После архива" });

    // Parallel restore when 9 active: 2 archived restored concurrently -> only 1 succeeds
    const concurrentRestore = await Promise.allSettled([
      projects.restore(owner.userId, owner.workspaceId, pA),
      projects.restore(owner.userId, owner.workspaceId, pB),
    ]);
    expect(concurrentRestore.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(concurrentRestore.filter((r) => r.status === "rejected")).toHaveLength(1);

    const archivedId = concurrentRestore[0]!.status === "rejected" ? pA : pB;

    // Cross-workspace isolation on projects
    await expect(projects.get(stranger.userId, stranger.workspaceId, owner.starterProjectId)).rejects.toMatchObject({
      status: 403,
    });
    await expect(projects.archive(stranger.userId, owner.workspaceId, owner.starterProjectId)).rejects.toMatchObject({
      status: 404,
    });

    // Prepare a post in an active project, then archive that project to verify operations are blocked
    const activeForArchive = await projects.create(owner.userId, owner.workspaceId, { name: "Под архив" }).catch(
      async () => {
        // Limit is 10; archive one to free slot, create & prepare post, then archive it
        await projects.archive(owner.userId, owner.workspaceId, createdIds[2]!);
        return projects.create(owner.userId, owner.workspaceId, { name: "Под архив" });
      },
    );
    const post = await posts.create(owner.userId, owner.workspaceId, activeForArchive.id, "Пост до архивации");
    await posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
      title: "Пост до архивации",
      body: "Текст",
      platforms: ["telegram"],
      mediaIds: [],
    });
    await projects.archive(owner.userId, owner.workspaceId, activeForArchive.id);

    const ai = createAiService(prisma, {
      provider: {
        name: "stub",
        model: "m",
        imageModel: "i",
        ready: true,
        imageReady: true,
        generate: async () => {
          throw new Error("should not call");
        },
        generateImage: async () => {
          throw new Error("should not call");
        },
      },
    });
    const publishing = createPublishService(prisma, { queue: createInlineQueue() });

    await expect(projects.update(owner.userId, owner.workspaceId, activeForArchive.id, { name: "x" })).rejects.toMatchObject({
      status: 409,
    });
    await expect(posts.create(owner.userId, owner.workspaceId, activeForArchive.id, "Новый")).rejects.toMatchObject({
      status: 409,
    });
    await expect(
      posts.saveDraft(owner.userId, owner.workspaceId, post.id, {
        title: "Правка",
        body: "Текст",
        platforms: ["telegram"],
        mediaIds: [],
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      calendar.schedule(owner.userId, owner.workspaceId, post.id, {
        localDateTime: "2026-12-01T10:00",
        timezone: "Europe/Moscow",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(publishing.enqueue(owner.userId, owner.workspaceId, post.id)).rejects.toMatchObject({ status: 409 });
    await expect(publishing.publishNow(owner.userId, owner.workspaceId, post.id)).rejects.toMatchObject({ status: 409 });
    await expect(
      ai.generate(owner.userId, owner.workspaceId, { kind: "ideas", prompt: "полки", projectId: activeForArchive.id }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      ai.composeAgentPost(owner.userId, owner.workspaceId, {
        prompt: "полки",
        platform: "telegram",
        projectId: activeForArchive.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      ai.reviseStudioCard(owner.userId, owner.workspaceId, {
        postId: post.id,
        comment: "поправь",
        rewrite: "text",
      }),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      social.createRequiresSetup(owner.userId, owner.workspaceId, {
        platform: "telegram",
        projectId: archivedId,
      }),
    ).rejects.toBeInstanceOf(AccessError);
  });
});

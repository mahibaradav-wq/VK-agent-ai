import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { encode } from "next-auth/jwt";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createAuthService } from "@/modules/auth/auth-service";
import { createPostService } from "@/modules/posts/post-service";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";
import { createWorkerLoop } from "@/server/queue/worker";
import { createLocalStorage } from "@/server/storage/local-storage";

const TEST_SECRET = "pr73-regression-secret-not-for-production";
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
      }),
    cookies: async () => ({
      get: (name: string) => {
        const part = cookieJar.value
          .split(";")
          .map((chunk) => chunk.trim())
          .find((chunk) => chunk.startsWith(`${name}=`));
        return part ? { name, value: part.slice(name.length + 1) } : undefined;
      },
      getAll: () => [],
      has: () => false,
    }),
  };
});

const authService = createAuthService(prisma, "http://127.0.0.1:3000");
const projects = createProjectService(prisma);
const posts = createPostService(prisma);

async function createOwner(label: string) {
  const address = `pr73.reg.${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
  await authService.register(address, "password123");
  const mail = await prisma.devMailMessage.findFirstOrThrow({
    where: { to: address, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  const token = new URL(mail.url!, "http://127.0.0.1:3000").searchParams.get("token")!;
  await authService.verifyEmail(token);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
  const membership = await prisma.workspaceMember.findFirstOrThrow({ where: { userId: user.id } });
  const project = await projects.create(user.id, membership.workspaceId, { name: `Reg-${label}` });
  const jwt = await encode({
    token: { sub: user.id, email: address, sessionVersion: user.sessionVersion },
    secret: TEST_SECRET,
    salt: COOKIE_NAME,
    maxAge: 3600,
  });
  return {
    userId: user.id,
    workspaceId: membership.workspaceId,
    projectId: project.id,
    cookie: `${COOKIE_NAME}=${jwt}`,
  };
}

describe("PR73 Block E: Defect regression suite (D1–D4)", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET = TEST_SECRET;
    process.env.AUTH_URL = "http://127.0.0.1:3000";
    await prisma.$connect();
  });

  afterEach(() => {
    cookieJar.value = "";
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("D1: Node auth() fails closed and GET /api/media/[id] returns 503 when PostgreSQL is unavailable", async () => {
    const owner = await createOwner("d1");
    cookieJar.value = owner.cookie;

    // Simulate DB outage during Node auth()
    const findUserSpy = vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const { auth: nodeAuth } = await import("@/auth");
    const session = await nodeAuth();
    expect(session?.user?.id).toBeUndefined();
    expect(findUserSpy).toHaveBeenCalledTimes(1);

    // Restore user lookup so auth() succeeds, then simulate DB outage on mediaAsset lookup
    const findMediaSpy = vi
      .spyOn(prisma.mediaAsset, "findUnique")
      .mockRejectedValueOnce(new Error("DB connection lost"));
    const { GET: getMediaRoute } = await import("@/app/api/media/[id]/route");
    const resp = await getMediaRoute(new Request("http://127.0.0.1:3000/api/media/any-id"), {
      params: Promise.resolve({ id: "any-id" }),
    });
    expect(resp.status).toBe(503);
    expect(findMediaSpy).toHaveBeenCalledTimes(1);
  });

  it("D2: worker loop deduplicates overlapping ticks and awaits in-flight tick before shutdown closes resources", async () => {
    let tickCount = 0;
    let releaseTick!: () => void;
    const tickEntered = new Promise<void>((resolve) => {
      // resolved inside runTick
      void resolve;
    });
    let markEntered!: () => void;
    const entered = new Promise<void>((r) => {
      markEntered = r;
    });
    const events: string[] = [];

    const loop = createWorkerLoop({
      runTick: async () => {
        tickCount += 1;
        events.push(`tick:start:${tickCount}`);
        markEntered();
        await new Promise<void>((resolve) => {
          releaseTick = resolve;
        });
        events.push(`tick:end:${tickCount}`);
      },
      close: async () => {
        events.push("close");
      },
    });
    void tickEntered;

    const p1 = loop.triggerTick();
    await entered;
    // Overlapping tick must reuse the active promise instead of starting a second concurrent run
    const p2 = loop.triggerTick();
    expect(tickCount).toBe(1);

    // Shutdown starts while tick 1 is still in flight; close must wait until tick 1 finishes
    const shut = loop.shutdown();
    expect(loop.isStopping()).toBe(true);
    expect(events).toEqual(["tick:start:1"]);

    // Subsequent trigger during stopping must not start another tick
    const p3 = loop.triggerTick();
    expect(tickCount).toBe(1);

    releaseTick();
    await Promise.all([p1, p2, p3, shut]);
    expect(events).toEqual(["tick:start:1", "tick:end:1", "close"]);
  });

  it("D3: local storage rejects '.' key and refuses symlinks escaping rootDir on get and put", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "polka-d3-root-"));
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), "polka-d3-outside-"));
    try {
      const storage = createLocalStorage(rootDir);
      await expect(storage.put(".", Buffer.from("x"), "text/plain")).rejects.toMatchObject({ status: 400 });
      await expect(storage.put("./", Buffer.from("x"), "text/plain")).rejects.toMatchObject({ status: 400 });
      await expect(storage.get(".")).rejects.toMatchObject({ status: 400 });

      const secretFile = path.join(outsideDir, "secret.txt");
      await writeFile(secretFile, "ORIGINAL_SECRET", "utf8");

      const linkFile = path.join(rootDir, "evil-file-link");
      await symlink(secretFile, linkFile);
      await expect(storage.get("evil-file-link")).rejects.toMatchObject({ status: 400 });
      await expect(storage.put("evil-file-link", Buffer.from("OVERWRITTEN"), "text/plain")).rejects.toMatchObject({
        status: 400,
      });
      expect(await readFile(secretFile, "utf8")).toBe("ORIGINAL_SECRET");

      const linkDir = path.join(rootDir, "evil-dir-link");
      await symlink(outsideDir, linkDir);
      await expect(storage.put("evil-dir-link/nested.txt", Buffer.from("OVERWRITTEN"), "text/plain")).rejects.toMatchObject({
        status: 400,
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true }).catch(() => undefined);
      await rm(outsideDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  it("D4: concurrent first-month posts.create calls serialize cleanly without P2002 usageRecord race", async () => {
    const owner = await createOwner("d4");
    const created = await Promise.all([
      posts.create(owner.userId, owner.workspaceId, owner.projectId, "Параллельный 1"),
      posts.create(owner.userId, owner.workspaceId, owner.projectId, "Параллельный 2"),
      posts.create(owner.userId, owner.workspaceId, owner.projectId, "Параллельный 3"),
      posts.create(owner.userId, owner.workspaceId, owner.projectId, "Параллельный 4"),
    ]);
    expect(created).toHaveLength(4);
    const usage = await prisma.usageRecord.findFirstOrThrow({
      where: { workspaceId: owner.workspaceId, metric: "posts" },
    });
    expect(usage.used).toBe(4);
  });
});

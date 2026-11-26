import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { encode } from "next-auth/jwt";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { mailboxToken } from "@/lib/mailbox-url";
import { createAuthService } from "@/modules/auth/auth-service";
import { prisma } from "@/server/db/prisma";

const TEST_SECRET = "pr66-session-e2e-test-secret-not-for-production";
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

vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const authService = createAuthService(prisma, "http://127.0.0.1:3000");

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

async function createVerifiedUser(label: string, password = "password123") {
  const address = email(label);
  await authService.register(address, password);
  const mail = await prisma.devMailMessage.findFirst({
    where: { to: address, kind: "verify_email" },
    orderBy: { createdAt: "desc" },
  });
  await authService.verifyEmail(mailboxToken(mail?.url));
  const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
  return { address, password, user };
}

async function loginCookie(address: string, password: string) {
  const result = await authService.authenticate(address, password);
  if (!result.ok) {
    throw new Error("authenticate failed");
  }
  const jwt = await encode({
    token: {
      sub: result.user.id,
      email: result.user.email,
      sessionVersion: result.user.sessionVersion,
    },
    secret: TEST_SECRET,
    salt: COOKIE_NAME,
    maxAge: 3600,
  });
  return { cookie: `${COOKIE_NAME}=${jwt}`, user: result.user };
}

async function resetPasswordFor(address: string, nextPassword: string) {
  await authService.requestPasswordReset(address);
  const mail = await prisma.devMailMessage.findFirst({
    where: { to: address, kind: "reset_password" },
    orderBy: { createdAt: "desc" },
  });
  const result = await authService.resetPassword(mailboxToken(mail?.url), nextPassword);
  expect(result.ok).toBe(true);
}

type NodeHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

describe("PR66 Edge → Node session invalidation (integration)", () => {
  let server: Server;
  let origin = "";
  let handlerOverride: NodeHandler | null = null;
  let seenRequests: { url: string; cookie: string | undefined }[] = [];

  beforeAll(async () => {
    process.env.AUTH_SECRET = TEST_SECRET;
    process.env.AUTH_URL = "http://127.0.0.1:3000";
    await prisma.$connect();

    const { GET } = await import("@/app/api/auth/session-check/route");
    server = createServer(async (req, res) => {
      seenRequests.push({ url: req.url ?? "", cookie: req.headers.cookie });
      if (handlerOverride) {
        await handlerOverride(req, res);
        return;
      }
      if (req.url !== "/api/auth/session-check") {
        res.statusCode = 404;
        res.end();
        return;
      }
      const response = await GET(
        new Request(`${origin}${req.url}`, {
          headers: { cookie: req.headers.cookie ?? "" },
        }),
      );
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.end(await response.text());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    process.env.SESSION_CHECK_ORIGIN = origin;
  });

  afterAll(async () => {
    delete process.env.SESSION_CHECK_ORIGIN;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await prisma.$disconnect();
  });

  beforeEach(() => {
    handlerOverride = null;
    seenRequests = [];
    cookieJar.value = "";
    process.env.AUTH_SECRET = TEST_SECRET;
    process.env.SESSION_CHECK_ORIGIN = origin;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function runMiddleware(path: string, cookie?: string) {
    const { middleware } = await import("@/middleware");
    const request = new NextRequest(`http://127.0.0.1:3000${path}`, {
      headers: cookie ? { cookie } : {},
    });
    return middleware(request);
  }

  function redirectTarget(response: Response) {
    const location = response.headers.get("location");
    return location ? new URL(location) : null;
  }

  describe("S1 stale session after password reset", () => {
    it("denies the old cookie on a protected page and redirects to login", async () => {
      const { address, password } = await createVerifiedUser("s1-page");
      const { cookie } = await loginCookie(address, password);

      const before = await runMiddleware("/app", cookie);
      expect(before.headers.get("location")).toBeNull();

      await resetPasswordFor(address, "brand-new-password-1");

      const after = await runMiddleware("/app", cookie);
      expect(after.status).toBeGreaterThanOrEqual(300);
      expect(after.status).toBeLessThan(400);
      const target = redirectTarget(after);
      expect(target?.pathname).toBe("/login");
      expect(target?.searchParams.get("session")).toBe("expired");
    });

    it("denies /admin the same way as /app", async () => {
      const { address, password } = await createVerifiedUser("s1-admin");
      const { cookie } = await loginCookie(address, password);
      await resetPasswordFor(address, "brand-new-password-2");

      const after = await runMiddleware("/admin", cookie);
      expect(redirectTarget(after)?.pathname).toBe("/login");
    });

    it("forwards the original cookie to the Node session-check endpoint", async () => {
      const { address, password } = await createVerifiedUser("s1-cookie");
      const { cookie } = await loginCookie(address, password);

      await runMiddleware("/app/studio", cookie);

      expect(seenRequests).toHaveLength(1);
      expect(seenRequests[0]?.url).toBe("/api/auth/session-check");
      expect(seenRequests[0]?.cookie).toBe(cookie);
    });

    it("denies the old JWT on Node API routes and Server Actions after reset", async () => {
      const { address, password } = await createVerifiedUser("s1-node");
      const { cookie } = await loginCookie(address, password);

      cookieJar.value = cookie;
      const { auth } = await import("@/auth");
      const live = await auth();
      expect(live?.user?.id).toBeTruthy();

      await resetPasswordFor(address, "brand-new-password-3");

      const stale = await auth();
      expect(stale?.user?.id).toBeUndefined();

      const { POST } = await import("@/app/api/ai/connect/route");
      const form = new FormData();
      form.set("workspaceId", "ws");
      form.set("provider", "openai");
      form.set("apiKey", "sk-not-used");
      const apiResponse = await POST(
        new Request("http://127.0.0.1:3000/api/ai/connect", { method: "POST", body: form }),
      );
      expect(apiResponse.status).toBe(401);

      const { createPost } = await import("@/modules/posts/actions");
      const action = new FormData();
      action.set("workspaceId", "ws");
      action.set("projectId", "p");
      action.set("title", "should not be created");
      await expect(createPost(action)).rejects.toMatchObject({ status: 403 });
    });
  });

  describe("S2 new session after reset", () => {
    it("accepts a fresh login with the current sessionVersion", async () => {
      const { address, password, user } = await createVerifiedUser("s2");
      const oldLogin = await loginCookie(address, password);
      await resetPasswordFor(address, "brand-new-password-4");

      expect((await authService.authenticate(address, password)).ok).toBe(false);
      const fresh = await loginCookie(address, "brand-new-password-4");
      const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

      expect(fresh.user.sessionVersion).toBe(row.sessionVersion);
      expect(row.sessionVersion).toBe(oldLogin.user.sessionVersion + 1);

      const page = await runMiddleware("/app", fresh.cookie);
      expect(page.headers.get("location")).toBeNull();

      const stale = await runMiddleware("/app", oldLogin.cookie);
      expect(redirectTarget(stale)?.pathname).toBe("/login");

      cookieJar.value = fresh.cookie;
      const { auth } = await import("@/auth");
      const session = await auth();
      expect(session?.user?.id).toBe(user.id);
      expect((session?.user as { sessionVersion?: number }).sessionVersion).toBe(row.sessionVersion);
    });
  });

  describe("S3 Node endpoint failures fail closed (no JWT-only fallback)", () => {
    async function validCookie(label: string) {
      const { address, password } = await createVerifiedUser(label);
      return (await loginCookie(address, password)).cookie;
    }

    it("denies on HTTP 500", async () => {
      const cookie = await validCookie("s3-500");
      handlerOverride = (_req, res) => {
        res.statusCode = 500;
        res.end("boom");
      };
      expect(redirectTarget(await runMiddleware("/app", cookie))?.pathname).toBe("/login");
    });

    it("denies on HTTP 503", async () => {
      const cookie = await validCookie("s3-503");
      handlerOverride = (_req, res) => {
        res.statusCode = 503;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ valid: true }));
      };
      expect(redirectTarget(await runMiddleware("/app", cookie))?.pathname).toBe("/login");
    });

    it("denies on bad JSON", async () => {
      const cookie = await validCookie("s3-json");
      handlerOverride = (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end("{not json");
      };
      expect(redirectTarget(await runMiddleware("/app", cookie))?.pathname).toBe("/login");
    });

    it("denies when valid is not strictly true", async () => {
      const cookie = await validCookie("s3-shape");
      handlerOverride = (_req, res) => {
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ valid: "true" }));
      };
      expect(redirectTarget(await runMiddleware("/app", cookie))?.pathname).toBe("/login");
    });

    it("denies on network failure", async () => {
      const cookie = await validCookie("s3-net");
      process.env.SESSION_CHECK_ORIGIN = "http://127.0.0.1:1";
      expect(redirectTarget(await runMiddleware("/app", cookie))?.pathname).toBe("/login");
    });

    it("denies on timeout instead of hanging", async () => {
      const cookie = await validCookie("s3-timeout");
      process.env.SESSION_CHECK_TIMEOUT_MS = "150";
      handlerOverride = () => {
        // never answer
      };
      const started = Date.now();
      try {
        const response = await runMiddleware("/app", cookie);
        expect(redirectTarget(response)?.pathname).toBe("/login");
        expect(Date.now() - started).toBeLessThan(2_000);
      } finally {
        delete process.env.SESSION_CHECK_TIMEOUT_MS;
      }
    });

    it("denies when AUTH_SECRET is missing on Edge", async () => {
      const cookie = await validCookie("s3-secret");
      delete process.env.AUTH_SECRET;
      expect(redirectTarget(await runMiddleware("/app", cookie))?.pathname).toBe("/login");
      expect(seenRequests).toHaveLength(0);
    });

    it("session-check returns 503 {valid:false} when the database lookup throws", async () => {
      const { address, password } = await createVerifiedUser("s3-db");
      const { cookie } = await loginCookie(address, password);
      vi.spyOn(prisma.user, "findUnique").mockRejectedValueOnce(new Error("db down"));
      const { GET } = await import("@/app/api/auth/session-check/route");

      const response = await GET(
        new Request(`${origin}/api/auth/session-check`, { headers: { cookie } }),
      );

      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ valid: false });
    });

    it("session-check rejects a JWT signed with a different secret", async () => {
      const { user } = await createVerifiedUser("s3-forged");
      const forged = await encode({
        token: { sub: user.id, sessionVersion: user.sessionVersion },
        secret: "attacker-secret",
        salt: COOKIE_NAME,
        maxAge: 3600,
      });
      const response = await runMiddleware("/app", `${COOKIE_NAME}=${forged}`);
      expect(redirectTarget(response)?.pathname).toBe("/login");
      expect(seenRequests).toHaveLength(0);
    });
  });

  describe("S4 deleted user", () => {
    it("denies a valid-looking session after the user row is deleted", async () => {
      const { address, password, user } = await createVerifiedUser("s4");
      const { cookie } = await loginCookie(address, password);
      expect((await runMiddleware("/app", cookie)).headers.get("location")).toBeNull();

      await prisma.user.delete({ where: { id: user.id } });

      expect(redirectTarget(await runMiddleware("/app", cookie))?.pathname).toBe("/login");

      cookieJar.value = cookie;
      const { auth } = await import("@/auth");
      expect((await auth())?.user?.id).toBeUndefined();
    });
  });

  describe("S5 sanity", () => {
    it("lets public pages through without calling Node", async () => {
      for (const path of ["/", "/login", "/register", "/pricing", "/api/auth/session-check"]) {
        const response = await runMiddleware(path);
        expect(response.headers.get("location")).toBeNull();
      }
      expect(seenRequests).toHaveLength(0);
    });

    it("does not loop: /login and the session-check route are outside the matcher", async () => {
      const { config } = await import("@/middleware");
      const patterns = config.matcher.map((pattern) => new RegExp(`^${pattern.replace(/\/:path\*/g, "(?:/.*)?")}$`));
      const matched = (path: string) => patterns.some((pattern) => pattern.test(path));

      expect(matched("/app")).toBe(true);
      expect(matched("/app/studio")).toBe(true);
      expect(matched("/admin")).toBe(true);
      expect(matched("/admin/users")).toBe(true);
      expect(matched("/login")).toBe(false);
      expect(matched("/api/auth/session-check")).toBe(false);
    });

    it("redirects unauthenticated /app requests to login with callbackUrl and no Node call", async () => {
      const response = await runMiddleware("/app/studio");
      const target = redirectTarget(response);
      expect(target?.pathname).toBe("/login");
      expect(target?.searchParams.get("callbackUrl")).toBe("/app/studio");
      expect(seenRequests).toHaveLength(0);
    });

    it("does not falsely block a valid session and issues exactly one Node check", async () => {
      const { address, password } = await createVerifiedUser("s5-valid");
      const { cookie } = await loginCookie(address, password);

      const response = await runMiddleware("/app/calendar", cookie);

      expect(response.headers.get("location")).toBeNull();
      expect(seenRequests).toHaveLength(1);
    });

    it("never forwards the session cookie to a Host-derived origin", async () => {
      const { address, password } = await createVerifiedUser("s5-host");
      const { cookie } = await loginCookie(address, password);
      const { middleware } = await import("@/middleware");
      const attacker = createServer((req, res) => {
        seenAttacker.push(req.headers.cookie ?? "");
        res.end(JSON.stringify({ valid: true }));
      });
      const seenAttacker: string[] = [];
      await new Promise<void>((resolve) => attacker.listen(0, "127.0.0.1", resolve));
      const attackerPort = (attacker.address() as AddressInfo).port;
      try {
        const request = new NextRequest(`http://127.0.0.1:${attackerPort}/app`, {
          headers: { cookie, host: `127.0.0.1:${attackerPort}` },
        });
        await middleware(request);
      } finally {
        await new Promise<void>((resolve) => attacker.close(() => resolve()));
      }
      expect(seenAttacker).toHaveLength(0);
    });
  });
});

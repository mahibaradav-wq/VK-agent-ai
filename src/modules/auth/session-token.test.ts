import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mailboxToken } from "@/lib/mailbox-url";
import { createAuthService } from "@/modules/auth/auth-service";
import {
  loadUserSessionVersion,
  readTokenSessionVersion,
  resolveSessionToken,
  stampTokenSessionVersion,
  type SessionTokenLike,
} from "@/modules/auth/session-token";
import { prisma } from "@/server/db/prisma";

const auth = createAuthService(prisma, "http://localhost:3000");

function email(label: string) {
  return `${label}.${Date.now()}.${Math.random().toString(16).slice(2)}@example.test`;
}

describe("sessionVersion Node+Edge consistency", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("stamps and reads sessionVersion the same way Edge and Node helpers do", () => {
    const token = stampTokenSessionVersion({} as SessionTokenLike, { id: "u1", sessionVersion: 3 });
    expect(token.sub).toBe("u1");
    expect(readTokenSessionVersion(token)).toBe(3);
    expect(resolveSessionToken(token, 3)).toEqual(token);
    expect(resolveSessionToken(token, 4)).toEqual({});
    expect(resolveSessionToken(token, null)).toEqual({});
  });

  it("password reset increments sessionVersion so old JWT resolves empty", async () => {
    const address = email("sv-reset");
    const registered = await auth.register(address, "password123");
    expect(registered.ok).toBe(true);
    const mail = await prisma.devMailMessage.findFirstOrThrow({
      where: { to: address, kind: "verify_email" },
      orderBy: { createdAt: "desc" },
    });
    await auth.verifyEmail(mailboxToken(mail.url));

    const userBefore = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    expect(userBefore.sessionVersion).toBe(0);
    const oldJwt = stampTokenSessionVersion({} as SessionTokenLike, {
      id: userBefore.id,
      sessionVersion: userBefore.sessionVersion,
    });

    await auth.requestPasswordReset(address);
    const resetMail = await prisma.devMailMessage.findFirstOrThrow({
      where: { to: address, kind: "reset_password" },
      orderBy: { createdAt: "desc" },
    });
    const reset = await auth.resetPassword(mailboxToken(resetMail.url), "newpassword123");
    expect(reset.ok).toBe(true);

    const userAfter = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    expect(userAfter.sessionVersion).toBe(userBefore.sessionVersion + 1);

    const current = await loadUserSessionVersion(userAfter.id, (id) =>
      prisma.user.findUnique({ where: { id }, select: { sessionVersion: true } }),
    );
    // Same rule Edge session-check and Node jwt use:
    expect(resolveSessionToken(oldJwt, current)).toEqual({});
    const fresh = stampTokenSessionVersion({} as SessionTokenLike, {
      id: userAfter.id,
      sessionVersion: userAfter.sessionVersion,
    });
    expect(resolveSessionToken(fresh, current)).toEqual(fresh);
  });

  it("new login authenticate returns the current sessionVersion", async () => {
    const address = email("sv-login");
    await auth.register(address, "password123");
    const mail = await prisma.devMailMessage.findFirstOrThrow({
      where: { to: address, kind: "verify_email" },
      orderBy: { createdAt: "desc" },
    });
    await auth.verifyEmail(mailboxToken(mail.url));
    await auth.requestPasswordReset(address);
    const resetMail = await prisma.devMailMessage.findFirstOrThrow({
      where: { to: address, kind: "reset_password" },
      orderBy: { createdAt: "desc" },
    });
    await auth.resetPassword(mailboxToken(resetMail.url), "brand-new-pass");
    const login = await auth.authenticate(address, "brand-new-pass");
    expect(login.ok).toBe(true);
    if (login.ok) {
      expect(login.user.sessionVersion).toBeGreaterThan(0);
      const token = stampTokenSessionVersion({} as SessionTokenLike, login.user);
      const current = await loadUserSessionVersion(login.user.id, (id) =>
        prisma.user.findUnique({ where: { id }, select: { sessionVersion: true } }),
      );
      expect(resolveSessionToken(token, current)).toMatchObject({ sub: login.user.id });
    }
  });

  it("missing user is rejected by resolveSessionToken", async () => {
    const token = stampTokenSessionVersion({} as SessionTokenLike, {
      id: "missing-user-id",
      sessionVersion: 0,
    });
    const current = await loadUserSessionVersion("missing-user-id", (id) =>
      prisma.user.findUnique({ where: { id }, select: { sessionVersion: true } }),
    );
    expect(current).toBeNull();
    expect(resolveSessionToken(token, current)).toEqual({});
  });
});

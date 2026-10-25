import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mailboxToken } from "@/lib/mailbox-url";
import { createAuthService, hashToken } from "@/modules/auth/auth-service";
import { prisma } from "@/server/db/prisma";

const siteUrl = "http://localhost:3000";
const auth = createAuthService(prisma, siteUrl);

function email(label: string) {
  return `${label}.${Date.now()}@example.test`;
}

describe("auth service", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("creates a workspace and rejects a taken email", async () => {
    const address = email("taken");
    const first = await auth.register(address, "password123");
    const second = await auth.register(address, "password123");
    const user = await prisma.user.findUnique({
      where: { email: address },
      include: { memberships: true },
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.message).toContain("занят");
    expect(user?.memberships[0]?.role).toBe("Owner");
  });

  it("rejects login before email verification", async () => {
    const address = email("unverified");
    await auth.register(address, "password123");
    const result = await auth.authenticate(address, "password123");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain("подтвердите email");
    }
  });

  it("rejects an invalid verification token", async () => {
    const result = await auth.verifyEmail("not-a-real-token");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("недействителен");
  });

  it("verifies email from the local mailbox token", async () => {
    const address = email("verify");
    await auth.register(address, "password123");
    const mail = await prisma.devMailMessage.findFirst({
      where: { to: address, kind: "verify_email" },
      orderBy: { createdAt: "desc" },
    });
    const token = mailboxToken(mail?.url);
    const verified = await auth.verifyEmail(token);
    const login = await auth.authenticate(address, "password123");

    expect(mail?.url?.startsWith("/verify-email?token=")).toBe(true);
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.email).toBe(address);
    }
    expect(login.ok).toBe(true);
  });

  it("rejects an expired password reset token", async () => {
    const address = email("expired");
    await auth.register(address, "password123");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: address } });
    const expiredToken = `expired-token-${address}`;
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(expiredToken),
        expires: new Date(Date.now() - 1000),
      },
    });

    const result = await auth.resetPassword(expiredToken, "newpassword123");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("просрочен");
  });

  it("resets a password from a mailbox token", async () => {
    const address = email("reset");
    await auth.register(address, "password123");
    const verifyMail = await prisma.devMailMessage.findFirst({
      where: { to: address, kind: "verify_email" },
      orderBy: { createdAt: "desc" },
    });
    const verifyToken = mailboxToken(verifyMail?.url);
    await auth.verifyEmail(verifyToken);
    const mailRequest = await auth.requestPasswordReset(address);
    const mail = await prisma.devMailMessage.findFirst({
      where: { to: address, kind: "reset_password" },
      orderBy: { createdAt: "desc" },
    });
    const token = mailboxToken(mail?.url);
    const reset = await auth.resetPassword(token, "newpassword123");
    const login = await auth.authenticate(address, "newpassword123");

    expect(mailRequest.ok).toBe(true);
    expect(reset.ok).toBe(true);
    expect(login.ok).toBe(true);
  });
});

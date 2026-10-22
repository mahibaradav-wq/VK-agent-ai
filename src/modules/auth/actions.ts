"use server";

import { headers } from "next/headers";

import { signIn, signOut } from "@/auth";
import { createAuthService } from "@/modules/auth/auth-service";
import { storeDevMail } from "@/server/mail/dev-mailbox";
import { prisma } from "@/server/db/prisma";
import { AUTH_RATE_LIMITS, consumeRateLimit } from "@/server/security/rate-limit";

export type AuthFormState = {
  status: "idle" | "invalid" | "success";
  message: string;
  mailboxUrl?: string;
};

const initialSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function service() {
  return createAuthService(prisma, initialSiteUrl);
}

const rateLimited: AuthFormState = {
  status: "invalid",
  message: "Слишком много попыток. Подождите несколько минут.",
};

async function clientKey(kind: string, extra = "") {
  const requestHeaders = await headers();
  const ip =
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    requestHeaders.get("x-real-ip") ||
    "local";
  return extra ? `${kind}:${ip}:${extra}` : `${kind}:${ip}`;
}

export async function registerUser(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const gate = consumeRateLimit(
    await clientKey("register"),
    AUTH_RATE_LIMITS.register.limit,
    AUTH_RATE_LIMITS.register.windowMs,
  );
  if (!gate.ok) {
    return rateLimited;
  }
  const result = await service().register(readField(formData, "email"), readField(formData, "password"));
  return {
    status: result.ok ? "success" : "invalid",
    message: result.message,
    mailboxUrl: result.ok ? result.mailboxUrl : undefined,
  };
}

export async function loginUser(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const password = readField(formData, "password");
  const gate = consumeRateLimit(
    await clientKey("login", email.toLowerCase()),
    AUTH_RATE_LIMITS.login.limit,
    AUTH_RATE_LIMITS.login.windowMs,
  );
  if (!gate.ok) {
    return rateLimited;
  }
  const result = await service().authenticate(email, password);

  if (!result.ok) {
    return { status: "invalid", message: result.message };
  }

  await signIn("credentials", {
    email,
    password,
    redirectTo: "/app",
  });

  return { status: "success", message: "Вход выполнен." };
}

export async function logoutUser() {
  await signOut({ redirectTo: "/" });
}

export async function requestPasswordReset(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const gate = consumeRateLimit(
    await clientKey("reset", email.toLowerCase()),
    AUTH_RATE_LIMITS.reset.limit,
    AUTH_RATE_LIMITS.reset.windowMs,
  );
  if (!gate.ok) {
    return rateLimited;
  }
  const result = await service().requestPasswordReset(email);
  return {
    status: result.ok ? "success" : "invalid",
    message: result.message,
    mailboxUrl: result.ok ? result.mailboxUrl : undefined,
  };
}

export async function resetPassword(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const result = await service().resetPassword(readField(formData, "token"), readField(formData, "password"));
  return {
    status: result.ok ? "success" : "invalid",
    message: result.message,
  };
}

export async function verifyEmailToken(token: string): Promise<AuthFormState> {
  const result = await service().verifyEmail(token);
  return {
    status: result.ok ? "success" : "invalid",
    message: result.message,
  };
}

export async function requestContact(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const email = readField(formData, "email");
  const message = readField(formData, "message");
  const gate = consumeRateLimit(
    await clientKey("contact"),
    AUTH_RATE_LIMITS.contact.limit,
    AUTH_RATE_LIMITS.contact.windowMs,
  );
  if (!gate.ok) {
    return rateLimited;
  }

  if (!email || message.length < 10) {
    return { status: "invalid", message: "Укажите email и сообщение не короче 10 символов." };
  }

  await storeDevMail({
    to: "team@localhost",
    subject: `Сообщение от ${email}`,
    body: message,
    kind: "contact",
  });

  return {
    status: "success",
    message: "Письмо не отправлялось во внешнюю почту. Сообщение сохранено в локальном почтовом стенде.",
    mailboxUrl: "/dev/mailbox",
  };
}

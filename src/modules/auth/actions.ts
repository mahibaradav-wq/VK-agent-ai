"use server";

import { signIn, signOut } from "@/auth";
import { createAuthService } from "@/modules/auth/auth-service";
import { storeDevMail } from "@/server/mail/dev-mailbox";
import { prisma } from "@/server/db/prisma";

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

export async function registerUser(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
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
  const result = await service().requestPasswordReset(readField(formData, "email"));
  return {
    status: result.ok ? "success" : "invalid",
    message: result.message,
    mailboxUrl: result.mailboxUrl,
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

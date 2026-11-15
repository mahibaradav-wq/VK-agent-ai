"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createSocialService } from "@/modules/social/social-service";
import { prisma } from "@/server/db/prisma";

export type SocialFormState = {
  status: "idle" | "invalid" | "success";
  message: string;
};

async function requireUserId() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new AccessError(403, "Нужна авторизация.");
  }
  return session.user.id;
}

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function revalidateSocial() {
  revalidatePath("/app/social-accounts");
  revalidatePath("/app/posts");
  revalidatePath("/app/queue");
  revalidatePath("/app/watch");
  revalidatePath("/app/ideas");
  revalidatePath("/app/connections");
}

export async function createSetupAccount(_prev: SocialFormState, formData: FormData): Promise<SocialFormState> {
  try {
    const account = await createSocialService(prisma).createRequiresSetup(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        platform: readField(formData, "platform"),
        displayName: readField(formData, "displayName"),
        projectId: readField(formData, "projectId") || undefined,
        password: readField(formData, "password"),
      },
    );
    revalidateSocial();
    return {
      status: "success",
      message: `Аккаунт ${account.platform} создан со статусом ${account.status}. Публикация без токена не имитируется.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось создать аккаунт.";
    return { status: "invalid", message };
  }
}

export async function connectVk(_prev: SocialFormState, formData: FormData): Promise<SocialFormState> {
  try {
    const account = await createSocialService(prisma).connectVk(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        token: readField(formData, "communityToken"),
        source: readField(formData, "source"),
        displayName: readField(formData, "displayName"),
        projectId: readField(formData, "projectId") || undefined,
        accountId: readField(formData, "accountId") || undefined,
        password: readField(formData, "password"),
      },
    );
    revalidateSocial();
    return {
      status: "success",
      message: `ВКонтакте подключено как ${account.displayName}. Ключ сохранён в зашифрованном виде. Текст и фото уходят wall.post на стену этого сообщества.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось подключить ВКонтакте.";
    return { status: "invalid", message };
  }
}

export async function connectTelegram(_prev: SocialFormState, formData: FormData): Promise<SocialFormState> {
  try {
    const account = await createSocialService(prisma).connectTelegram(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        token: readField(formData, "botToken"),
        chatId: readField(formData, "chatId"),
        displayName: readField(formData, "displayName"),
        projectId: readField(formData, "projectId") || undefined,
        accountId: readField(formData, "accountId") || undefined,
        password: readField(formData, "password"),
      },
    );
    revalidateSocial();
    return {
      status: "success",
      message: `Telegram подключён как ${account.displayName}. Токен сохранён в зашифрованном виде и не отдаётся в браузер.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось подключить Telegram.";
    return { status: "invalid", message };
  }
}

export async function bindTelegramChannel(_prev: SocialFormState, formData: FormData): Promise<SocialFormState> {
  try {
    const account = await createSocialService(prisma).bindTelegramChannel(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        accountId: readField(formData, "accountId"),
        chatId: readField(formData, "chatId"),
        projectId: readField(formData, "projectId") || undefined,
        password: readField(formData, "password"),
      },
    );
    revalidateSocial();
    return {
      status: "success",
      message: `Канал привязан: ${account.displayName}. Посты уходят туда через бота, токен повторно не нужен.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось привязать канал Telegram.";
    return { status: "invalid", message };
  }
}

export async function disconnectSocial(_prev: SocialFormState, formData: FormData): Promise<SocialFormState> {
  try {
    await createSocialService(prisma).disconnect(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "accountId"),
    );
    revalidateSocial();
    return { status: "success", message: "Аккаунт отключён, токен удалён." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отключить аккаунт.";
    return { status: "invalid", message };
  }
}

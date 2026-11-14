"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createWatchService } from "@/modules/watch/watch-service";
import { prisma } from "@/server/db/prisma";

export type WatchFormState = {
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

function revalidateWatch() {
  revalidatePath("/app/watch");
  revalidatePath("/app/ai");
}

export async function connectVkWatch(_prev: WatchFormState, formData: FormData): Promise<WatchFormState> {
  try {
    await createWatchService(prisma).connectToken(await requireUserId(), readField(formData, "workspaceId"), {
      token: readField(formData, "token"),
      password: readField(formData, "password"),
      vkPassword: readField(formData, "vkPassword"),
    });
    revalidateWatch();
    return { status: "success", message: "Ключ VK для чтения стен сохранён и зашифрован. Публикация во ВК от этого не включается." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось сохранить ключ VK.";
    return { status: "invalid", message };
  }
}

export async function disconnectVkWatch(_prev: WatchFormState, formData: FormData): Promise<WatchFormState> {
  try {
    await createWatchService(prisma).disconnectToken(await requireUserId(), readField(formData, "workspaceId"));
    revalidateWatch();
    return { status: "success", message: "Ключ VK для чтения стен отключён." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отключить ключ.";
    return { status: "invalid", message };
  }
}

export async function addWatchCommunity(_prev: WatchFormState, formData: FormData): Promise<WatchFormState> {
  try {
    const community = await createWatchService(prisma).addCommunity(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "source"),
    );
    revalidateWatch();
    return {
      status: "success",
      message: community.lastError
        ? `Сообщество ${community.screenName} добавлено, но стену прочитать не удалось: ${community.lastError}`
        : `Сообщество ${community.screenName} добавлено в наблюдение.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось добавить сообщество.";
    return { status: "invalid", message };
  }
}

export async function removeWatchCommunity(_prev: WatchFormState, formData: FormData): Promise<WatchFormState> {
  try {
    await createWatchService(prisma).removeCommunity(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "communityId"),
    );
    revalidateWatch();
    return { status: "success", message: "Сообщество убрано из наблюдения." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось удалить сообщество.";
    return { status: "invalid", message };
  }
}

export async function collectWatchIdeas(_prev: WatchFormState, formData: FormData): Promise<WatchFormState> {
  try {
    const result = await createWatchService(prisma).collectIdeas(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        brief: readField(formData, "brief"),
        projectId: readField(formData, "projectId") || undefined,
      },
    );
    revalidateWatch();
    return {
      status: "success",
      message: `Прочитано постов: ${result.posts.length}. Идей: ${result.request.items.length}. Это не публикация во ВК.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось собрать идеи.";
    return { status: "invalid", message };
  }
}

export async function applyWatchIdea(formData: FormData) {
  const post = await createWatchService(prisma).applyIdea(
    await requireUserId(),
    readField(formData, "workspaceId"),
    readField(formData, "requestId"),
    Number(readField(formData, "itemIndex")),
    readField(formData, "projectId"),
  );
  redirect(`/app/posts/${post.id}`);
}

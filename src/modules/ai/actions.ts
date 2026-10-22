"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { prisma } from "@/server/db/prisma";

export type AiFormState = {
  status: "idle" | "invalid" | "success";
  message: string;
  requestId?: string;
  title?: string;
  body?: string;
  items?: string[];
  postId?: string;
  mediaId?: string;
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

export async function generateAi(_prev: AiFormState, formData: FormData): Promise<AiFormState> {
  try {
    const result = await createAiService(prisma).generate(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        kind: readField(formData, "kind"),
        prompt: readField(formData, "prompt"),
        tone: readField(formData, "tone"),
        length: readField(formData, "length"),
        platform: readField(formData, "platform"),
        projectId: readField(formData, "projectId") || undefined,
      },
    );
    revalidatePath("/app/ai");
    return {
      status: "success",
      message: "Генерация сохранена в историю. Ключ провайдера в ответ не передаётся.",
      requestId: result.id,
      title: result.title,
      body: result.body,
      items: result.items,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось выполнить генерацию.";
    return { status: "invalid", message };
  }
}

export async function applyAiToPost(formData: FormData) {
  const post = await createAiService(prisma).applyToPost(
    await requireUserId(),
    readField(formData, "workspaceId"),
    readField(formData, "requestId"),
    readField(formData, "projectId"),
  );
  redirect(`/app/posts/${post.id}`);
}

export async function composeAgentPost(_prev: AiFormState, formData: FormData): Promise<AiFormState> {
  try {
    const result = await createAiService(prisma).composeAgentPost(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        prompt: readField(formData, "prompt"),
        tone: readField(formData, "tone"),
        length: readField(formData, "length"),
        platform: readField(formData, "platform"),
        projectId: readField(formData, "projectId"),
      },
    );
    revalidatePath("/app/ai");
    revalidatePath("/app/posts");
    revalidatePath(`/app/posts/${result.post.id}`);
    return {
      status: "success",
      message: "Черновик создан. Агент приложил визуал — откройте редактор, чтобы проверить и опубликовать.",
      requestId: result.request.id,
      title: result.request.title,
      body: result.request.body,
      postId: result.post.id,
      mediaId: result.mediaId,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось создать пост с визуалом.";
    return { status: "invalid", message };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { draftInputFromForm } from "@/modules/posts/draft-fields";
import { createPostService } from "@/modules/posts/post-service";
import { prisma } from "@/server/db/prisma";

export type PostFormState = {
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

export async function createPost(formData: FormData) {
  const userId = await requireUserId();
  const post = await createPostService(prisma).create(
    userId,
    readField(formData, "workspaceId"),
    readField(formData, "projectId"),
    readField(formData, "title"),
  );
  redirect(`/app/posts/${post.id}`);
}

export async function savePostDraft(_prev: PostFormState, formData: FormData): Promise<PostFormState> {
  try {
    const draft = draftInputFromForm(formData);
    const result = await createPostService(prisma).saveDraft(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "postId"),
      {
        title: draft.title,
        body: draft.body,
        platforms: draft.platforms,
        variants: draft.variants,
        mediaIds: draft.mediaIds,
      },
    );
    revalidatePath("/app/posts");
    revalidatePath("/app/calendar");
    revalidatePath("/app/studio");
    revalidatePath(`/app/posts/${readField(formData, "postId")}`);
    return {
      status: "success",
      message: result.changed
        ? `Черновик сохранён, версия ${result.version.number}. Предыдущая версия аннулирована.`
        : "Изменений нет, новая версия не создавалась.",
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось сохранить черновик.";
    return { status: "invalid", message };
  }
}

function revalidateStudio(postId?: string) {
  revalidatePath("/app/studio");
  revalidatePath("/app/ideas");
  revalidatePath("/app/products");
  revalidatePath("/app/calendar");
  revalidatePath("/app/posts");
  if (postId) {
    revalidatePath(`/app/posts/${postId}`);
  }
}

export async function discardStudioCard(formData: FormData) {
  const postId = readField(formData, "postId");
  await createPostService(prisma).discardStudioCard(
    await requireUserId(),
    readField(formData, "workspaceId"),
    postId,
  );
  revalidateStudio(postId);
}

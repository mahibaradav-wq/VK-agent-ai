"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { persistStudioDraftFromForm } from "@/modules/posts/studio-draft";
import { createPublishService } from "@/modules/publishing/publish-service";
import { prisma } from "@/server/db/prisma";

export type PublishFormState = {
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

function revalidatePublish(postId?: string) {
  revalidatePath("/app/queue");
  revalidatePath("/app/posts");
  revalidatePath("/app/calendar");
  revalidatePath("/app/studio");
  revalidatePath("/app/ideas");
  revalidatePath("/app/products");
  if (postId) {
    revalidatePath(`/app/posts/${postId}`);
  }
}

const platformLabels: Record<string, string> = {
  telegram: "Telegram",
  vk: "ВКонтакте",
};

function publishNowMessage(job: {
  status: string;
  lastError: string | null;
  post?: { targets: Array<{ platform: string; status: string; lastError: string | null }> };
  attempts: Array<{ kind: string; errorCode: string | null; errorMessage: string | null }>;
}) {
  if (job.status === "completed") {
    const sent = (job.post?.targets ?? [])
      .filter((target) => target.status === "published")
      .map((target) => platformLabels[target.platform] ?? target.platform);
    return {
      status: "success" as const,
      message: sent.length ? `Пост ушёл: ${sent.join(" и ")}.` : "Пост опубликован.",
    };
  }
  const targetError = job.post?.targets.find((target) => target.lastError)?.lastError;
  const attempt = job.attempts.find((item) => item.kind !== "success");
  return {
    status: "invalid" as const,
    message:
      job.lastError ||
      targetError ||
      attempt?.errorMessage ||
      "Пост не вышел. VK или Telegram отклонили публикацию.",
  };
}

export async function publishNowPost(_prev: PublishFormState, formData: FormData): Promise<PublishFormState> {
  const postId = readField(formData, "postId");
  try {
    const userId = await requireUserId();
    await persistStudioDraftFromForm(userId, formData);
    const job = await createPublishService(prisma).publishNow(
      userId,
      readField(formData, "workspaceId"),
      postId,
    );
    revalidatePublish(postId);
    return publishNowMessage(job);
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось опубликовать сейчас.";
    return { status: "invalid", message };
  }
}

export async function enqueuePost(_prev: PublishFormState, formData: FormData): Promise<PublishFormState> {
  const postId = readField(formData, "postId");
  try {
    const job = await createPublishService(prisma).enqueue(
      await requireUserId(),
      readField(formData, "workspaceId"),
      postId,
    );
    revalidatePublish(postId);
    return {
      status: "success",
      message: `Задача ${job.status === "pending" ? "поставлена в очередь" : job.status}. Успешные цели повторно не отправляются.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось поставить публикацию в очередь.";
    return { status: "invalid", message };
  }
}

export async function processDueJobs(_prev: PublishFormState, formData: FormData): Promise<PublishFormState> {
  try {
    const userId = await requireUserId();
    const workspaceId = readField(formData, "workspaceId");
    const publishing = createPublishService(prisma);
    const { due, processed } = await publishing.runWorkspaceQueue(userId, workspaceId, `ui:${userId}`);
    revalidatePublish();
    return {
      status: "success",
      message: `Планировщик: ${due.length} по расписанию. Обработано задач: ${processed.filter((item) => !item.skipped).length}.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось обработать очередь.";
    return { status: "invalid", message };
  }
}

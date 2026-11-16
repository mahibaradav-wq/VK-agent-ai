"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { createAiConnectionService } from "@/modules/ai/provider-service";
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

export async function connectAiProvider(_prev: AiFormState, formData: FormData): Promise<AiFormState> {
  try {
    const connection = await createAiConnectionService(prisma).connect(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        provider: readField(formData, "provider"),
        apiKey: readField(formData, "apiKey"),
      },
    );
    revalidatePath("/app/ai");
    return {
      status: "success",
      message: `${connection.label} подключён. Ключ зашифрован на сервере и во frontend не возвращается.`,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось подключить AI.";
    return { status: "invalid", message };
  }
}

export async function disconnectAiProvider(_prev: AiFormState, formData: FormData): Promise<AiFormState> {
  try {
    const provider = readField(formData, "provider");
    await createAiConnectionService(prisma).disconnect(
      await requireUserId(),
      readField(formData, "workspaceId"),
      provider || undefined,
    );
    revalidatePath("/app/ai");
    return {
      status: "success",
      message: provider ? `${provider} отключён.` : "AI-провайдер отключён. Генерация больше не имитируется.",
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отключить AI.";
    return { status: "invalid", message };
  }
}

export async function checkVisualModels(_prev: AiFormState, formData: FormData): Promise<AiFormState> {
  try {
    const result = await createAiService(prisma).checkVisualModels(
      await requireUserId(),
      readField(formData, "workspaceId"),
    );
    return { status: "success", message: result.message };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось проверить модели.";
    return { status: "invalid", message };
  }
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
        platforms: formData.getAll("platform").filter((value): value is string => typeof value === "string"),
        projectId: readField(formData, "projectId"),
        visualKind: readField(formData, "visualKind"),
        visualAspect: readField(formData, "visualAspect"),
        visualPrompt: readField(formData, "visualPrompt"),
        carouselCount: readField(formData, "carouselCount"),
        shopProductId: readField(formData, "shopProductId") || undefined,
      },
    );
    revalidatePath("/app/ai");
    revalidatePath("/app/studio");
    revalidatePath("/app/ideas");
    revalidatePath("/app/products");
    revalidatePath("/app/posts");
    revalidatePath(`/app/posts/${result.post.id}`);
    return {
      status: "success",
      message: "Черновик лежит в Студии. Отмеченные сети получат этот пост. Можно поправить текст, визуал и галочки.",
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

export async function reviseStudioCard(_prev: AiFormState, formData: FormData): Promise<AiFormState> {
  try {
    const rewriteRaw = readField(formData, "rewrite");
    const rewrite = rewriteRaw === "text" || rewriteRaw === "visual" ? rewriteRaw : "both";
    const post = await createAiService(prisma).reviseStudioCard(
      await requireUserId(),
      readField(formData, "workspaceId"),
      {
        postId: readField(formData, "postId"),
        comment: readField(formData, "comment"),
        rewrite,
      },
    );
    revalidatePath("/app/studio");
    revalidatePath("/app/ideas");
    revalidatePath("/app/posts");
    revalidatePath(`/app/posts/${post.id}`);
    const version = post.versions.find((item) => !item.supersededAt) ?? post.versions[0];
    return {
      status: "success",
      message:
        rewrite === "text"
          ? "Текст переписан по комментарию."
          : rewrite === "visual"
            ? "Визуал перерисован по комментарию."
            : "Текст и визуал обновлены по комментарию.",
      postId: post.id,
      title: version?.title,
      body: version?.body,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось поправить карточку.";
    return { status: "invalid", message };
  }
}

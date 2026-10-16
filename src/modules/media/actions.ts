"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createMediaService } from "@/modules/media/media-service";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";

export type MediaFormState = {
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

export async function uploadMedia(_prev: MediaFormState, formData: FormData): Promise<MediaFormState> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { status: "invalid", message: "Выберите файл изображения." };
    }

    await createMediaService(prisma, storage).upload(await requireUserId(), readField(formData, "workspaceId"), {
      filename: file.name,
      declaredType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
    revalidatePath("/app/media");
    revalidatePath("/app/posts");
    return { status: "success", message: "Файл загружен в медиатеку." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось загрузить файл.";
    return { status: "invalid", message };
  }
}

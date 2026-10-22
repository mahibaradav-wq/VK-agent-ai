"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createProjectService } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";

export type ProjectFormState = {
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

export async function createProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  try {
    await createProjectService(prisma).create(await requireUserId(), readField(formData, "workspaceId"), {
      name: readField(formData, "name"),
      description: readField(formData, "description"),
      color: readField(formData, "color"),
    });
    revalidatePath("/app/projects");
    return { status: "success", message: "Проект создан." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось создать проект.";
    return { status: "invalid", message };
  }
}

export async function updateProject(_prev: ProjectFormState, formData: FormData): Promise<ProjectFormState> {
  try {
    await createProjectService(prisma).update(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "projectId"),
      {
        name: readField(formData, "name"),
        description: readField(formData, "description"),
        color: readField(formData, "color"),
      },
    );
    revalidatePath("/app/projects");
    return { status: "success", message: "Проект обновлён." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось обновить проект.";
    return { status: "invalid", message };
  }
}

export async function archiveProject(formData: FormData) {
  try {
    await createProjectService(prisma).archive(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "projectId"),
    );
    revalidatePath("/app/projects");
  } catch (error) {
    if (error instanceof AccessError) {
      throw error;
    }
    throw new AccessError(403, "Не удалось архивировать проект.");
  }
}

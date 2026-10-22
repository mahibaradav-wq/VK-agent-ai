"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { PROJECT_COOKIE, WORKSPACE_COOKIE } from "@/modules/access/app-context";
import { createWorkspaceService } from "@/modules/workspaces/workspace-service";
import { prisma } from "@/server/db/prisma";

export type WorkspaceFormState = {
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

export async function selectWorkspace(formData: FormData) {
  const userId = await requireUserId();
  const workspaceId = readField(formData, "workspaceId");
  const memberships = await createWorkspaceService(prisma).listForUser(userId);
  const allowed = memberships.some((item) => item.workspaceId === workspaceId);

  if (!allowed) {
    throw new AccessError(403, "Нет доступа к этому рабочему пространству.");
  }

  const cookieStore = await cookies();
  cookieStore.set(WORKSPACE_COOKIE, workspaceId, { httpOnly: true, sameSite: "lax", path: "/" });
  cookieStore.delete(PROJECT_COOKIE);
  revalidatePath("/app");
}

export async function selectProject(formData: FormData) {
  const workspaceId = readField(formData, "workspaceId");
  const projectId = readField(formData, "projectId");
  const userId = await requireUserId();
  const { createProjectService } = await import("@/modules/projects/project-service");
  await createProjectService(prisma).get(userId, workspaceId, projectId);

  const cookieStore = await cookies();
  cookieStore.set(PROJECT_COOKIE, projectId, { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/app");
}

export async function addWorkspaceMember(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  try {
    const userId = await requireUserId();
    await createWorkspaceService(prisma).addMember(
      userId,
      readField(formData, "workspaceId"),
      readField(formData, "email"),
      readField(formData, "role"),
    );
    revalidatePath("/app/team");
    return { status: "success", message: "Участник добавлен." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось добавить участника.";
    return { status: "invalid", message };
  }
}

export async function changeWorkspaceRole(_prev: WorkspaceFormState, formData: FormData): Promise<WorkspaceFormState> {
  try {
    const userId = await requireUserId();
    await createWorkspaceService(prisma).changeRole(
      userId,
      readField(formData, "workspaceId"),
      readField(formData, "targetUserId"),
      readField(formData, "role"),
    );
    revalidatePath("/app/team");
    return { status: "success", message: "Роль обновлена." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось изменить роль.";
    return { status: "invalid", message };
  }
}

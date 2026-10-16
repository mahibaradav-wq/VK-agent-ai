"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
import { prisma } from "@/server/db/prisma";

export type CollaborationFormState = {
  status: "idle" | "invalid" | "success";
  message: string;
  mailboxUrl?: string;
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

function collab() {
  return createCollaborationService(prisma);
}

export async function inviteMember(
  _prev: CollaborationFormState,
  formData: FormData,
): Promise<CollaborationFormState> {
  try {
    const result = await collab().invite(await requireUserId(), readField(formData, "workspaceId"), {
      email: readField(formData, "email"),
      role: readField(formData, "role"),
      projectIds: formData.getAll("projectId").filter((value): value is string => typeof value === "string"),
    });
    revalidatePath("/app/team");
    return {
      status: "success",
      message: "Приглашение сохранено в локальном почтовом стенде, во внешнюю почту письмо не отправлялось.",
      mailboxUrl: result.mailboxUrl,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отправить приглашение.";
    return { status: "invalid", message };
  }
}

export async function assignApproverProjects(
  _prev: CollaborationFormState,
  formData: FormData,
): Promise<CollaborationFormState> {
  try {
    await collab().setProjectAccess(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "userId"),
      formData.getAll("projectId").filter((value): value is string => typeof value === "string"),
    );
    revalidatePath("/app/team");
    return { status: "success", message: "Проекты согласования обновлены." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось назначить проекты.";
    return { status: "invalid", message };
  }
}

export async function submitPostForApproval(
  _prev: CollaborationFormState,
  formData: FormData,
): Promise<CollaborationFormState> {
  try {
    const postId = readField(formData, "postId");
    await collab().submitForApproval(await requireUserId(), readField(formData, "workspaceId"), postId);
    revalidatePath(`/app/posts/${postId}`);
    revalidatePath("/app/notifications");
    return { status: "success", message: "Отправлено на согласование." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отправить на согласование.";
    return { status: "invalid", message };
  }
}

export async function approvePost(
  _prev: CollaborationFormState,
  formData: FormData,
): Promise<CollaborationFormState> {
  try {
    const postId = readField(formData, "postId");
    await collab().approve(await requireUserId(), readField(formData, "workspaceId"), postId, readField(formData, "note"));
    revalidatePath(`/app/posts/${postId}`);
    revalidatePath("/app/notifications");
    return { status: "success", message: "Версия согласована." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось согласовать.";
    return { status: "invalid", message };
  }
}

export async function rejectPost(
  _prev: CollaborationFormState,
  formData: FormData,
): Promise<CollaborationFormState> {
  try {
    const postId = readField(formData, "postId");
    await collab().reject(await requireUserId(), readField(formData, "workspaceId"), postId, readField(formData, "note"));
    revalidatePath(`/app/posts/${postId}`);
    revalidatePath("/app/notifications");
    return { status: "success", message: "Версия отклонена." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отклонить.";
    return { status: "invalid", message };
  }
}

export async function addPostComment(
  _prev: CollaborationFormState,
  formData: FormData,
): Promise<CollaborationFormState> {
  try {
    const postId = readField(formData, "postId");
    await collab().addComment(await requireUserId(), readField(formData, "workspaceId"), postId, readField(formData, "body"));
    revalidatePath(`/app/posts/${postId}`);
    revalidatePath("/app/notifications");
    return { status: "success", message: "Комментарий добавлен." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось добавить комментарий.";
    return { status: "invalid", message };
  }
}

export async function acceptInvite(
  _prev: CollaborationFormState,
  formData: FormData,
): Promise<CollaborationFormState> {
  try {
    await collab().acceptInvitation(await requireUserId(), readField(formData, "token"));
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось принять приглашение.";
    return { status: "invalid", message };
  }
  revalidatePath("/app");
  revalidatePath("/app/team");
  redirect("/app");
}

export async function markNotificationsRead(formData: FormData) {
  await collab().markRead(
    await requireUserId(),
    readField(formData, "workspaceId"),
    readField(formData, "notificationId") || undefined,
  );
  revalidatePath("/app/notifications");
  revalidatePath("/app");
}

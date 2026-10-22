"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createAdminService } from "@/modules/admin/admin-service";
import { prisma } from "@/server/db/prisma";

export type AdminFormState = {
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

function readInt(formData: FormData, name: string) {
  return Number(readField(formData, name));
}

function admin() {
  return createAdminService(prisma);
}

export async function grantPlatformAdmin(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await admin().grantAdmin(await requireUserId(), readField(formData, "email"), readField(formData, "role"));
    revalidatePath("/admin/users");
    revalidatePath("/admin/audit");
    return { status: "success", message: "Роль администратора платформы выдана. Действие записано в audit." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось выдать роль.";
    return { status: "invalid", message };
  }
}

export async function revokePlatformAdmin(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await admin().revokeAdmin(await requireUserId(), readField(formData, "userId"));
    revalidatePath("/admin/users");
    revalidatePath("/admin/audit");
    return { status: "success", message: "Роль администратора снята. Действие записано в audit." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось снять роль.";
    return { status: "invalid", message };
  }
}

export async function updatePlanLimits(
  _prev: AdminFormState,
  formData: FormData,
): Promise<AdminFormState> {
  try {
    await admin().updatePlanLimits(await requireUserId(), readField(formData, "slug"), {
      aiGenerations: readInt(formData, "aiGenerations"),
      projects: readInt(formData, "projects"),
      socialAccounts: readInt(formData, "socialAccounts"),
      members: readInt(formData, "members"),
      postsPerMonth: readInt(formData, "postsPerMonth"),
    });
    revalidatePath("/admin/plans");
    revalidatePath("/admin/audit");
    return { status: "success", message: "Лимиты тарифа обновлены. Действие записано в audit." };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось обновить тариф.";
    return { status: "invalid", message };
  }
}

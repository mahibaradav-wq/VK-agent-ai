"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { clearAiBalanceCache, createAiBalanceService } from "@/modules/ai/balance-service";
import { prisma } from "@/server/db/prisma";

export type BalanceFormState = {
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

export async function refreshAiBalance(_prev: BalanceFormState, formData: FormData): Promise<BalanceFormState> {
  try {
    const workspaceId = readField(formData, "workspaceId");
    clearAiBalanceCache(workspaceId);
    const balance = await createAiBalanceService(prisma).read(await requireUserId(), workspaceId, { refresh: true });
    revalidatePath("/app");
    revalidatePath("/app/balance");
    return { status: "success", message: balance.message };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось обновить остаток.";
    return { status: "invalid", message };
  }
}

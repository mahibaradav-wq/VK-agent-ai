"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createBillingService } from "@/modules/billing/billing-service";
import { prisma } from "@/server/db/prisma";

export type BillingFormState = {
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

function billing() {
  return createBillingService(prisma);
}

export async function startPlanCheckout(
  _prev: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  try {
    const result = await billing().startCheckout(
      await requireUserId(),
      readField(formData, "workspaceId"),
      readField(formData, "planSlug"),
    );
    redirect(result.checkoutUrl);
  } catch (error) {
    if (error instanceof AccessError) {
      return { status: "invalid", message: error.message };
    }
    throw error;
  }
}

export async function cancelSubscription(
  _prev: BillingFormState,
  formData: FormData,
): Promise<BillingFormState> {
  try {
    await billing().cancel(await requireUserId(), readField(formData, "workspaceId"));
    revalidatePath("/app/subscription");
    return {
      status: "success",
      message: "Подписка будет отменена в конце оплаченного периода. До этой даты доступ сохраняется.",
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отменить подписку.";
    return { status: "invalid", message };
  }
}

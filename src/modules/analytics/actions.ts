"use server";

import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createAnalyticsService } from "@/modules/analytics/analytics-service";
import { prisma } from "@/server/db/prisma";

export type CollectAnalyticsState = {
  status: "idle" | "invalid" | "success";
  message: string;
  collected?: number;
  skipped?: number;
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

export async function collectAnalytics(
  _prev: CollectAnalyticsState,
  formData: FormData,
): Promise<CollectAnalyticsState> {
  try {
    const result = await createAnalyticsService(prisma).collect(
      await requireUserId(),
      readField(formData, "workspaceId"),
      { socialAccountId: readField(formData, "socialAccountId") || undefined },
    );
    revalidatePath("/app/analytics");
    if (result.collected.length === 0) {
      const reasons = result.skipped.map((item) => item.reason).join(" ");
      return {
        status: "invalid",
        message: reasons || "Снимки не созданы: нет подключённых аккаунтов с официальным API.",
        collected: 0,
        skipped: result.skipped.length,
      };
    }
    return {
      status: "success",
      message: `Собрано снимков: ${result.collected.length}. Пропущено: ${result.skipped.length}. Недоступные метрики записаны как пустые, не как ноль.`,
      collected: result.collected.length,
      skipped: result.skipped.length,
    };
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось собрать аналитику.";
    return { status: "invalid", message };
  }
}

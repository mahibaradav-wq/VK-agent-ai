import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createAiConnectionService } from "@/modules/ai/provider-service";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";

function readField(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ status: "invalid", message: "Нужна авторизация." }, { status: 401 });
  }
  try {
    const formData = await request.formData();
    const provider = readField(formData, "provider");
    await createAiConnectionService(prisma).disconnect(session.user.id, readField(formData, "workspaceId"), provider || undefined);
    revalidatePath("/app/ai");
    return Response.json({
      status: "success",
      message: provider ? `${provider} отключён.` : "AI-провайдер отключён. Генерация больше не имитируется.",
    });
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отключить AI.";
    const status = error instanceof AccessError ? error.status : 400;
    return Response.json({ status: "invalid", message }, { status });
  }
}

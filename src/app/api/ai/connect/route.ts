import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createAiConnectionService } from "@/modules/ai/provider-service";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";
export const maxDuration = 30;

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
    const connection = await createAiConnectionService(prisma).connect(session.user.id, readField(formData, "workspaceId"), {
      provider: readField(formData, "provider"),
      apiKey: readField(formData, "apiKey"),
    });
    revalidatePath("/app/ai");
    return Response.json({
      status: "success",
      message: `${connection.label} подключён. Ключ зашифрован на сервере и во frontend не возвращается.`,
      provider: connection.provider,
    });
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось подключить AI.";
    const status = error instanceof AccessError ? error.status : 400;
    return Response.json({ status: "invalid", message }, { status });
  }
}

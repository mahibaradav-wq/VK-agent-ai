import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createWatchService } from "@/modules/watch/watch-service";
import { prisma } from "@/server/db/prisma";

export const runtime = "nodejs";
export const maxDuration = 120;

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
    const result = await createWatchService(prisma).collectIdeas(session.user.id, readField(formData, "workspaceId"), {
      brief: readField(formData, "brief"),
      projectId: readField(formData, "projectId") || undefined,
    });
    revalidatePath("/app/watch");
    revalidatePath("/app/ai");
    return Response.json({
      status: "success",
      message: `Прочитано постов: ${result.posts.length}. Идей: ${result.request.items.length}. Это не публикация во ВК.`,
    });
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось собрать идеи.";
    const status = error instanceof AccessError ? error.status : 400;
    return Response.json({ status: "invalid", message }, { status });
  }
}

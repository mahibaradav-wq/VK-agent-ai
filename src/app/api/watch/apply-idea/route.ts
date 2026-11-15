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
    console.info("watch.apply-idea", {
      userId: session.user.id,
      requestId: readField(formData, "requestId"),
      itemIndex: readField(formData, "itemIndex"),
    });
    const post = await createWatchService(prisma).applyIdea(
      session.user.id,
      readField(formData, "workspaceId"),
      readField(formData, "requestId"),
      Number(readField(formData, "itemIndex")),
      readField(formData, "projectId"),
    );
    revalidatePath("/app/watch");
    revalidatePath("/app/ai");
    revalidatePath("/app/posts");
    revalidatePath(`/app/posts/${post.id}`);
    return Response.json({
      status: "success",
      message: "Агент написал пост и нарисовал новый визуал. Картинка от другого поста не подставляется.",
      postId: post.id,
    });
  } catch (error) {
    const message = error instanceof AccessError ? error.message : "Не удалось отправить идею в агент AI.";
    const status = error instanceof AccessError ? error.status : 400;
    console.error("watch.apply-idea failed", status, message);
    return Response.json({ status: "invalid", message }, { status });
  }
}

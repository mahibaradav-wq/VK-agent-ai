import { auth } from "@/auth";
import { createMediaService } from "@/modules/media/media-service";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Нужна авторизация.", { status: 401 });
  }

  const { id } = await context.params;
  let media: Awaited<ReturnType<typeof prisma.mediaAsset.findUnique>>;
  try {
    media = await prisma.mediaAsset.findUnique({ where: { id } });
  } catch {
    return new Response("База данных временно недоступна.", { status: 503 });
  }
  if (!media) {
    return new Response("Медиафайл не найден.", { status: 404 });
  }

  try {
    const file = await createMediaService(prisma, storage).readFile(session.user.id, media.workspaceId, media.id);
    const download = new URL(request.url).searchParams.get("download") === "1";
    const filename = encodeURIComponent(file.media.originalName);
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": file.media.mimeType,
        "Content-Length": String(file.media.sizeBytes),
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    // Always 404 for missing or unauthorized media — do not leak existence via 403.
    return new Response("Медиафайл не найден.", { status: 404 });
  }
}

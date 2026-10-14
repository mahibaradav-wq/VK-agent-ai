import { auth } from "@/auth";
import { AccessError } from "@/modules/access/permissions";
import { createMediaService } from "@/modules/media/media-service";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Нужна авторизация.", { status: 401 });
  }

  const { id } = await context.params;
  const media = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!media) {
    return new Response("Медиафайл не найден.", { status: 404 });
  }

  try {
    const file = await createMediaService(prisma, storage).readFile(session.user.id, media.workspaceId, media.id);
    return new Response(Buffer.from(file.bytes), {
      headers: {
        "Content-Type": file.media.mimeType,
        "Content-Length": String(file.media.sizeBytes),
        "Content-Disposition": `inline; filename="${encodeURIComponent(file.media.originalName)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    const status = error instanceof AccessError ? error.status : 404;
    return new Response("Медиафайл не найден.", { status });
  }
}

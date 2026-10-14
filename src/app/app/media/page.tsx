import { auth } from "@/auth";
import { MediaUploadForm } from "@/components/app/media-upload-form";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createMediaService } from "@/modules/media/media-service";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";

export const metadata = createPageMetadata({
  title: "Медиатека",
  description: "Файлы текущего рабочего пространства.",
  path: "/app/media",
});

export default async function MediaPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const media = createMediaService(prisma, storage);
  const assets = await media.list(session.user.id, activeMembership.workspaceId);
  const status = media.storageStatus();

  return (
    <>
      <PageHeader
        eyebrow="Медиатека"
        title="Файлы пространства"
        description="Файлы проверяются по MIME и сигнатуре. Чужой mediaId на сервере не откроет содержимое."
      />
      <Container className="grid gap-6 pb-20 lg:grid-cols-[1fr_0.8fr]">
        <div className="grid gap-4">
          {assets.length === 0 ? <StatusBanner tone="info">В этом пространстве ещё нет файлов.</StatusBanner> : null}
          {assets.map((asset) => (
            <Card key={asset.id}>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">{asset.mimeType}</p>
              <h2 className="mt-2 text-xl font-black text-ink">{asset.originalName}</h2>
              <p className="mt-2 text-sm text-ink/70">
                {(asset.sizeBytes / 1024).toFixed(1)} КБ · {asset.storageDriver}
              </p>
              <img src={`/api/media/${asset.id}`} alt="" className="mt-4 max-h-48 rounded-2xl object-cover" />
            </Card>
          ))}
        </div>
        <Card>
          <h2 className="text-xl font-black text-ink">Загрузка</h2>
          <p className="mt-2 text-sm text-ink/70">
            {status.driver === "s3"
              ? "Файлы уходят в S3-совместимое хранилище."
              : "Сейчас используется локальный стенд хранилища, как почтовый стенд. S3 включается переменными окружения."}
          </p>
          <div className="mt-4">
            <MediaUploadForm
              workspaceId={activeMembership.workspaceId}
              canUpload={hasPermission(activeMembership.role, "media.upload")}
              setupMessage={status.ready ? undefined : status.setupMessage}
            />
          </div>
        </Card>
      </Container>
    </>
  );
}

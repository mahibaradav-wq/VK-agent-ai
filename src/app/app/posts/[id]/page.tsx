import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { PostEditor } from "@/components/app/post-editor";
import { PublishPanel } from "@/components/app/publish-panel";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { getAppContext } from "@/modules/access/app-context";
import { AccessError, hasPermission } from "@/modules/access/permissions";
import { createMediaService } from "@/modules/media/media-service";
import { createPostService } from "@/modules/posts/post-service";
import { createPublishService } from "@/modules/publishing/publish-service";
import { prisma } from "@/server/db/prisma";
import { storage } from "@/server/storage";

const lockedStatuses = ["queued", "publishing", "published", "cancelled"];

export default async function PostEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { id } = await params;
  const { activeMembership } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  try {
    const posts = createPostService(prisma);
    const post = await posts.get(session.user.id, activeMembership.workspaceId, id);
    const version = posts.currentVersion(post);
    const media = await createMediaService(prisma, storage).list(session.user.id, activeMembership.workspaceId);
    const job = await createPublishService(prisma).getForPost(session.user.id, activeMembership.workspaceId, post.id);
    const canEdit =
      hasPermission(activeMembership.role, "post.update") && !lockedStatuses.includes(post.status);

    return (
      <>
        <PageHeader
          eyebrow="Редактор"
          title={version?.title ?? "Черновик"}
          description="Черновик версионируется. В очередь уходит текущая версия. Без официальной интеграции публикация не имитируется."
        />
        <Container className="grid gap-6 pb-20">
          <PublishPanel
            workspaceId={activeMembership.workspaceId}
            postId={post.id}
            postStatus={post.status}
            canEnqueue={hasPermission(activeMembership.role, "post.update")}
            targets={post.targets.map((target) => ({
              platform: target.platform,
              status: target.status,
              lastError: target.lastError,
            }))}
            job={
              job
                ? {
                    status: job.status,
                    attemptCount: job.attemptCount,
                    maxAttempts: job.maxAttempts,
                    lastError: job.lastError,
                    attempts: job.attempts.map((attempt) => ({
                      platform: attempt.platform,
                      kind: attempt.kind,
                      attemptNumber: attempt.attemptNumber,
                      errorCode: attempt.errorCode,
                    })),
                  }
                : null
            }
          />
          <PostEditor
            workspaceId={activeMembership.workspaceId}
            postId={post.id}
            versionNumber={version?.number ?? 1}
            title={version?.title ?? ""}
            body={version?.body ?? ""}
            platforms={post.targets.map((target) => target.platform)}
            media={media.map((item) => ({ id: item.id, originalName: item.originalName, mimeType: item.mimeType }))}
            selectedMediaIds={post.media.map((item) => item.mediaId)}
            canEdit={canEdit}
          />
        </Container>
      </>
    );
  } catch (error) {
    if (error instanceof AccessError && error.status === 404) {
      notFound();
    }
    throw error;
  }
}

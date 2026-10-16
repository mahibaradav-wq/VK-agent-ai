import { notFound } from "next/navigation";

import { auth } from "@/auth";
import { ApprovalPanel, CommentThread } from "@/components/app/collaboration-forms";
import { PostEditor } from "@/components/app/post-editor";
import { PublishPanel } from "@/components/app/publish-panel";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { getAppContext } from "@/modules/access/app-context";
import { AccessError, hasPermission } from "@/modules/access/permissions";
import { createCollaborationService } from "@/modules/collaboration/collaboration-service";
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
    const collab = createCollaborationService(prisma);
    const comments = await collab.listComments(session.user.id, activeMembership.workspaceId, post.id);
    const approvals = await collab.listApprovals(session.user.id, activeMembership.workspaceId, post.id);
    const audit = await collab.listAudit(session.user.id, activeMembership.workspaceId, post.id);
    const canEdit =
      hasPermission(activeMembership.role, "post.update") && !lockedStatuses.includes(post.status);
    const canEnqueue =
      hasPermission(activeMembership.role, "post.update") &&
      ["approved", "scheduled", "failed"].includes(post.status);

    return (
      <>
        <PageHeader
          eyebrow="Редактор"
          title={version?.title ?? "Черновик"}
          description="В очередь уходит только согласованная текущая версия. Изменение текста сбрасывает approval."
        />
        <Container className="grid gap-6 pb-20">
          <ApprovalPanel
            workspaceId={activeMembership.workspaceId}
            postId={post.id}
            postStatus={post.status}
            canSubmit={hasPermission(activeMembership.role, "post.update")}
            canApprove={hasPermission(activeMembership.role, "post.approve")}
            versionLabel={version ? `версия ${version.number}` : "нет версии"}
          />
          <PublishPanel
            workspaceId={activeMembership.workspaceId}
            postId={post.id}
            postStatus={post.status}
            canEnqueue={canEnqueue}
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
          <CommentThread
            workspaceId={activeMembership.workspaceId}
            postId={post.id}
            canComment={hasPermission(activeMembership.role, "comment.create")}
            comments={comments.map((item) => ({
              id: item.id,
              body: item.body,
              createdAt: item.createdAt.toISOString(),
              authorEmail: item.author.email,
            }))}
          />
          <Card className="grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">История согласования</p>
            {approvals.length === 0 ? <p className="text-sm text-ink/60">Решений пока нет.</p> : null}
            {approvals.map((item) => (
              <p key={item.id} className="text-sm text-ink/70">
                {item.status} · v{item.postVersion.number} · {item.actor.email} · {item.createdAt.toISOString()}
                {item.note ? ` · ${item.note}` : ""}
              </p>
            ))}
          </Card>
          <Card className="grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Audit</p>
            {audit.map((item) => (
              <p key={item.id} className="text-sm text-ink/70">
                {item.action} · {item.actor?.email ?? "система"} · {item.createdAt.toISOString()}
                {item.details ? ` · ${item.details}` : ""}
              </p>
            ))}
          </Card>
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

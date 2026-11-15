import { auth } from "@/auth";
import { WatchBoard } from "@/components/app/watch-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { createWatchService } from "@/modules/watch/watch-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Идеи по сообществам VK",
  description: "ChatGPT предлагает темы по стенам ВК. Кнопка открывает бриф агента: тон, длину и площадку выбираете сами.",
  path: "/app/watch",
});

export default async function WatchPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, activeProject } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const watch = createWatchService(prisma);
  const [credential, communities, ideas, aiStatus] = await Promise.all([
    watch.credential(session.user.id, activeMembership.workspaceId),
    watch.listCommunities(session.user.id, activeMembership.workspaceId),
    watch.listIdeas(session.user.id, activeMembership.workspaceId),
    createAiService(prisma).workspaceStatus(session.user.id, activeMembership.workspaceId),
  ]);
  const ideasProvider = aiStatus.ideasProvider;

  return (
    <>
      <PageHeader
        eyebrow="Агент"
        title="Идеи для стены ВК"
        description="ChatGPT смотрит указанные сообщества через VK API и предлагает темы. Кнопка кладёт идею в бриф агента «Пост + визуал»: вы правите тон, длину и площадку, затем создаёте пост."
      />
      <Container className="grid gap-6 pb-20">
        <WatchBoard
          workspaceId={activeMembership.workspaceId}
          projectId={activeProject?.id}
          canConnect={hasPermission(activeMembership.role, "social.connect")}
          canGenerate={hasPermission(activeMembership.role, "ai.generate")}
          canApply={hasPermission(activeMembership.role, "post.create")}
          credential={credential}
          aiProvider={ideasProvider}
          copyReady={aiStatus.copyReady}
          imageReady={aiStatus.imageReady && aiStatus.storageReady}
          communities={communities.map((item) => ({
            ...item,
            lastFetchedAt: item.lastFetchedAt?.toISOString() ?? null,
          }))}
          ideas={ideas.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
          }))}
        />
      </Container>
    </>
  );
}

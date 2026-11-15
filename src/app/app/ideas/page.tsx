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
  title: "Идеи",
  description: "Темы по стенам сообществ этого проекта. Клик забирает идею в Студию.",
  path: "/app/ideas",
});

export default async function IdeasPage() {
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

  return (
    <>
      <PageHeader
        eyebrow="Идеи"
        title="Темы для этого клуба"
        description="ChatGPT читает ваши сообщества. Ключ чтения стен — в Подключениях. Клик по теме открывает Студию."
      />
      <Container className="grid gap-6 pb-20">
        <WatchBoard
          workspaceId={activeMembership.workspaceId}
          projectId={activeProject?.id}
          canConnect={hasPermission(activeMembership.role, "social.connect")}
          canGenerate={hasPermission(activeMembership.role, "ai.generate")}
          canApply={hasPermission(activeMembership.role, "post.create")}
          credential={credential}
          aiProvider={aiStatus.ideasProvider}
          copyReady={aiStatus.copyReady}
          imageReady={aiStatus.imageReady && aiStatus.storageReady}
          communities={communities.map((item) => ({
            ...item,
            lastFetchedAt: item.lastFetchedAt?.toISOString() ?? null,
          }))}
          ideas={ideas.slice(0, 1).map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
          }))}
        />
      </Container>
    </>
  );
}

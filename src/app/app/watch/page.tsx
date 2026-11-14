import { auth } from "@/auth";
import { WatchBoard } from "@/components/app/watch-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createWatchService } from "@/modules/watch/watch-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Идеи по сообществам VK",
  description: "Агент читает стены ВКонтакте через официальный API и предлагает темы постов. Публикация во ВК не включается.",
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
  const [credential, communities, ideas] = await Promise.all([
    watch.credential(session.user.id, activeMembership.workspaceId),
    watch.listCommunities(session.user.id, activeMembership.workspaceId),
    watch.listIdeas(session.user.id, activeMembership.workspaceId),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Агент"
        title="Идеи по сообществам VK"
        description="Смотрит указанные сообщества через VK API и предлагает свои темы. Чужие посты не копируются, во ВК ничего не публикуется."
      />
      <Container className="grid gap-6 pb-20">
        <WatchBoard
          workspaceId={activeMembership.workspaceId}
          projectId={activeProject?.id}
          canConnect={hasPermission(activeMembership.role, "social.connect")}
          canGenerate={hasPermission(activeMembership.role, "ai.generate")}
          canApply={hasPermission(activeMembership.role, "post.create")}
          credential={credential}
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

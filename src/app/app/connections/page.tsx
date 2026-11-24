import { auth } from "@/auth";
import { AiProviderBoard } from "@/components/app/ai-provider-board";
import { ShopPartnersBoard } from "@/components/app/shop-partners-board";
import { SocialAccountsBoard } from "@/components/app/social-accounts-board";
import { VkWatchKeyCard } from "@/components/app/vk-watch-key-card";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { createProductService } from "@/modules/products/product-service";
import { createSocialService } from "@/modules/social/social-service";
import { createWatchService } from "@/modules/watch/watch-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Подключения",
  description: "Ключи этого клуба и общий ChatGPT. Пароль соцсети не принимается.",
  path: "/app/connections",
});

export default async function ConnectionsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, activeProject } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const ai = createAiService(prisma);
  const status = await ai.workspaceStatus(session.user.id, activeMembership.workspaceId);
  const accounts = await createSocialService(prisma).list(session.user.id, activeMembership.workspaceId);
  const watch = await createWatchService(prisma).credential(session.user.id, activeMembership.workspaceId);
  const partners = activeProject
    ? await createProductService(prisma).listPartners(session.user.id, activeMembership.workspaceId, activeProject.id)
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Подключения"
        title={activeProject?.name ?? "Нет проекта"}
        description="ChatGPT один на все клубы. Стена ВК, бот Telegram, чтение стен и партнёрки магазинов — у этого проекта."
      />
      <Container className="grid gap-6 pb-20">
        <AiProviderBoard
          workspaceId={activeMembership.workspaceId}
          canConnect={hasPermission(activeMembership.role, "ai.connect")}
          connections={status.connections}
          ideas={status.roles.ideas}
          copy={status.roles.copy}
          image={status.roles.image}
        />
        <VkWatchKeyCard
          workspaceId={activeMembership.workspaceId}
          canConnect={hasPermission(activeMembership.role, "social.connect")}
          credential={watch}
        />
        {activeProject ? (
          <ShopPartnersBoard
            workspaceId={activeMembership.workspaceId}
            projectId={activeProject.id}
            canConnect={hasPermission(activeMembership.role, "social.connect")}
            partners={partners}
          />
        ) : (
          <StatusBanner tone="warning">Выберите проект, чтобы подключить магазины.</StatusBanner>
        )}
        {accounts.some((account) => !account.projectId) ? (
          <StatusBanner tone="warning">
            Есть токен без проекта. Он хранится, но публикация не берёт его автоматически — подключите ВК и Telegram у
            конкретного клуба.
          </StatusBanner>
        ) : null}
        <SocialAccountsBoard
          workspaceId={activeMembership.workspaceId}
          projectId={activeProject?.id}
          canConnect={hasPermission(activeMembership.role, "social.connect")}
          accounts={accounts
            .filter((account) => Boolean(activeProject && account.projectId === activeProject.id))
            .map((account) => ({
              id: account.id,
              platform: account.platform,
              displayName: account.displayName,
              externalId: account.externalId,
              status: account.status,
              lastError: account.lastError,
              hasToken: account.hasToken,
              projectName: account.projectName,
              capabilities: account.capabilities,
            }))}
        />
      </Container>
    </>
  );
}

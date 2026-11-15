import { auth } from "@/auth";
import { SocialAccountsBoard } from "@/components/app/social-accounts-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createSocialService } from "@/modules/social/social-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Социальные аккаунты",
  description: "Telegram-канал t.me/dom_po_polochkam через бота. ВКонтакте — ключ сообщества. Пароль соцсети не запрашивается.",
  path: "/app/social-accounts",
});

export default async function SocialAccountsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, activeProject } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const accounts = await createSocialService(prisma).list(session.user.id, activeMembership.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="Интеграции"
        title="Социальные аккаунты"
        description="Канал t.me/dom_po_polochkam публикует бот @dom_po_polochkam_bot, уже администратор. ВКонтакте — ключ сообщества со «Стеной». Без ключа успех не имитируется."
      />
      <Container className="pb-20">
        <SocialAccountsBoard
          workspaceId={activeMembership.workspaceId}
          projectId={activeProject?.id}
          canConnect={hasPermission(activeMembership.role, "social.connect")}
          accounts={accounts.map((account) => ({
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

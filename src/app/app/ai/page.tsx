import { auth } from "@/auth";
import { AiStudio } from "@/components/app/ai-studio";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "AI-ассистент",
  description: "Агент пишет пост и визуал, либо отдельно генерирует идеи и тексты. Ключ провайдера только на сервере.",
  path: "/app/ai",
});

export default async function AiPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, activeProject } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const ai = createAiService(prisma);
  const status = ai.status();
  const usage = await ai.usage(session.user.id, activeMembership.workspaceId);
  const history = await ai.list(session.user.id, activeMembership.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="AI"
        title="Ассистент контента"
        description="Агент создаёт пост с визуалом в активный проект. Отдельно можно сгенерировать только текст. Без ключа провайдера генерация не имитируется."
      />
      <Container className="pb-20">
        <AiStudio
          workspaceId={activeMembership.workspaceId}
          projectId={activeProject?.id}
          canGenerate={hasPermission(activeMembership.role, "ai.generate")}
          canApply={hasPermission(activeMembership.role, "post.create")}
          ready={status.ready}
          imageReady={status.imageReady}
          storageReady={status.storageReady}
          provider={status.provider}
          model={status.model}
          imageModel={status.imageModel}
          used={usage.used}
          limit={usage.limit}
          history={history.map((item) => ({
            ...item,
            createdAt: item.createdAt.toISOString(),
          }))}
        />
      </Container>
    </>
  );
}

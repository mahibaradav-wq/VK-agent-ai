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
  title: "Студия",
  description: "Одна карточка: бриф, текст и визуал 4:5, затем публикация сейчас или в календарь.",
  path: "/app/studio",
});

export default async function StudioPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; platform?: string; shopProductId?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }
  const params = await searchParams;

  const { activeMembership, activeProject } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const ai = createAiService(prisma);
  const status = await ai.workspaceStatus(session.user.id, activeMembership.workspaceId);
  const usage = await ai.usage(session.user.id, activeMembership.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="Студия"
        title="Пост + визуал"
        description="Бриф из идеи, товара или свой. ChatGPT пишет голосом проекта. Ключ — в Подключениях."
      />
      <Container className="grid gap-6 pb-20">
        <AiStudio
          workspaceId={activeMembership.workspaceId}
          projectId={activeProject?.id}
          canGenerate={hasPermission(activeMembership.role, "ai.generate")}
          ready={status.ready}
          imageReady={status.imageReady}
          storageReady={status.storageReady}
          provider={status.provider}
          model={status.model}
          imageModel={status.imageModel}
          used={usage.used}
          limit={usage.limit}
          defaultPrompt={typeof params.prompt === "string" ? params.prompt : ""}
          defaultPlatform={
            params.platform === "vk" || params.platform === "telegram"
              ? params.platform
              : params.prompt
                ? "vk"
                : "telegram"
          }
          shopProductId={typeof params.shopProductId === "string" ? params.shopProductId : ""}
        />
      </Container>
    </>
  );
}

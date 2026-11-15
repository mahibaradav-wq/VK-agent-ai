import { auth } from "@/auth";
import { AiProviderBoard } from "@/components/app/ai-provider-board";
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
  description: "DeepSeek ищет идеи по стенам ВК. Qwen пишет визуал с российского VPS. Ключи только на сервере.",
  path: "/app/ai",
});

export default async function AiPage({
  searchParams,
}: {
  searchParams: Promise<{ prompt?: string; platform?: string }>;
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
  const history = await ai.list(session.user.id, activeMembership.workspaceId);

  return (
    <>
      <PageHeader
        eyebrow="AI"
        title="Ассистент контента"
        description="DeepSeek — идеи. Qwen — тексты и визуал с этого VPS в РФ. Ключ Qwen берите в 百炼, регион Пекин. Без ключа генерация не имитируется."
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
          defaultPrompt={typeof params.prompt === "string" ? params.prompt : ""}
          defaultPlatform={
            params.platform === "vk" || params.platform === "telegram"
              ? params.platform
              : params.prompt
                ? "vk"
                : "telegram"
          }
        />
      </Container>
    </>
  );
}

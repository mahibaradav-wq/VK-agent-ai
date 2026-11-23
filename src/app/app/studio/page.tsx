import { DateTime } from "luxon";
import { cookies } from "next/headers";

import { auth } from "@/auth";
import { AiStudio } from "@/components/app/ai-studio";
import { StudioWorkingCard } from "@/components/app/studio-working-card";
import { PageHeader } from "@/components/marketing/page-header";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { displayTimezones, parseTimezone, TIMEZONE_COOKIE } from "@/modules/calendar/timezone";
import { createPostService } from "@/modules/posts/post-service";
import { parseVariants } from "@/modules/posts/variants";
import { prisma } from "@/server/db/prisma";
import { isVkManualPhoto } from "@/modules/social/vk-manual";
import { vkWallCopy } from "@/modules/social/vk-wall-text";

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
  const posts = createPostService(prisma);
  if (activeProject && hasPermission(activeMembership.role, "post.update")) {
    await posts.collapseStudioPile(session.user.id, activeMembership.workspaceId, activeProject.id);
  }
  const [status, usage, studioPosts, vkAccount] = await Promise.all([
    ai.workspaceStatus(session.user.id, activeMembership.workspaceId),
    ai.usage(session.user.id, activeMembership.workspaceId),
    posts.listStudioCards(session.user.id, activeMembership.workspaceId, activeProject?.id),
    prisma.socialAccount.findFirst({
      where: {
        workspaceId: activeMembership.workspaceId,
        platform: "vk",
        status: "connected",
        ...(activeProject ? { OR: [{ projectId: activeProject.id }, { projectId: null }] } : {}),
      },
      include: { capabilities: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const vkCarouselReady = Boolean(
    vkAccount?.capabilities.some((item) => item.name === "publish_carousel" && item.enabled),
  );
  const timezone = parseTimezone((await cookies()).get(TIMEZONE_COOKIE)?.value);
  const timezoneLabel = displayTimezones.find((item) => item.id === timezone)?.label ?? timezone;
  const defaultSlot = DateTime.now().setZone(timezone).plus({ hours: 1 }).toFormat("yyyy-MM-dd'T'HH:mm");
  const canPublishNow =
    hasPermission(activeMembership.role, "post.approve") && hasPermission(activeMembership.role, "post.update");
  const canSchedule = hasPermission(activeMembership.role, "post.update");
  const canEdit = hasPermission(activeMembership.role, "post.update");

  return (
    <>
      <PageHeader
        eyebrow="Студия"
        title="Пост + визуал"
        description="Бриф из идеи, товара или свой. Две сети — два текста: Telegram и ВКонтакте. Ключ — в Подключениях."
      />
      <Container className="grid gap-6 pb-20">
        {studioPosts.length ? (
          <>
            <StatusBanner tone="warning">
              Здесь лежит неопубликованный пост. Уберите его или поставьте в календарь — тогда можно взять новую идею.
            </StatusBanner>
            {studioPosts.map((post) => {
              const version = posts.currentVersion(post);
              const variants = parseVariants(version?.variantsJson);
              const vkCopy = variants.vk ?? { title: version?.title ?? "", body: version?.body ?? "" };
              const vkTarget = post.targets.find((target) => target.platform === "vk");
              return (
                <StudioWorkingCard
                  key={post.id}
                  workspaceId={activeMembership.workspaceId}
                  canPublishNow={canPublishNow}
                  canSchedule={canSchedule}
                  canEdit={canEdit}
                  vkCarouselReady={vkCarouselReady}
                  defaultSlot={defaultSlot}
                  timezone={timezone}
                  timezoneLabel={timezoneLabel}
                  card={{
                    id: post.id,
                    title: version?.title ?? "Черновик",
                    body: version?.body ?? "",
                    status: post.status,
                    lastError: post.targets.find((target) => target.lastError)?.lastError ?? "",
                    platforms: post.targets.map((target) => target.platform),
                    mediaIds: post.media.map((item) => item.mediaId),
                    mediaTypes: post.media.map((item) => item.media.mimeType),
                    variants,
                    vkManual: Boolean(
                      vkTarget &&
                        (vkTarget.status === "requires_manual_check" ||
                          isVkManualPhoto(null, vkTarget.lastError)),
                    ),
                    vkManualCopy: vkWallCopy(vkCopy.title, vkCopy.body),
                  }}
                />
              );
            })}
          </>
        ) : (
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
              params.platform === "vk" || params.platform === "telegram" ? params.platform : ""
            }
            shopProductId={typeof params.shopProductId === "string" ? params.shopProductId : ""}
          />
        )}
      </Container>
    </>
  );
}

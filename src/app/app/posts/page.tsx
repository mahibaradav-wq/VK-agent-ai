import Link from "next/link";

import { auth } from "@/auth";
import { PageHeader } from "@/components/marketing/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { utcToDisplay } from "@/modules/calendar/timezone";
import { createPost } from "@/modules/posts/actions";
import { createPostService } from "@/modules/posts/post-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Публикации",
  description: "Черновики публикаций текущего проекта.",
  path: "/app/posts",
});

export default async function PostsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const { activeMembership, activeProject } = await getAppContext(session.user.id);
  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const posts = activeProject
    ? await createPostService(prisma).list(session.user.id, activeMembership.workspaceId, activeProject.id)
    : [];
  const canCreate = hasPermission(activeMembership.role, "post.create");

  return (
    <>
      <PageHeader
        eyebrow="Публикации"
        title="Черновики проекта"
        description="Содержимое версионируется. В очередь публикация попадает с текущей версией; успешные цели повторно не отправляются."
      />
      <Container className="grid gap-6 pb-20">
        {!activeProject ? (
          <StatusBanner tone="warning">Сначала создайте или выберите проект.</StatusBanner>
        ) : canCreate ? (
          <form action={createPost}>
            <input type="hidden" name="workspaceId" value={activeMembership.workspaceId} />
            <input type="hidden" name="projectId" value={activeProject.id} />
            <Button>Новый черновик</Button>
          </form>
        ) : (
          <StatusBanner tone="info">Создавать черновики могут Editor, Admin и Owner.</StatusBanner>
        )}
        {posts.length === 0 && activeProject ? <StatusBanner tone="info">В этом проекте ещё нет публикаций.</StatusBanner> : null}
        <div className="grid gap-4">
          {posts.map((post) => {
            const version = createPostService(prisma).currentVersion(post);
            return (
              <Card key={post.id}>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
                  {post.status} · v{version?.number ?? 1}
                </p>
                <h2 className="mt-2 text-xl font-black text-ink">{version?.title ?? "Без названия"}</h2>
                <p className="mt-2 text-ink/70">{version?.body || "Пустой текст"}</p>
                <p className="mt-3 text-sm text-ink/60">Цели: {post.targets.map((target) => target.platform).join(", ") || "не выбраны"}</p>
                {post.schedule ? (
                  <p className="mt-1 text-sm text-ink/60">
                    В календаре: {utcToDisplay(post.schedule.startsAt, post.schedule.timezone)} ({post.schedule.timezone})
                  </p>
                ) : null}
                <Link href={`/app/posts/${post.id}`} className="mt-3 inline-block text-sm font-semibold text-brand-dark">
                  Открыть редактор
                </Link>
              </Card>
            );
          })}
        </div>
      </Container>
    </>
  );
}

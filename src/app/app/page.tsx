import Link from "next/link";

import { auth } from "@/auth";
import { PageHeader } from "@/components/marketing/page-header";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createAiService } from "@/modules/ai/ai-service";
import { createPost } from "@/modules/posts/actions";
import { createStarterProjectIfMissing } from "@/modules/projects/project-service";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Кабинет",
  description: "Обзор рабочего пространства и следующие шаги после входа.",
  path: "/app",
});

export default async function AppHomePage() {
  const session = await auth();

  if (!session?.user?.id) {
    return null;
  }

  let { activeMembership, activeProject, projects } = await getAppContext(session.user.id);
  if (activeMembership && projects.length === 0) {
    await createStarterProjectIfMissing(prisma, activeMembership.workspaceId, session.user.id);
    ({ activeMembership, activeProject, projects } = await getAppContext(session.user.id));
  }

  const canCreatePost = activeMembership ? hasPermission(activeMembership.role, "post.create") : false;
  const [accounts, posts, ai] = activeMembership
    ? await Promise.all([
        prisma.socialAccount.count({ where: { workspaceId: activeMembership.workspaceId } }),
        activeProject
          ? prisma.post.count({ where: { workspaceId: activeMembership.workspaceId, projectId: activeProject.id } })
          : Promise.resolve(0),
        createAiService(prisma).workspaceStatus(session.user.id, activeMembership.workspaceId),
      ])
    : [0, 0, null];

  const steps = [
    {
      done: true,
      title: "Вход выполнен",
      detail: session.user.email ?? "Email подтверждён",
    },
    {
      done: projects.length > 0,
      title: "Проект готов",
      detail: activeProject ? activeProject.name : "Создайте проект, чтобы писать черновики.",
    },
    {
      done: posts > 0,
      title: "Первый черновик",
      detail: posts > 0 ? `В проекте ${posts} публикаций.` : "Напишите пост вручную или через AI.",
    },
    {
      done: accounts > 0,
      title: "Соцсеть",
      detail:
        accounts > 0
          ? `Подключено аккаунтов: ${accounts}.`
          : "Telegram Bot API — без токена публикация не имитируется. VK пока не подключается.",
    },
    {
      done: Boolean(ai?.ready),
      title: "AI-ассистент",
      detail: ai?.ready
        ? `Провайдер ${ai.provider}, модель ${ai.model}.`
        : "Ключ ChatGPT, DeepSeek или Qwen хранится на сервере. Без ключа генерация не имитируется.",
    },
  ];
  const nextStep = steps.find((step) => !step.done);

  return (
    <>
      <PageHeader
        eyebrow="Обзор"
        title={activeMembership?.workspace.name ?? "Нет рабочего пространства"}
        description="Дальше — черновик, Telegram и AI. Оплата пока не нужна."
      />
      <Container className="grid gap-5 pb-20">
        <StatusBanner tone="info">
          {session.user.email} · роль {activeMembership?.role ?? "нет"} · проектов {projects.length}
        </StatusBanner>
        {nextStep ? (
          <StatusBanner tone="warning">Следующий шаг: {nextStep.title}. {nextStep.detail}</StatusBanner>
        ) : (
          <StatusBanner tone="success">Базовая настройка есть. Можно вести календарь и очередь.</StatusBanner>
        )}
        <Card>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Первые шаги</p>
          <ol className="mt-4 grid gap-3">
            {steps.map((step) => (
              <li key={step.title} className="flex gap-3">
                <span
                  className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                    step.done ? "bg-success/15 text-success" : "bg-ink/5 text-ink/50"
                  }`}
                >
                  {step.done ? "✓" : ""}
                </span>
                <div>
                  <p className="font-semibold text-ink">{step.title}</p>
                  <p className="mt-1 text-sm text-ink/70">{step.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        {activeProject ? (
          <Card>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Активный проект</p>
            <h2 className="mt-2 text-2xl font-black text-ink">{activeProject.name}</h2>
            <p className="mt-2 text-ink/70">{activeProject.description || "Описание не задано"}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              {canCreatePost && activeMembership ? (
                <form action={createPost}>
                  <input type="hidden" name="workspaceId" value={activeMembership.workspaceId} />
                  <input type="hidden" name="projectId" value={activeProject.id} />
                  <input type="hidden" name="title" value="Новый черновик" />
                  <Button>Новый черновик</Button>
                </form>
              ) : null}
              <ButtonLink href="/app/ai" variant="secondary">
                Написать через AI
              </ButtonLink>
              <ButtonLink href="/app/social-accounts" variant="secondary">
                Подключить Telegram
              </ButtonLink>
            </div>
            <div className="mt-5 flex flex-wrap gap-4 text-sm font-semibold">
              <Link href="/app/calendar" className="text-brand-dark">
                Календарь
              </Link>
              <Link href="/app/posts" className="text-brand-dark">
                Публикации
              </Link>
              <Link href="/app/queue" className="text-brand-dark">
                Очередь
              </Link>
              <Link href="/app/media" className="text-brand-dark">
                Медиатека
              </Link>
              <Link href="/app/analytics" className="text-brand-dark">
                Аналитика
              </Link>
              <Link href="/app/projects" className="text-brand-dark">
                Проекты
              </Link>
              <Link href="/app/subscription" className="text-brand-dark">
                Подписка
              </Link>
            </div>
          </Card>
        ) : (
          <StatusBanner tone="warning">
            {activeMembership && hasPermission(activeMembership.role, "project.create")
              ? "Создайте первый проект в разделе «Проекты»."
              : "Проектов пока нет. Создать проект может Editor, Admin или Owner."}
          </StatusBanner>
        )}
      </Container>
    </>
  );
}

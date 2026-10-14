import Link from "next/link";
import { cookies } from "next/headers";

import { auth } from "@/auth";
import { CalendarBoard } from "@/components/app/calendar-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { selectTimezone } from "@/modules/calendar/actions";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import {
  calendarViews,
  displayTimezones,
  parseAnchorDate,
  parseCalendarView,
  parseTimezone,
  TIMEZONE_COOKIE,
  toUtcRange,
} from "@/modules/calendar/timezone";
import { previewPlatforms } from "@/modules/posts/platforms";
import { prisma } from "@/server/db/prisma";

export const metadata = createPageMetadata({
  title: "Календарь",
  description: "Расписание публикаций в выбранном часовом поясе. В базе хранится UTC.",
  path: "/app/calendar",
});

const viewLabels: Record<string, string> = {
  month: "Месяц",
  week: "Неделя",
  day: "День",
  list: "Список",
};

function readParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : "";
}

function hrefWith(params: Record<string, string | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `/app/calendar?${query}` : "/app/calendar";
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) {
    return null;
  }

  const params = await searchParams;
  const cookieStore = await cookies();
  const timezone = parseTimezone(cookieStore.get(TIMEZONE_COOKIE)?.value);
  const view = parseCalendarView(readParam(params.view));
  const projectId = readParam(params.projectId);
  const platform = readParam(params.platform);
  const status = readParam(params.status);
  const query = readParam(params.q);
  const anchor = parseAnchorDate(readParam(params.date), timezone);
  const range = toUtcRange(view, anchor);
  const { activeMembership, projects, activeProject } = await getAppContext(session.user.id);

  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const selectedProjectId = projectId || activeProject?.id;
  const events = await createCalendarService(prisma).list(session.user.id, activeMembership.workspaceId, {
    from: range.from,
    to: range.to,
    projectId: projectId || undefined,
    platform: platform || undefined,
    status: status || undefined,
    query: query || undefined,
    timezone,
  });

  const canCreate = hasPermission(activeMembership.role, "post.create");
  const canEdit = hasPermission(activeMembership.role, "post.update");
  const prev = (view === "day" ? anchor.minus({ days: 1 }) : view === "week" || view === "list" ? anchor.minus({ weeks: 1 }) : anchor.minus({ months: 1 })).toISODate() ?? "";
  const next = (view === "day" ? anchor.plus({ days: 1 }) : view === "week" || view === "list" ? anchor.plus({ weeks: 1 }) : anchor.plus({ months: 1 })).toISODate() ?? "";
  const currentQuery = { view, date: anchor.toISODate() ?? "", projectId, platform, status, q: query };

  return (
    <>
      <PageHeader
        eyebrow="Календарь"
        title={anchor.setLocale("ru").toFormat("LLLL yyyy")}
        description="Даты пишутся в UTC и показываются в выбранном поясе. Перенос проверяется на сервере. Соцсети на этом этапе не публикуются."
      />
      <Container className="grid gap-6 pb-20">
        <Card className="grid gap-4">
          <div className="flex flex-wrap gap-2">
            {calendarViews.map((item) => (
              <Link
                key={item}
                href={hrefWith({ ...currentQuery, view: item })}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${view === item ? "bg-ink text-white" : "bg-white ring-1 ring-ink/10"}`}
              >
                {viewLabels[item]}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={hrefWith({ ...currentQuery, date: prev })} className="text-sm font-semibold text-brand-dark">
              Назад
            </Link>
            <Link href={hrefWith({ ...currentQuery, date: next })} className="text-sm font-semibold text-brand-dark">
              Вперёд
            </Link>
            <form action={selectTimezone} className="flex items-center gap-2">
              <label className="text-sm font-medium text-ink" htmlFor="timezone">
                Пояс
              </label>
              <select
                id="timezone"
                name="timezone"
                defaultValue={timezone}
                className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3 text-sm"
              >
                {displayTimezones.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <Button type="submit" variant="secondary" className="min-h-10">
                Применить
              </Button>
            </form>
          </div>
          <form className="grid gap-3 md:grid-cols-4" action="/app/calendar" method="get">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="date" value={anchor.toISODate() ?? ""} />
            <label className="grid gap-1 text-sm font-medium text-ink">
              Проект
              <select name="projectId" defaultValue={projectId} className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3">
                <option value="">Все проекты</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">
              Платформа / аккаунт
              <select name="platform" defaultValue={platform} className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3">
                <option value="">Все</option>
                {previewPlatforms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">
              Статус
              <select name="status" defaultValue={status} className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3">
                <option value="">Все</option>
                <option value="draft">draft</option>
                <option value="scheduled">scheduled</option>
                <option value="approved">approved</option>
                <option value="pending_approval">pending_approval</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm font-medium text-ink">
              Поиск
              <input name="q" defaultValue={query} className="min-h-10 rounded-2xl border border-ink/10 bg-white px-3" />
            </label>
            <div className="md:col-span-4">
              <Button type="submit" variant="secondary">
                Фильтровать
              </Button>
            </div>
          </form>
          <p className="text-xs text-ink/60">
            Фильтр «платформа / аккаунт» пока смотрит на PostTarget. Подключение реальных соцаккаунтов будет на этапе 8.
          </p>
        </Card>
        <CalendarBoard
          view={view}
          start={range.start}
          end={range.end}
          anchor={anchor}
          events={events}
          workspaceId={activeMembership.workspaceId}
          projectId={selectedProjectId}
          timezone={timezone}
          canCreate={canCreate}
          canEdit={canEdit}
        />
      </Container>
    </>
  );
}

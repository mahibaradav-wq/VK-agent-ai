import Link from "next/link";
import { cookies } from "next/headers";

import { auth } from "@/auth";
import { CalendarBoard } from "@/components/app/calendar-board";
import { PageHeader } from "@/components/marketing/page-header";
import { Card } from "@/components/ui/card";
import { Container } from "@/components/ui/container";
import { StatusBanner } from "@/components/ui/status-banner";
import { createPageMetadata } from "@/lib/metadata";
import { getAppContext } from "@/modules/access/app-context";
import { hasPermission } from "@/modules/access/permissions";
import { createCalendarService } from "@/modules/calendar/calendar-service";
import { selectTimezone } from "@/modules/calendar/actions";
import {
  calendarViews,
  displayTimezones,
  parseAnchorDate,
  parseCalendarView,
  parseTimezone,
  TIMEZONE_COOKIE,
  toUtcRange,
} from "@/modules/calendar/timezone";
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
  const timezone = parseTimezone(cookieStore.get(TIMEZONE_COOKIE)?.value || "Europe/Moscow");
  const view = parseCalendarView(readParam(params.view) || "month");
  const anchor = parseAnchorDate(readParam(params.date), timezone);
  const range = toUtcRange(view, anchor);
  const { activeMembership, activeProject } = await getAppContext(session.user.id);

  if (!activeMembership) {
    return <StatusBanner tone="warning">Нет рабочего пространства.</StatusBanner>;
  }

  const selectedProjectId = activeProject?.id;
  const events = selectedProjectId
    ? await createCalendarService(prisma).list(session.user.id, activeMembership.workspaceId, {
        from: range.from,
        to: range.to,
        projectId: selectedProjectId,
        timezone,
      })
    : [];

  const canEdit = hasPermission(activeMembership.role, "post.update");
  const prev = (view === "day" ? anchor.minus({ days: 1 }) : view === "week" || view === "list" ? anchor.minus({ weeks: 1 }) : anchor.minus({ months: 1 })).toISODate() ?? "";
  const next = (view === "day" ? anchor.plus({ days: 1 }) : view === "week" || view === "list" ? anchor.plus({ weeks: 1 }) : anchor.plus({ months: 1 })).toISODate() ?? "";
  const currentQuery = { view, date: anchor.toISODate() ?? "" };

  return (
    <>
      <PageHeader
        eyebrow="Календарь"
        title={anchor.setLocale("ru").toFormat("LLLL yyyy")}
        description={`Время отображается в часовом поясе ${timezone}. В базе расписание хранится в UTC.`}
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
          <form action={selectTimezone} className="flex flex-wrap items-center gap-2">
            <label htmlFor="calendar-timezone" className="text-sm font-semibold text-ink">
              Часовой пояс
            </label>
            <select
              id="calendar-timezone"
              name="timezone"
              defaultValue={timezone}
              className="min-h-10 rounded-xl border border-ink/15 bg-white px-3 text-sm"
            >
              {displayTimezones.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <button type="submit" className="min-h-10 rounded-xl bg-ink px-4 text-sm font-semibold text-white">
              Применить
            </button>
          </form>
          <div className="flex flex-wrap items-center gap-3">
            <Link href={hrefWith({ ...currentQuery, date: prev })} className="text-sm font-semibold text-brand-dark">
              Назад
            </Link>
            <Link href={hrefWith({ ...currentQuery, date: next })} className="text-sm font-semibold text-brand-dark">
              Вперёд
            </Link>
          </div>
          <p className="text-sm text-ink/70">
            Запланировано: {events.filter((item) => item.status === "scheduled" || item.status === "queued").length}
            {" · "}
            Вышло: {events.filter((item) => item.status === "published").length}
            {" · "}
            Вручную ВК: {events.filter((item) => item.status === "requires_manual_check" || item.vkManual).length}
            {" · "}
            Красные: {events.filter((item) => item.status === "failed").length}
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
          canCreate={false}
          canEdit={canEdit}
        />
      </Container>
    </>
  );
}

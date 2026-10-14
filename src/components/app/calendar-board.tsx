import Link from "next/link";
import type { DateTime } from "luxon";

import { CalendarEventForm } from "@/components/app/calendar-event-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createOnDate } from "@/modules/calendar/actions";
import type { CalendarView } from "@/modules/calendar/timezone";
import { startOfWeek } from "@/modules/calendar/timezone";

export type CalendarEvent = {
  id: string;
  postId: string;
  workspaceId: string;
  localInput: string;
  viewDay: string;
  displayTime: string;
  timezone: string;
  status: string;
  title: string;
  projectName: string;
  projectColor: string;
  platforms: string[];
};

const weekdayLabels = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

function eventsForDay(events: CalendarEvent[], isoDate: string) {
  return events.filter((event) => event.viewDay === isoDate);
}

function EventCard({
  event,
  workspaceId,
  canEdit,
}: {
  event: CalendarEvent;
  workspaceId: string;
  canEdit: boolean;
}) {
  return (
    <article className="rounded-2xl bg-white p-3 ring-1 ring-ink/10">
      <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: event.projectColor }}>
        {event.status} · {event.displayTime}
      </p>
      <h3 className="mt-1 text-sm font-black text-ink">{event.title}</h3>
      <p className="text-xs text-ink/60">{event.projectName}</p>
      <p className="text-xs text-ink/50">{event.platforms.join(", ") || "без цели"}</p>
      <Link href={`/app/posts/${event.postId}`} className="mt-1 inline-block text-xs font-semibold text-brand-dark">
        Редактор
      </Link>
      <CalendarEventForm
        workspaceId={workspaceId}
        postId={event.postId}
        localDateTime={event.localInput}
        timezone={event.timezone}
        canEdit={canEdit}
      />
    </article>
  );
}

function CreateOnDate({
  workspaceId,
  projectId,
  date,
  timezone,
  canCreate,
}: {
  workspaceId: string;
  projectId?: string;
  date: string;
  timezone: string;
  canCreate: boolean;
}) {
  if (!canCreate || !projectId) {
    return null;
  }

  return (
    <form action={createOnDate}>
      <input type="hidden" name="workspaceId" value={workspaceId} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="timezone" value={timezone} />
      <input type="hidden" name="date" value={date} />
      <Button type="submit" variant="ghost" className="min-h-8 px-2 text-xs">
        + черновик
      </Button>
    </form>
  );
}

export function CalendarBoard({
  view,
  start,
  end,
  anchor,
  events,
  workspaceId,
  projectId,
  timezone,
  canCreate,
  canEdit,
}: {
  view: CalendarView;
  start: DateTime;
  end: DateTime;
  anchor: DateTime;
  events: CalendarEvent[];
  workspaceId: string;
  projectId?: string;
  timezone: string;
  canCreate: boolean;
  canEdit: boolean;
}) {
  if (view === "list") {
    return (
      <div className="grid gap-3">
        {events.length === 0 ? <Card>На этой неделе нет запланированных публикаций.</Card> : null}
        {events.map((event) => (
          <EventCard key={event.id} event={event} workspaceId={workspaceId} canEdit={canEdit} />
        ))}
      </div>
    );
  }

  if (view === "day") {
    const isoDate = start.toISODate() ?? "";
    const dayEvents = eventsForDay(events, isoDate);
    return (
      <Card>
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-ink">{start.setLocale("ru").toFormat("d MMMM yyyy")}</h2>
          <CreateOnDate workspaceId={workspaceId} projectId={projectId} date={isoDate} timezone={timezone} canCreate={canCreate} />
        </div>
        <div className="grid gap-3">
          {dayEvents.length === 0 ? <p className="text-sm text-ink/60">На этот день ничего не запланировано.</p> : null}
          {dayEvents.map((event) => (
            <EventCard key={event.id} event={event} workspaceId={workspaceId} canEdit={canEdit} />
          ))}
        </div>
      </Card>
    );
  }

  if (view === "week") {
    const days = Array.from({ length: 7 }, (_, index) => start.plus({ days: index }));
    return (
      <div className="grid gap-3 md:grid-cols-7">
        {days.map((day) => {
          const isoDate = day.toISODate() ?? "";
          return (
            <Card key={isoDate} className="p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-black text-ink">{day.setLocale("ru").toFormat("ccc d")}</p>
                <CreateOnDate workspaceId={workspaceId} projectId={projectId} date={isoDate} timezone={timezone} canCreate={canCreate} />
              </div>
              <div className="mt-3 grid gap-2">
                {eventsForDay(events, isoDate).map((event) => (
                  <EventCard key={event.id} event={event} workspaceId={workspaceId} canEdit={canEdit} />
                ))}
              </div>
            </Card>
          );
        })}
      </div>
    );
  }

  const days: DateTime[] = [];
  for (let cursor = startOfWeek(start); cursor < end; cursor = cursor.plus({ days: 1 })) {
    days.push(cursor);
  }

  return (
    <div>
      <div className="mb-2 grid grid-cols-7 gap-2 text-center text-xs font-bold uppercase tracking-[0.12em] text-ink/50">
        {weekdayLabels.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {days.map((day) => {
          const isoDate = day.toISODate() ?? "";
          const inMonth = day.month === anchor.month;
          return (
            <div
              key={isoDate}
              className={`min-h-32 rounded-2xl p-2 ring-1 ring-ink/10 ${inMonth ? "bg-white/80" : "bg-sand-50/60 text-ink/40"}`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-sm font-black">{day.day}</span>
                <CreateOnDate workspaceId={workspaceId} projectId={projectId} date={isoDate} timezone={timezone} canCreate={canCreate} />
              </div>
              <div className="mt-2 grid gap-2">
                {eventsForDay(events, isoDate).map((event) => (
                  <EventCard key={event.id} event={event} workspaceId={workspaceId} canEdit={canEdit} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

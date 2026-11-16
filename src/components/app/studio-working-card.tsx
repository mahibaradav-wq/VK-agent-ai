"use client";

import { useActionState } from "react";

import { PostPreview } from "@/components/app/post-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { reschedulePost, type CalendarFormState } from "@/modules/calendar/actions";
import { discardStudioCard } from "@/modules/posts/actions";
import { publishNowPost, type PublishFormState } from "@/modules/publishing/actions";

const calendarIdle: CalendarFormState = { status: "idle", message: "" };
const publishIdle: PublishFormState = { status: "idle", message: "" };

export type StudioCardView = {
  id: string;
  title: string;
  body: string;
  status: string;
  lastError: string;
  platforms: string[];
  mediaIds: string[];
};

export function StudioWorkingCard({
  workspaceId,
  card,
  canPublishNow,
  canSchedule,
  defaultSlot,
}: {
  workspaceId: string;
  card: StudioCardView;
  canPublishNow: boolean;
  canSchedule: boolean;
  defaultSlot: string;
}) {
  const [calendarState, calendarAction, calendarPending] = useActionState(reschedulePost, calendarIdle);
  const [publishState, publishAction, publishPending] = useActionState(publishNowPost, publishIdle);
  const message = publishState.message || calendarState.message;
  const tone = publishState.status === "invalid" || calendarState.status === "invalid" ? "warning" : "success";
  const inFlight = card.status === "queued" || card.status === "publishing";

  return (
    <Card className="grid gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Карточка в Студии</p>
        <p className="mt-1 text-sm text-ink/70">
          Этот пост ещё не опубликован и не стоит в календаре. Пока он здесь, новая идея не зайдёт.
        </p>
      </div>
      <PostPreview
        title={card.title}
        body={card.body}
        platforms={card.platforms}
        mediaUrls={card.mediaIds.map((id) => `/api/media/${id}`)}
      />
      {inFlight ? (
        <StatusBanner tone="warning">
          Пост ещё не на стене сообщества — идёт отправка в ВКонтакте.
          {card.lastError ? ` ${card.lastError}` : ""}
        </StatusBanner>
      ) : null}
      {card.status === "failed" && card.lastError ? (
        <StatusBanner tone="warning">{card.lastError}</StatusBanner>
      ) : null}
      {message ? <StatusBanner tone={tone}>{message}</StatusBanner> : null}
      {canPublishNow ? (
        <form action={publishAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={card.id} />
          <Button disabled={publishPending}>{publishPending ? "Публикуем..." : "Опубликовать сейчас"}</Button>
        </form>
      ) : null}
      {canSchedule && !inFlight ? (
        <form action={calendarAction} className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={card.id} />
          <input type="hidden" name="timezone" value="Europe/Moscow" />
          <label className="grid gap-2 text-sm font-medium text-ink">
            Время Москвы
            <input
              name="localDateTime"
              type="datetime-local"
              defaultValue={defaultSlot}
              className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4"
            />
          </label>
          <Button className="self-end" variant="secondary" disabled={calendarPending}>
            {calendarPending ? "Ставим..." : "В календарь"}
          </Button>
        </form>
      ) : null}
      <form action={discardStudioCard}>
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="postId" value={card.id} />
        <Button type="submit" variant="ghost">
          Убрать
        </Button>
      </form>
    </Card>
  );
}

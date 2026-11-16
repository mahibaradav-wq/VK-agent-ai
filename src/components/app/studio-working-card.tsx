"use client";

import { useActionState, useEffect, useState } from "react";

import { PostPreview } from "@/components/app/post-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { reviseStudioCard, type AiFormState } from "@/modules/ai/actions";
import { reschedulePost, type CalendarFormState } from "@/modules/calendar/actions";
import { discardStudioCard, savePostDraft, type PostFormState } from "@/modules/posts/actions";
import { previewPlatforms } from "@/modules/posts/platforms";
import { publishNowPost, type PublishFormState } from "@/modules/publishing/actions";

const calendarIdle: CalendarFormState = { status: "idle", message: "" };
const publishIdle: PublishFormState = { status: "idle", message: "" };
const draftIdle: PostFormState = { status: "idle", message: "" };
const reviseIdle: AiFormState = { status: "idle", message: "" };

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
  canEdit = false,
  vkCarouselReady = false,
  defaultSlot,
}: {
  workspaceId: string;
  card: StudioCardView;
  canPublishNow: boolean;
  canSchedule: boolean;
  canEdit?: boolean;
  vkCarouselReady?: boolean;
  defaultSlot: string;
}) {
  const [calendarState, calendarAction, calendarPending] = useActionState(reschedulePost, calendarIdle);
  const [publishState, publishAction, publishPending] = useActionState(publishNowPost, publishIdle);
  const [draftState, draftAction, draftPending] = useActionState(savePostDraft, draftIdle);
  const [reviseState, reviseAction, revisePending] = useActionState(reviseStudioCard, reviseIdle);
  const [title, setTitle] = useState(card.title);
  const [body, setBody] = useState(card.body);
  const [platforms, setPlatforms] = useState(card.platforms.length ? card.platforms : ["telegram", "vk"]);

  const storedPlatforms = card.platforms.join(",");
  useEffect(() => {
    setTitle(card.title);
    setBody(card.body);
    setPlatforms(storedPlatforms ? storedPlatforms.split(",") : ["telegram", "vk"]);
  }, [card.id, card.title, card.body, storedPlatforms]);
  const message = reviseState.message || draftState.message || publishState.message || calendarState.message;
  const tone =
    reviseState.status === "invalid" ||
    draftState.status === "invalid" ||
    publishState.status === "invalid" ||
    calendarState.status === "invalid"
      ? "warning"
      : "success";
  const inFlight = card.status === "queued" || card.status === "publishing";
  const locked = inFlight || !canEdit;

  function togglePlatform(id: string) {
    setPlatforms((current) => {
      if (current.includes(id)) {
        return current.length === 1 ? current : current.filter((item) => item !== id);
      }
      return [...current, id];
    });
  }

  function draftFields() {
    return (
      <>
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="postId" value={card.id} />
        <input type="hidden" name="title" value={title} />
        <input type="hidden" name="body" value={body} />
        {platforms.map((platform) => (
          <input key={platform} type="hidden" name="platform" value={platform} />
        ))}
        {card.mediaIds.map((id) => (
          <input key={id} type="hidden" name="mediaId" value={id} />
        ))}
      </>
    );
  }

  return (
    <Card className="grid gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Карточка в Студии</p>
        <p className="mt-1 text-sm text-ink/70">
          Поправьте текст, визуал и галочки сетей. Пост выйдет только в отмеченные Telegram и ВКонтакте.
        </p>
      </div>
      <PostPreview
        title={title}
        body={body}
        platforms={platforms}
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
      {platforms.includes("vk") && card.mediaIds.length > 1 && !vkCarouselReady ? (
        <StatusBanner tone="warning">
          Карусель ВК не выйдет ключом сообщества: на стене снова будет файл, а не слайды. В Подключениях добавьте
          пользовательский ключ админа клуба с правом «Фотографии», затем сохраните и опубликуйте снова.
        </StatusBanner>
      ) : null}
      {message ? <StatusBanner tone={tone}>{message}</StatusBanner> : null}

      {canEdit ? (
        <form action={draftAction} className="grid gap-4 rounded-2xl bg-sand-50 p-4 ring-1 ring-ink/10">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={card.id} />
          {platforms.map((platform) => (
            <input key={platform} type="hidden" name="platform" value={platform} />
          ))}
          {card.mediaIds.map((id) => (
            <input key={id} type="hidden" name="mediaId" value={id} />
          ))}
          <label className="grid gap-2 text-sm font-medium text-ink">
            Заголовок
            <input
              name="title"
              required
              disabled={locked}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink">
            Текст
            <textarea
              name="body"
              disabled={locked}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-48 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
            />
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium text-ink">Куда выложить</legend>
            {previewPlatforms.map((item) => (
              <label key={item.id} className="flex items-center gap-2 text-sm text-ink/80">
                <input
                  type="checkbox"
                  disabled={locked || !item.live}
                  checked={platforms.includes(item.id)}
                  onChange={() => togglePlatform(item.id)}
                />
                {item.label}
              </label>
            ))}
          </fieldset>
          <Button disabled={draftPending || locked}>{draftPending ? "Сохраняем..." : "Сохранить правки"}</Button>
        </form>
      ) : null}

      {canEdit && !inFlight ? (
        <form action={reviseAction} className="grid gap-3 rounded-2xl bg-sand-50 p-4 ring-1 ring-ink/10">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <input type="hidden" name="postId" value={card.id} />
          <label className="grid gap-2 text-sm font-medium text-ink">
            Комментарий к правке
            <textarea
              name="comment"
              required
              minLength={3}
              placeholder="Что изменить в тексте или визуале: короче, без звёздочек, другие кадры..."
              className="min-h-24 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <Button name="rewrite" value="text" disabled={revisePending} variant="secondary">
              {revisePending ? "Пишем..." : "Переписать текст"}
            </Button>
            <Button name="rewrite" value="visual" disabled={revisePending} variant="secondary">
              {revisePending ? "Рисуем..." : "Перерисовать визуал"}
            </Button>
            <Button name="rewrite" value="both" disabled={revisePending}>
              {revisePending ? "Обновляем..." : "Текст и визуал"}
            </Button>
          </div>
        </form>
      ) : null}

      {canPublishNow && !inFlight ? (
        <form action={publishAction}>
          {draftFields()}
          <Button disabled={publishPending}>{publishPending ? "Публикуем..." : "Опубликовать сейчас"}</Button>
        </form>
      ) : null}
      {canSchedule && !inFlight ? (
        <form action={calendarAction} className="grid gap-3 sm:grid-cols-[1fr_auto]">
          {draftFields()}
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

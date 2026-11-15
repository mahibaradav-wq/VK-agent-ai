"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import {
  addWatchCommunity,
  dismissWatchIdea,
  removeWatchCommunity,
  sendWatchIdeaToStudio,
  type WatchFormState,
} from "@/modules/watch/actions";

const idle: WatchFormState = { status: "idle", message: "" };

function IdeaParts({ item }: { item: string }) {
  const parts = item
    .split("||")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    return <p className="whitespace-pre-wrap text-sm text-ink">{item}</p>;
  }
  const [title, why, hook] = parts;
  return (
    <div className="grid gap-2">
      <p className="font-semibold text-ink">{title}</p>
      {why ? <p className="text-sm text-ink/70">{why}</p> : null}
      {hook ? <p className="text-sm text-ink">{hook}</p> : null}
    </div>
  );
}

export type WatchCommunityView = {
  id: string;
  source: string;
  screenName: string;
  displayName: string;
  lastFetchedAt: string | null;
  lastError: string | null;
};

export type WatchIdeaView = {
  id: string;
  title: string;
  body: string;
  items: string[];
  createdAt: string;
  provider: string;
  model: string;
};

export function WatchBoard({
  workspaceId,
  projectId,
  canConnect: _canConnect,
  canGenerate,
  canApply,
  credential,
  communities,
  ideas,
  aiProvider,
  copyReady,
  imageReady,
  studioBusy = false,
}: {
  workspaceId: string;
  projectId?: string;
  canConnect: boolean;
  canGenerate: boolean;
  canApply: boolean;
  credential: { connected: boolean; status: string; lastError: string | null };
  communities: WatchCommunityView[];
  ideas: WatchIdeaView[];
  aiProvider: string;
  copyReady: boolean;
  imageReady: boolean;
  studioBusy?: boolean;
}) {
  const router = useRouter();
  const [addState, addAction, addPending] = useActionState(addWatchCommunity, idle);
  const [removeState, removeAction, removePending] = useActionState(removeWatchCommunity, idle);
  const [collectPending, setCollectPending] = useState(false);
  const [collectState, setCollectState] = useState<WatchFormState>(idle);
  const agentReady = copyReady && imageReady;
  const message = collectState.message || addState.message || removeState.message;
  const tone =
    collectState.status === "invalid" || addState.status === "invalid" || removeState.status === "invalid"
      ? "warning"
      : collectState.status === "success"
        ? "success"
        : "info";

  async function submitCollect(formData: FormData) {
    setCollectPending(true);
    setCollectState({
      status: "idle",
      message: "Читаем стены и просим модель предложить темы. Обычно 20–60 секунд.",
    });
    try {
      const response = await fetch("/api/watch/ideas", { method: "POST", body: formData });
      const payload = (await response.json()) as WatchFormState;
      setCollectState({
        status: payload.status === "success" ? "success" : "invalid",
        message: payload.message || "Не удалось собрать идеи.",
      });
      if (payload.status === "success") {
        router.refresh();
      }
    } catch {
      setCollectState({
        status: "invalid",
        message: "Сервер не ответил. Обновите страницу и нажмите ещё раз.",
      });
    } finally {
      setCollectPending(false);
    }
  }

  return (
    <div className="grid gap-6">
      {message ? <StatusBanner tone={tone}>{message}</StatusBanner> : null}

      {ideas.length === 0 ? (
        <StatusBanner tone="info">
          Идей для стены ВК пока нет. Нажмите «Предложить идеи» — агент прочитает наблюдаемые сообщества и предложит темы
          для «Дом по полочкам». Во ВК ничего не публикуется.
        </StatusBanner>
      ) : null}

      {ideas.map((batch) => (
        <Card key={batch.id} className="grid gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Идеи для ВКонтакте</p>
          <h2 className="text-xl font-black text-ink">{batch.title}</h2>
          <p className="text-sm text-ink/60">
            {batch.provider} · {batch.model} · {new Date(batch.createdAt).toLocaleString("ru-RU")}
          </p>
          {batch.body ? <p className="whitespace-pre-wrap text-sm text-ink/80">{batch.body}</p> : null}
          {!agentReady ? (
            <StatusBanner tone="warning">
              Для новой картинки подключите ChatGPT. Кнопка на идее всё равно откроет бриф агента.
              <span className="mt-3 block">
                <ButtonLink href="/app/studio" variant="secondary">
                  Открыть Студию
                </ButtonLink>
              </span>
            </StatusBanner>
          ) : null}
          {!projectId ? (
            <StatusBanner tone="warning">
              Выберите проект в шапке кабинета — иначе агент не создаст черновик после брифа.
            </StatusBanner>
          ) : null}
          {studioBusy ? (
            <StatusBanner tone="warning">
              В Студии лежит неопубликованный пост. Откройте Студию: опубликуйте, поставьте в календарь или нажмите
              «Убрать».
            </StatusBanner>
          ) : null}
          <ul className="grid gap-3">
            {batch.items.map((item, index) => {
              const key = `${batch.id}-${index}`;
              return (
                <li key={key} className="rounded-2xl ring-1 ring-ink/10 p-4">
                  <IdeaParts item={item} />
                  {canApply || canGenerate ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {canApply && projectId && !studioBusy ? (
                        <form action={sendWatchIdeaToStudio}>
                          <input type="hidden" name="workspaceId" value={workspaceId} />
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="requestId" value={batch.id} />
                          <input type="hidden" name="itemIndex" value={String(index)} />
                          <Button>В Студию</Button>
                        </form>
                      ) : null}
                      {canGenerate ? (
                        <form action={dismissWatchIdea}>
                          <input type="hidden" name="workspaceId" value={workspaceId} />
                          <input type="hidden" name="requestId" value={batch.id} />
                          <input type="hidden" name="itemIndex" value={String(index)} />
                          <Button type="submit" variant="ghost">
                            Убрать
                          </Button>
                        </form>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-ink/60">Открыть идею в Студии могут Editor, Admin и Owner.</p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-ink/50">
            «В Студию» забирает идею в бриф и убирает её из списка. Не понравилась — «Убрать». Пост появится только после
            «Создать пост с визуалом».
          </p>
        </Card>
      ))}

      <Card className="grid gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Собрать идеи для ВК</p>
        <p className="text-sm text-ink/70">
          ChatGPT читает стены наблюдаемых сообществ и предлагает темы для «Дом по полочкам». Тем же ключом пишет пост и
          рисует визуал. Чужие тексты не копируются.
        </p>
        {aiProvider !== "openai" ? (
          <StatusBanner tone="warning">
            Для идей нужен ChatGPT. Ключ задаётся в «Подключениях».
            <span className="mt-3 block">
              <ButtonLink href="/app/connections" variant="secondary">
                Подключения
              </ButtonLink>
            </span>
          </StatusBanner>
        ) : null}
        {collectState.message ? <StatusBanner tone={collectState.status === "invalid" ? "warning" : collectPending ? "info" : "success"}>{collectState.message}</StatusBanner> : null}
        {canGenerate ? (
          <form action={submitCollect} className="grid gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
            <Button disabled={collectPending}>{collectPending ? "Читаем стены..." : "Предложить идеи"}</Button>
          </form>
        ) : (
          <StatusBanner tone="info">Собирать идеи могут Editor, Admin и Owner.</StatusBanner>
        )}
      </Card>

      <Card className="grid gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Сообщества</p>
        {communities.length === 0 ? (
          <p className="text-sm text-ink/60">Пока пусто. Добавьте vk.com/club… или короткое имя. Можно наблюдать до 25 сообществ.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {communities.map((community) => (
              <li key={community.id} className="flex items-start justify-between gap-3 rounded-2xl bg-sand-50 px-4 py-3">
                <div>
                  <p className="font-semibold text-ink">{community.displayName}</p>
                  <p className="text-xs text-ink/60">{community.screenName}</p>
                  {community.lastError ? <p className="mt-1 text-xs text-ink/60">{community.lastError}</p> : null}
                </div>
                {canGenerate ? (
                  <form action={removeAction}>
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="communityId" value={community.id} />
                    <Button type="submit" variant="ghost" disabled={removePending}>
                      Убрать
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {canGenerate ? (
          <form action={addAction} className="grid gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <label className="grid gap-2 text-sm font-medium text-ink">
              Ссылка или имя
              <input
                name="source"
                placeholder="https://vk.com/club123 или short_name"
                className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
              />
            </label>
            <Button disabled={addPending} variant="secondary">
              {addPending ? "Добавляем..." : "Добавить сообщество"}
            </Button>
          </form>
        ) : null}
      </Card>

      {credential.connected ? null : (
        <StatusBanner tone="warning">Ключ чтения стен VK задаётся в «Подключениях». Без него стены не прочитаются.</StatusBanner>
      )}
    </div>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";

import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import {
  addWatchCommunity,
  applyWatchIdea,
  connectVkWatch,
  disconnectVkWatch,
  removeWatchCommunity,
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
  canConnect,
  canGenerate,
  canApply,
  credential,
  communities,
  ideas,
  aiProvider,
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
}) {
  const router = useRouter();
  const [tokenState, tokenAction, tokenPending] = useActionState(connectVkWatch, idle);
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectVkWatch, idle);
  const [addState, addAction, addPending] = useActionState(addWatchCommunity, idle);
  const [removeState, removeAction, removePending] = useActionState(removeWatchCommunity, idle);
  const [collectPending, setCollectPending] = useState(false);
  const [collectState, setCollectState] = useState<WatchFormState>(idle);
  const message =
    collectState.message || addState.message || tokenState.message || disconnectState.message || removeState.message;
  const tone =
    collectState.status === "invalid" ||
    addState.status === "invalid" ||
    tokenState.status === "invalid" ||
    disconnectState.status === "invalid" ||
    removeState.status === "invalid"
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
          <ul className="grid gap-3">
            {batch.items.map((item, index) => (
              <li key={`${batch.id}-${index}`} className="rounded-2xl ring-1 ring-ink/10 p-4">
                <IdeaParts item={item} />
                {canApply && projectId ? (
                  <form action={applyWatchIdea} className="mt-3">
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="requestId" value={batch.id} />
                    <input type="hidden" name="itemIndex" value={String(index)} />
                    <Button type="submit" variant="secondary">
                      В черновик ВК
                    </Button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink/50">
            Черновик можно опубликовать на стену ВК, если на странице аккаунтов сохранён ключ сообщества с правом
            «Стена». Сервисный ключ чтения для этого не подходит.
          </p>
        </Card>
      ))}

      <Card className="grid gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Собрать идеи для ВК</p>
        <p className="text-sm text-ink/70">
          Агент читает стены наблюдаемых сообществ и предлагает темы для стены «Дом по полочкам». Чужие тексты не
          копируются, во ВК ничего не публикуется.
        </p>
        {aiProvider === "openai" ? (
          <StatusBanner tone="warning">
            ChatGPT с этого сервера OpenAI не обслуживает (регион VPS). Ключ сохранён, но идеи через него не придут.
            Подключите DeepSeek в разделе AI — он открывается напрямую.
            <span className="mt-3 block">
              <ButtonLink href="/app/ai" variant="secondary">
                Подключить DeepSeek
              </ButtonLink>
            </span>
          </StatusBanner>
        ) : null}
        {collectState.message ? <StatusBanner tone={collectState.status === "invalid" ? "warning" : collectPending ? "info" : "success"}>{collectState.message}</StatusBanner> : null}
        {canGenerate ? (
          <form action={submitCollect} className="grid gap-3">
            <input type="hidden" name="workspaceId" value={workspaceId} />
            {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
            <label className="grid gap-2 text-sm font-medium text-ink">
              Бриф бренда
              <textarea
                name="brief"
                placeholder="Дом по полочкам: организация хранения, кухня, прихожая, без воды и без обещаний скидок."
                className="min-h-28 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
              />
            </label>
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

      <Card className="grid gap-3">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Ключ VK для чтения</p>
        <p className="text-sm text-ink/70">
          Сервисный ключ доступа из карточки приложения VK ID (не защищённый ключ и не код виджета входа). Пароль
          аккаунта не принимается. Этот ключ только читает стены; публиковать во ВК он не умеет.
        </p>
        <p className="text-sm text-ink/70">
          Статус: {credential.connected ? "ключ сохранён (зашифрован)" : "не подключён"}
          {credential.lastError ? ` · ${credential.lastError}` : ""}
        </p>
        {canConnect ? (
          <>
            <form action={tokenAction} className="grid gap-3">
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <label className="grid gap-2 text-sm font-medium text-ink">
                Ключ доступа VK API
                <input
                  name="token"
                  type="password"
                  autoComplete="off"
                  required
                  className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
                />
              </label>
              <Button disabled={tokenPending}>{tokenPending ? "Проверяем..." : "Сохранить ключ чтения"}</Button>
            </form>
            {credential.connected ? (
              <form action={disconnectAction}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <Button type="submit" variant="secondary" disabled={disconnectPending}>
                  Отключить ключ
                </Button>
              </form>
            ) : null}
          </>
        ) : (
          <StatusBanner tone="info">Ключ чтения могут сохранить Owner и Admin.</StatusBanner>
        )}
      </Card>
    </div>
  );
}

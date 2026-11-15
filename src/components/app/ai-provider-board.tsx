"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import type { AiFormState } from "@/modules/ai/actions";
import type { PublicAiConnection } from "@/modules/ai/provider-service";
import { aiProviderCatalog } from "@/server/ai/catalog";

const idle: AiFormState = { status: "idle", message: "" };

export function AiProviderBoard({
  workspaceId,
  canConnect,
  connections,
  ideas,
  copy,
  image,
}: {
  workspaceId: string;
  canConnect: boolean;
  connections: PublicAiConnection[];
  ideas: PublicAiConnection;
  copy: PublicAiConnection;
  image: PublicAiConnection;
}) {
  const router = useRouter();
  const connected = connections.filter((item) => item.source !== "none" && item.hasKey);
  const [pendingKey, setPendingKey] = useState("");
  const [formState, setFormState] = useState<Record<string, AiFormState>>({});

  function stateFor(key: string) {
    return formState[key] ?? idle;
  }

  async function postForm(path: string, formData: FormData, key: string, pendingMessage: string) {
    setPendingKey(key);
    setFormState((current) => ({ ...current, [key]: { status: "idle", message: pendingMessage } }));
    try {
      const response = await fetch(path, {
        method: "POST",
        body: formData,
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      });
      const payload = (await response.json()) as AiFormState;
      setFormState((current) => ({
        ...current,
        [key]: {
          status: payload.status === "success" ? "success" : "invalid",
          message: payload.message || "Не удалось выполнить запрос.",
        },
      }));
      if (payload.status === "success") {
        router.refresh();
      }
    } catch {
      setFormState((current) => ({
        ...current,
        [key]: { status: "invalid", message: "Запрос до сервера не дошёл. Обновите страницу и нажмите ещё раз." },
      }));
    } finally {
      setPendingKey("");
    }
  }

  function onConnectSubmit(event: FormEvent<HTMLFormElement>, provider: string) {
    event.preventDefault();
    void postForm("/api/ai/connect", new FormData(event.currentTarget), `connect:${provider}`, "Проверяем ключ у провайдера...");
  }

  function onDisconnectSubmit(event: FormEvent<HTMLFormElement>, provider: string) {
    event.preventDefault();
    void postForm("/api/ai/disconnect", new FormData(event.currentTarget), `disconnect:${provider}`, "Отключаем...");
  }

  return (
    <Card className="grid gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Модели</p>
        <h2 className="mt-2 text-2xl font-black text-ink">ChatGPT пишет идеи, посты и визуал</h2>
        <p className="mt-2 text-sm text-ink/70">
          Один ключ OpenAI на сервере в ЕС: идеи по стенам ВК, текст поста и картинка. Ключ вставьте сюда, не в
          переписку — он шифруется на сервере. Пароль от чата не принимается.
        </p>
      </div>

      <ul className="grid gap-2 text-sm text-ink/70">
        <li>
          <span className="font-semibold text-ink">Идеи</span>
          {" — "}
          {ideas.hasKey ? `${ideas.label} (${ideas.model})` : "подключите ChatGPT"}
        </li>
        <li>
          <span className="font-semibold text-ink">Тексты</span>
          {" — "}
          {copy.hasKey ? `${copy.label} (${copy.model})` : "подключите ChatGPT"}
        </li>
        <li>
          <span className="font-semibold text-ink">Визуал</span>
          {" — "}
          {image.imageReady ? `${image.label} (${image.imageModel})` : "подключите ChatGPT"}
        </li>
      </ul>

      {connected.length === 0 ? (
        <StatusBanner tone="warning">
          AI не подключён. Без ключа агент не напишет пост и не нарисует картинку.
        </StatusBanner>
      ) : (
        <div className="grid gap-2">
          {connected.map((item) => {
            const key = `disconnect:${item.provider}`;
            const pending = pendingKey === key;
            const local = stateFor(key);
            return (
              <StatusBanner key={`${item.source}:${item.provider}`} tone={item.lastError ? "warning" : "success"}>
                {item.label}
                {item.source === "env" ? " через серверное окружение" : ""} · {item.model}
                {item.imageReady ? ` · визуал ${item.imageModel}` : " · без картинок"}
                {item.lastError ? ` · ${item.lastError}` : ""}
                {canConnect && item.source === "workspace" ? (
                  <form
                    method="post"
                    action="/api/ai/disconnect"
                    className="mt-3"
                    onSubmit={(event) => onDisconnectSubmit(event, item.provider)}
                  >
                    <input type="hidden" name="workspaceId" value={workspaceId} />
                    <input type="hidden" name="provider" value={item.provider} />
                    <Button type="submit" variant="secondary" disabled={Boolean(pendingKey)}>
                      {pending ? "Отключаем..." : `Отключить ${item.label}`}
                    </Button>
                    {local.message ? (
                      <p className="mt-2 text-sm">{local.message}</p>
                    ) : null}
                  </form>
                ) : null}
              </StatusBanner>
            );
          })}
        </div>
      )}

      <ul className="grid gap-4">
        {aiProviderCatalog.map((item) => {
          const key = `connect:${item.id}`;
          const pending = pendingKey === key;
          const local = stateFor(key);
          const already = connected.some((row) => row.provider === item.id && row.source === "workspace");
          return (
            <li key={item.id} className="grid gap-3 rounded-2xl p-4 ring-1 ring-ink/10">
              <div>
                <p className="font-semibold text-ink">{item.label}</p>
                <p className="mt-1 text-sm text-ink/70">{item.notes}</p>
                <p className="mt-1 text-sm text-ink/70">{item.keyHint}</p>
                <a href={item.keyUrl} className="mt-1 inline-block text-sm text-brand-dark" target="_blank" rel="noreferrer">
                  Где взять ключ
                </a>
              </div>
              {already ? (
                <StatusBanner tone="success">Ключ {item.shortLabel} уже сохранён на сервере.</StatusBanner>
              ) : canConnect ? (
                <form
                  method="post"
                  action="/api/ai/connect"
                  className="grid gap-3"
                  onSubmit={(event) => onConnectSubmit(event, item.id)}
                >
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="provider" value={item.id} />
                  <label className="grid gap-2 text-sm font-medium text-ink">
                    API-ключ {item.shortLabel}
                    <input
                      type="password"
                      name="apiKey"
                      required
                      minLength={8}
                      autoComplete="off"
                      placeholder="sk-..."
                      className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4"
                    />
                  </label>
                  {local.message ? (
                    <StatusBanner tone={local.status === "success" ? "success" : local.status === "invalid" ? "warning" : "info"}>
                      {local.message}
                    </StatusBanner>
                  ) : null}
                  <Button type="submit" disabled={Boolean(pendingKey)}>
                    {pending ? `Проверяем ${item.shortLabel}...` : `Подключить ${item.shortLabel}`}
                  </Button>
                </form>
              ) : (
                <StatusBanner tone="info">Подключить модель могут Admin и Owner.</StatusBanner>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

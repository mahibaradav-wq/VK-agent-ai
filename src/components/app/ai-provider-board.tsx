"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { connectAiProvider, disconnectAiProvider, type AiFormState } from "@/modules/ai/actions";
import { aiProviderCatalog } from "@/server/ai/catalog";

const idle: AiFormState = { status: "idle", message: "" };

export function AiProviderBoard({
  workspaceId,
  canConnect,
  connection,
}: {
  workspaceId: string;
  canConnect: boolean;
  connection: {
    provider: string;
    label: string;
    model: string;
    imageModel: string;
    imageReady: boolean;
    status: string;
    hasKey: boolean;
    lastError: string | null;
    source: "workspace" | "env" | "none";
  };
}) {
  const [connectState, connectAction, connectPending] = useActionState(connectAiProvider, idle);
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectAiProvider, idle);
  const connected = connection.source !== "none" && connection.hasKey;

  return (
    <Card className="grid gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Модель</p>
        <h2 className="mt-2 text-2xl font-black text-ink">ChatGPT, DeepSeek или Qwen</h2>
        <p className="mt-2 text-sm text-ink/70">
          Подключение официальным API-ключом, как Telegram-бот. Пароль от чата не принимается. Ключ шифруется на сервере
          и в браузер не возвращается.
        </p>
      </div>

      {connected ? (
        <StatusBanner tone="success">
          Подключён {connection.label}
          {connection.source === "env" ? " через серверное окружение" : ""}. Текст: {connection.model}
          {connection.imageReady ? ` · визуал: ${connection.imageModel}` : " · визуал недоступен у этого провайдера"}.
        </StatusBanner>
      ) : (
        <StatusBanner tone="warning">
          AI не подключён. Без ключа агент не напишет пост и не нарисует картинку.
        </StatusBanner>
      )}
      {connection.lastError ? <StatusBanner tone="warning">{connection.lastError}</StatusBanner> : null}

      <ul className="grid gap-2 text-sm text-ink/70">
        {aiProviderCatalog.map((item) => (
          <li key={item.id}>
            <span className="font-semibold text-ink">{item.label}</span>
            {" — "}
            {item.notes}{" "}
            <a href={item.keyUrl} className="text-brand-dark" target="_blank" rel="noreferrer">
              Где взять ключ
            </a>
          </li>
        ))}
      </ul>

      {canConnect ? (
        <form action={connectAction} className="grid gap-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <label className="grid gap-2 text-sm font-medium text-ink">
            Провайдер
            <select name="provider" defaultValue="openai" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4">
              {aiProviderCatalog.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink">
            API-ключ
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
          {connectState.message ? (
            <StatusBanner tone={connectState.status === "success" ? "success" : "warning"}>
              {connectState.message}
            </StatusBanner>
          ) : null}
          <Button disabled={connectPending}>{connectPending ? "Проверяем ключ..." : "Подключить"}</Button>
        </form>
      ) : (
        <StatusBanner tone="info">Подключить модель могут Admin и Owner.</StatusBanner>
      )}

      {canConnect && connection.source === "workspace" ? (
        <form action={disconnectAction}>
          <input type="hidden" name="workspaceId" value={workspaceId} />
          <Button type="submit" variant="secondary" disabled={disconnectPending}>
            Отключить
          </Button>
          {disconnectState.message ? (
            <StatusBanner tone={disconnectState.status === "success" ? "success" : "warning"}>
              {disconnectState.message}
            </StatusBanner>
          ) : null}
        </form>
      ) : null}
    </Card>
  );
}

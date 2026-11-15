"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { connectAiProvider, disconnectAiProvider, type AiFormState } from "@/modules/ai/actions";
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
  const [connectState, connectAction, connectPending] = useActionState(connectAiProvider, idle);
  const [disconnectState, disconnectAction, disconnectPending] = useActionState(disconnectAiProvider, idle);
  const connected = connections.filter((item) => item.source !== "none" && item.hasKey);

  return (
    <Card className="grid gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Модели</p>
        <h2 className="mt-2 text-2xl font-black text-ink">DeepSeek ищет идеи, ChatGPT пишет пост и визуал</h2>
        <p className="mt-2 text-sm text-ink/70">
          Можно держать оба ключа сразу. Пароль от чата не принимается. Ключ вставьте сюда, не в переписку: он
          шифруется на сервере.
        </p>
      </div>

      <ul className="grid gap-2 text-sm text-ink/70">
        <li>
          <span className="font-semibold text-ink">Идеи</span>
          {" — "}
          {ideas.hasKey ? `${ideas.label} (${ideas.model})` : "подключите DeepSeek"}
        </li>
        <li>
          <span className="font-semibold text-ink">Тексты</span>
          {" — "}
          {copy.hasKey ? `${copy.label} (${copy.model})` : "подключите ChatGPT"}
        </li>
        <li>
          <span className="font-semibold text-ink">Визуал</span>
          {" — "}
          {image.imageReady ? `${image.label} (${image.imageModel})` : "подключите ChatGPT или Qwen"}
        </li>
      </ul>

      {connected.length === 0 ? (
        <StatusBanner tone="warning">
          AI не подключён. Без ключа агент не напишет пост и не нарисует картинку.
        </StatusBanner>
      ) : (
        <div className="grid gap-2">
          {connected.map((item) => (
            <StatusBanner key={`${item.source}:${item.provider}`} tone={item.lastError ? "warning" : "success"}>
              {item.label}
              {item.source === "env" ? " через серверное окружение" : ""} · {item.model}
              {item.imageReady ? ` · визуал ${item.imageModel}` : " · без картинок"}
              {item.lastError ? ` · ${item.lastError}` : ""}
              {canConnect && item.source === "workspace" ? (
                <form action={disconnectAction} className="mt-3">
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="provider" value={item.provider} />
                  <Button type="submit" variant="secondary" disabled={disconnectPending}>
                    Отключить {item.label}
                  </Button>
                </form>
              ) : null}
            </StatusBanner>
          ))}
        </div>
      )}
      {disconnectState.message ? (
        <StatusBanner tone={disconnectState.status === "success" ? "success" : "warning"}>
          {disconnectState.message}
        </StatusBanner>
      ) : null}

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
    </Card>
  );
}

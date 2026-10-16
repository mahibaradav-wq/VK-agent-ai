"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { applyAiToPost, generateAi, type AiFormState } from "@/modules/ai/actions";
import { aiKinds, aiLengths, aiTones, kindLabels, lengthLabels, toneLabels } from "@/modules/ai/kinds";
import { previewPlatforms } from "@/modules/posts/platforms";

const idle: AiFormState = { status: "idle", message: "" };

export type AiHistoryItem = {
  id: string;
  kind: string;
  prompt: string;
  tone: string;
  length: string;
  platform: string;
  title: string;
  body: string;
  items: string[];
  provider: string;
  model: string;
  createdAt: string;
};

export function AiStudio({
  workspaceId,
  projectId,
  canGenerate,
  canApply,
  ready,
  provider,
  model,
  used,
  limit,
  history,
}: {
  workspaceId: string;
  projectId?: string;
  canGenerate: boolean;
  canApply: boolean;
  ready: boolean;
  provider: string;
  model: string;
  used: number;
  limit: number;
  history: AiHistoryItem[];
}) {
  const [state, formAction, pending] = useActionState(generateAi, idle);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
      <Card className="grid gap-4">
        {!ready ? (
          <StatusBanner tone="warning">
            Требуется настройка интеграции: задайте AI_API_KEY на сервере. Макет ниже — не ответ модели. Ключ во frontend
            не передаётся.
          </StatusBanner>
        ) : (
          <StatusBanner tone="info">
            Провайдер {provider} · модель {model} · лимит {used}/{limit} в этом месяце
          </StatusBanner>
        )}
        <form action={formAction} className="grid gap-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
          <label className="grid gap-2 text-sm font-medium text-ink">
            Тип
            <select name="kind" defaultValue="post" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-4">
              {aiKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kindLabels[kind]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm font-medium text-ink">
            Бриф
            <textarea
              name="prompt"
              required
              minLength={3}
              placeholder="О чём написать: борщ, весеннее меню, скидка на доставку..."
              className="min-h-32 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
            />
          </label>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="grid gap-2 text-sm font-medium text-ink">
              Тон
              <select name="tone" defaultValue="friendly" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-3">
                {aiTones.map((tone) => (
                  <option key={tone} value={tone}>
                    {toneLabels[tone]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-ink">
              Длина
              <select name="length" defaultValue="medium" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-3">
                {aiLengths.map((item) => (
                  <option key={item} value={item}>
                    {lengthLabels[item]}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium text-ink">
              Платформа
              <select name="platform" defaultValue="" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-3">
                <option value="">Без адаптации</option>
                {previewPlatforms.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {state.message ? (
            <StatusBanner tone={state.status === "success" ? "success" : "warning"}>{state.message}</StatusBanner>
          ) : null}
          {state.status === "success" && state.title ? (
            <div className="rounded-2xl bg-sand-50 p-4 text-sm text-ink/80">
              <p className="font-semibold text-ink">{state.title}</p>
              <p className="mt-2 whitespace-pre-wrap">{state.body}</p>
              {state.items && state.items.length > 0 ? (
                <ul className="mt-2 list-disc pl-5">
                  {state.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {canGenerate ? (
            <Button disabled={pending}>{pending ? "Генерируем..." : "Сгенерировать"}</Button>
          ) : (
            <StatusBanner tone="info">Генерировать могут Editor, Admin и Owner.</StatusBanner>
          )}
        </form>
        {!ready ? (
          <div className="rounded-2xl ring-1 ring-ink/10 p-4 text-sm text-ink/60">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Макет интерфейса, не ответ модели</p>
            <p className="mt-2 font-semibold text-ink">Весеннее меню на кухне</p>
            <p className="mt-1">Пример карточки, чтобы увидеть форму. Без AI_API_KEY сервер не подставит выдуманный текст.</p>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-4">
        <p className="text-sm font-semibold text-ink/70">История · {used}/{limit}</p>
        {history.length === 0 ? <StatusBanner tone="info">Истории генераций пока нет.</StatusBanner> : null}
        {history.map((item) => (
          <Card key={item.id} className="grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
              {item.kind} · {item.tone} · {item.length}
              {item.platform ? ` · ${item.platform}` : ""}
            </p>
            <h2 className="text-lg font-black text-ink">{item.title}</h2>
            <p className="text-sm text-ink/70 whitespace-pre-wrap">{item.body}</p>
            {item.items.length > 0 ? (
              <ul className="text-sm text-ink/70 list-disc pl-5">
                {item.items.map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-ink/50">
              {item.provider}/{item.model} · {item.createdAt}
            </p>
            {canApply && projectId ? (
              <form action={applyAiToPost}>
                <input type="hidden" name="workspaceId" value={workspaceId} />
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="requestId" value={item.id} />
                <Button variant="secondary">Перенести в редактор</Button>
              </form>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}

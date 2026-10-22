"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { applyAiToPost, composeAgentPost, generateAi, type AiFormState } from "@/modules/ai/actions";
import { aiKinds, aiLengths, aiTones, displayKind, kindLabels, lengthLabels, toneLabels } from "@/modules/ai/kinds";
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

function BriefFields() {
  return (
    <>
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
          <select name="platform" defaultValue="telegram" className="min-h-11 rounded-2xl border border-ink/10 bg-white px-3">
            <option value="">Без адаптации</option>
            {previewPlatforms.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </>
  );
}

export function AiStudio({
  workspaceId,
  projectId,
  canGenerate,
  canApply,
  ready,
  imageReady,
  storageReady,
  provider,
  model,
  imageModel,
  used,
  limit,
  history,
}: {
  workspaceId: string;
  projectId?: string;
  canGenerate: boolean;
  canApply: boolean;
  ready: boolean;
  imageReady: boolean;
  storageReady: boolean;
  provider: string;
  model: string;
  imageModel: string;
  used: number;
  limit: number;
  history: AiHistoryItem[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(generateAi, idle);
  const [agentState, agentAction, agentPending] = useActionState(composeAgentPost, idle);
  const agentReady = ready && imageReady && storageReady;

  useEffect(() => {
    if (agentState.status === "success" && agentState.postId) {
      router.push(`/app/posts/${agentState.postId}`);
    }
  }, [agentState.postId, agentState.status, router]);

  return (
    <div className="grid gap-6">
      <Card className="grid gap-4 ring-2 ring-brand-dark/15">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Агент</p>
          <h2 className="mt-2 text-2xl font-black text-ink">Пост + визуал</h2>
          <p className="mt-2 text-sm text-ink/70">
            Агент напишет текст и сгенерирует картинку, затем положит черновик в текущий проект. Без ключа AI и без
            готового хранилища картинка не подменяется макетом.
          </p>
        </div>
        {!ready ? (
          <StatusBanner tone="warning">
            Подключите ChatGPT или Qwen выше. Агент не напишет пост и не нарисует картинку без ключа. Макет ниже — не
            ответ модели.
          </StatusBanner>
        ) : !imageReady ? (
          <StatusBanner tone="warning">
            Этот провайдер пишет текст, но не рисует картинки. Для визуала подключите ChatGPT или Qwen.
          </StatusBanner>
        ) : !storageReady ? (
          <StatusBanner tone="warning">
            Хранилище не настроено. Визуал нельзя сохранить, поэтому агент не создаст черновик.
          </StatusBanner>
        ) : (
          <StatusBanner tone="info">
            Провайдер {provider} · текст {model} · визуал {imageModel} · лимит {used}/{limit}. Агент берёт 2 генерации.
          </StatusBanner>
        )}
        {!projectId ? (
          <StatusBanner tone="warning">
            Выберите проект в шапке кабинета. Агент кладёт черновик только в активный проект.
          </StatusBanner>
        ) : null}
        <form action={agentAction} className="grid gap-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
          <BriefFields />
          {agentState.message ? (
            <StatusBanner tone={agentState.status === "success" ? "success" : "warning"}>{agentState.message}</StatusBanner>
          ) : null}
          {canGenerate && projectId ? (
            <Button disabled={agentPending || !agentReady}>
              {agentPending ? "Агент пишет и рисует..." : "Создать пост с визуалом"}
            </Button>
          ) : (
            <StatusBanner tone="info">
              {projectId
                ? "Создать пост с визуалом могут Editor, Admin и Owner."
                : "Сначала выберите проект."}
            </StatusBanner>
          )}
        </form>
        {!agentReady ? (
          <div className="rounded-2xl ring-1 ring-ink/10 p-4 text-sm text-ink/60">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Макет интерфейса, не ответ модели</p>
            <p className="mt-2 font-semibold text-ink">Весеннее меню на кухне</p>
            <p className="mt-1">
              Пример карточки. Без ключа ChatGPT, DeepSeek или Qwen сервер не подставит выдуманный текст и не приложит фейковую картинку.
            </p>
          </div>
        ) : null}
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <Card className="grid gap-4">
          {!ready ? (
            <StatusBanner tone="warning">
              Подключите ChatGPT, DeepSeek или Qwen выше. Макет ниже — не ответ модели. Ключ во frontend не передаётся.
            </StatusBanner>
          ) : (
            <StatusBanner tone="info">
              Только текст · {provider} · {model} · лимит {used}/{limit} в этом месяце
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
            <BriefFields />
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
              <Button disabled={pending}>{pending ? "Генерируем..." : "Сгенерировать текст"}</Button>
            ) : (
              <StatusBanner tone="info">Генерировать могут Editor, Admin и Owner.</StatusBanner>
            )}
          </form>
          {!ready ? (
            <div className="rounded-2xl ring-1 ring-ink/10 p-4 text-sm text-ink/60">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Макет интерфейса, не ответ модели</p>
              <p className="mt-2 font-semibold text-ink">Весеннее меню на кухне</p>
              <p className="mt-1">Пример карточки, чтобы увидеть форму. Без ключа сервер не подставит выдуманный текст.</p>
            </div>
          ) : null}
        </Card>

        <div className="grid gap-4">
          <p className="text-sm font-semibold text-ink/70">История · {used}/{limit}</p>
          {history.length === 0 ? <StatusBanner tone="info">Истории генераций пока нет.</StatusBanner> : null}
          {history.map((item) => (
            <Card key={item.id} className="grid gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">
                {displayKind(item.kind)} · {item.tone} · {item.length}
                {item.platform ? ` · ${item.platform}` : ""}
              </p>
              <h2 className="text-lg font-black text-ink">{item.title}</h2>
              <p className="text-sm text-ink/70 whitespace-pre-wrap">{item.body}</p>
              {item.kind === "agent" ? (
                <p className="text-sm font-semibold text-brand-dark">Визуал приложен к черновику</p>
              ) : null}
              {item.items.filter((entry) => !entry.startsWith("visual:")).length > 0 ? (
                <ul className="text-sm text-ink/70 list-disc pl-5">
                  {item.items
                    .filter((entry) => !entry.startsWith("visual:"))
                    .map((entry) => (
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
    </div>
  );
}

"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { VisualStudio } from "@/components/app/visual-studio";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusBanner } from "@/components/ui/status-banner";
import { composeAgentPost, type AiFormState } from "@/modules/ai/actions";
import { aiLengths, aiTones, lengthLabels, toneLabels } from "@/modules/ai/kinds";
import { previewPlatforms } from "@/modules/posts/platforms";

const idle: AiFormState = { status: "idle", message: "" };

function BriefFields({
  defaultPrompt = "",
  defaultPlatform = "telegram",
  textareaId,
  highlight = false,
}: {
  defaultPrompt?: string;
  defaultPlatform?: string;
  textareaId?: string;
  highlight?: boolean;
}) {
  return (
    <>
      <label className="grid gap-2 text-sm font-medium text-ink">
        Бриф
        <textarea
          id={textareaId}
          name="prompt"
          required
          minLength={3}
          defaultValue={defaultPrompt}
          autoFocus={highlight}
          placeholder="О чём написать: борщ, весеннее меню, скидка на доставку..."
          className={`min-h-32 rounded-2xl border bg-white px-4 py-3 text-base font-normal ${
            highlight ? "border-brand-dark ring-2 ring-brand-dark/20" : "border-ink/10"
          }`}
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
          <select name="platform" defaultValue={defaultPlatform} className="min-h-11 rounded-2xl border border-ink/10 bg-white px-3">
            <option value="">Без адаптации</option>
            {previewPlatforms.map((item) => (
              <option key={item.id} value={item.id} disabled={!item.live}>
                {item.live ? item.label : `${item.label} (пока нельзя)`}
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
  ready,
  imageReady,
  storageReady,
  provider,
  model,
  imageModel,
  used,
  limit,
  defaultPrompt = "",
  defaultPlatform = "telegram",
  shopProductId = "",
}: {
  workspaceId: string;
  projectId?: string;
  canGenerate: boolean;
  ready: boolean;
  imageReady: boolean;
  storageReady: boolean;
  provider: string;
  model: string;
  imageModel: string;
  used: number;
  limit: number;
  defaultPrompt?: string;
  defaultPlatform?: string;
  shopProductId?: string;
}) {
  const router = useRouter();
  const [agentState, agentAction, agentPending] = useActionState(composeAgentPost, idle);
  const [visualLive, setVisualLive] = useState(true);
  const agentReady = ready && imageReady && storageReady;

  useEffect(() => {
    if (agentState.status === "success" && agentState.postId) {
      router.push(`/app/posts/${agentState.postId}`);
    }
  }, [agentState.postId, agentState.status, router]);

  useEffect(() => {
    if (!defaultPrompt) {
      return;
    }
    const node = document.getElementById("agent-brief");
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
    if (node instanceof HTMLTextAreaElement) {
      node.focus();
    }
  }, [defaultPrompt]);

  return (
    <div className="grid gap-6">
      <Card className="grid gap-4 ring-2 ring-brand-dark/15">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Агент</p>
          <h2 className="mt-2 text-2xl font-black text-ink">Пост + визуал</h2>
          <p className="mt-2 text-sm text-ink/70">
            ChatGPT напишет текст и нарисует картинку, затем положит черновик в текущий проект. Без ключа картинка не
            подменяется макетом. Идеи по стенам ВК тоже собирает ChatGPT — на странице наблюдения.
          </p>
        </div>
        {!ready ? (
          <StatusBanner tone="warning">
            Подключите ChatGPT выше. Агент не напишет пост и не нарисует картинку без его ключа. Макет ниже — не ответ
            модели.
          </StatusBanner>
        ) : !imageReady ? (
          <StatusBanner tone="warning">Для поста с визуалом подключите ChatGPT с доступом к картинкам.</StatusBanner>
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
        {defaultPrompt ? (
          <StatusBanner tone="success">
            Идея уже в брифе. Отредактируйте текст, тон, длину и площадку — пост появится только после кнопки «Создать
            пост с визуалом».
          </StatusBanner>
        ) : null}
        <form action={agentAction} className="grid gap-4">
          <input type="hidden" name="workspaceId" value={workspaceId} />
          {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
          {shopProductId ? <input type="hidden" name="shopProductId" value={shopProductId} /> : null}
          <BriefFields
            defaultPrompt={defaultPrompt}
            defaultPlatform={defaultPlatform}
            textareaId="agent-brief"
            highlight={Boolean(defaultPrompt)}
          />
          <VisualStudio
            workspaceId={workspaceId}
            briefTextareaId="agent-brief"
            defaultPlatform={defaultPlatform}
            imageReady={imageReady}
            storageReady={storageReady}
            imageModel={imageModel}
            used={used}
            limit={limit}
            pending={agentPending}
            onLiveChange={setVisualLive}
          />
          {agentState.message ? (
            <StatusBanner tone={agentState.status === "success" ? "success" : "warning"}>{agentState.message}</StatusBanner>
          ) : null}
          {canGenerate && projectId ? (
            <Button disabled={agentPending || !agentReady || !visualLive}>
              {agentPending ? "Агент пишет и рисует..." : "Создать пост с визуалом"}
            </Button>
          ) : (
            <StatusBanner tone="info">
              {projectId ? "Создать пост с визуалом могут Editor, Admin и Owner." : "Сначала выберите проект."}
            </StatusBanner>
          )}
        </form>
        {!agentReady ? (
          <div className="rounded-2xl ring-1 ring-ink/10 p-4 text-sm text-ink/60">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Макет интерфейса, не ответ модели</p>
            <p className="mt-2 font-semibold text-ink">Весеннее меню на кухне</p>
            <p className="mt-1">
              Пример карточки. Без ключа ChatGPT сервер не подставит выдуманный текст и не приложит фейковую картинку.
            </p>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

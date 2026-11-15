"use client";

import { useEffect, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { StatusBanner } from "@/components/ui/status-banner";
import { checkVisualModels, type AiFormState } from "@/modules/ai/actions";
import {
  aspectLabel,
  defaultVisualAspect,
  isVisualKindLive,
  parseVisualAspect,
  prepareVisualPrompt,
  visualAspectsByKind,
  visualKindLabels,
  visualKinds,
  type VisualAspect,
  type VisualKind,
} from "@/modules/ai/visual";
import { aspectRatioCss } from "@/modules/brand/visual-standard";

const idle: AiFormState = { status: "idle", message: "" };

function settingsKey(workspaceId: string) {
  return `polka-visual-studio:${workspaceId}`;
}

export function VisualStudio({
  workspaceId,
  briefTextareaId,
  defaultPlatform,
  imageReady,
  storageReady,
  imageModel,
  used,
  limit,
  pending = false,
  onLiveChange,
}: {
  workspaceId: string;
  briefTextareaId: string;
  defaultPlatform?: string;
  imageReady: boolean;
  storageReady: boolean;
  imageModel: string;
  used: number;
  limit: number;
  pending?: boolean;
  onLiveChange?: (live: boolean) => void;
}) {
  const [kind, setKind] = useState<VisualKind>("image");
  const [aspect, setAspect] = useState<VisualAspect>(defaultVisualAspect("image"));
  const [visualPrompt, setVisualPrompt] = useState("");
  const [prepareHint, setPrepareHint] = useState("");
  const [checkState, setCheckState] = useState<AiFormState>(idle);
  const [checkPending, startCheck] = useTransition();
  const remaining = Math.max(0, limit - used);
  const live = isVisualKindLive(kind);
  const aspects = visualAspectsByKind[kind];
  const missing: string[] = [];
  if (!imageReady) {
    missing.push("подключение генератора картинок");
  }
  if (!storageReady) {
    missing.push("хранение файлов");
  }
  if (remaining < 2) {
    missing.push("две генерации в лимите этого месяца");
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(settingsKey(workspaceId));
      if (!raw) {
        return;
      }
      const saved = JSON.parse(raw) as { kind?: string; aspect?: string };
      const nextKind = visualKinds.includes(saved.kind as VisualKind) ? (saved.kind as VisualKind) : "image";
      setKind(nextKind);
      setAspect(parseVisualAspect(saved.aspect ?? "", nextKind));
    } catch {
      // Keep defaults if the browser storage is empty or damaged.
    }
  }, [workspaceId]);

  useEffect(() => {
    window.localStorage.setItem(settingsKey(workspaceId), JSON.stringify({ kind, aspect }));
  }, [aspect, kind, workspaceId]);

  useEffect(() => {
    onLiveChange?.(live);
  }, [live, onLiveChange]);

  function changeKind(next: VisualKind) {
    setKind(next);
    setAspect(parseVisualAspect(aspect, next));
  }

  function checkModels() {
    const data = new FormData();
    data.set("workspaceId", workspaceId);
    startCheck(async () => {
      setCheckState({ status: "idle", message: "Спрашиваем каталог моделей. Генерация не запускается." });
      const result = await checkVisualModels(idle, data);
      setCheckState(result);
    });
  }

  function prepareFromBrief() {
    const brief = (document.getElementById(briefTextareaId) as HTMLTextAreaElement | null)?.value ?? "";
    if (brief.trim().length < 3) {
      setPrepareHint("Сначала напишите бриф. Запрос собирается без ИИ и без расхода лимита.");
      return;
    }
    setVisualPrompt(prepareVisualPrompt({ brief, kind, aspect }));
    setPrepareHint("Запрос собран из брифа и визуального стандарта «Дом по полочкам». Текст поста не меняется.");
  }

  return (
    <div className="grid gap-4 rounded-2xl bg-sand-50 p-4 ring-1 ring-ink/10">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-dark">Студия визуала</p>
        <p className="mt-1 text-sm text-ink/70">
          Стандарт «Дом по полочкам»: тёплый минимализм, реалистичная кухня, формат по умолчанию 4:5. Сначала бриф, затем
          кадр.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-4">
        {visualKinds.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => changeKind(item)}
            className={`min-h-11 rounded-2xl px-3 text-sm font-semibold ring-1 ${
              kind === item ? "bg-white text-ink ring-brand-dark/40" : "bg-white/60 text-ink/70 ring-ink/10"
            }`}
          >
            {visualKindLabels[item]}
          </button>
        ))}
      </div>
      <input type="hidden" name="visualKind" value={kind} />

      <dl className="grid gap-2 text-sm text-ink/80">
        <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-ink">Создаётся сейчас</dt>
          <dd>{pending ? "агент пишет текст и рисует картинку" : "ещё не создано. Файл сохранится в медиатеку проекта"}</dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-ink">Подготавливается</dt>
          <dd>{visualPrompt ? "текстовый запрос для одного кадра" : "запрос ещё не собран из брифа"}</dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-ink">Генератор</dt>
          <dd>{imageReady ? imageModel : "не подключён"}</dd>
        </div>
        <div className="grid gap-1 sm:grid-cols-[10rem_1fr]">
          <dt className="font-medium text-ink">Не хватает</dt>
          <dd>{missing.length ? missing.join(", ") : "ничего — можно создавать"}</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="secondary" disabled={checkPending} onClick={checkModels}>
          {checkPending ? "Проверяем каталог..." : "Проверить доступность моделей"}
        </Button>
        <p className="text-xs text-ink/50">Каталог не тратит лимит. Проверка не запускает генерацию.</p>
      </div>
      {checkState.message ? (
        <StatusBanner tone={checkState.status === "success" ? "success" : "warning"}>{checkState.message}</StatusBanner>
      ) : null}

      {kind === "video" ? (
        <StatusBanner tone="info">
          MP4 агент не собирает: нет отдельного видео-API. Получится обложка первого кадра 9:16 или 16:9 — публикация только
          после вашей проверки.
        </StatusBanner>
      ) : kind === "carousel" ? (
        <StatusBanner tone="info">
          Карусель сейчас — одна обложка. Все будущие слайды этой серии будут в том же формате {aspect}.
        </StatusBanner>
      ) : kind === "infographic" ? (
        <StatusBanner tone="info">
          Инфографика: одна мысль, крупные блоки, палитра бежевый / графит / олива. Мелкий текст модель не пишет.
        </StatusBanner>
      ) : null}

      <div className="grid gap-2">
        <Button type="button" variant="secondary" onClick={prepareFromBrief}>
          Подготовить запрос по тексту
        </Button>
        {prepareHint ? <p className="text-sm text-ink/70">{prepareHint}</p> : null}
        <label className="grid gap-2 text-sm font-medium text-ink">
          Запрос на визуал
          <textarea
            name="visualPrompt"
            value={visualPrompt}
            onChange={(event) => setVisualPrompt(event.target.value)}
            placeholder="Соберите запрос из брифа или напишите свой. Пустой запрос агент соберёт сам из текста поста."
            className="min-h-24 rounded-2xl border border-ink/10 bg-white px-4 py-3 text-base font-normal"
          />
        </label>
      </div>

      <div>
        <p className="text-sm font-medium text-ink">{visualKindLabels[kind]}</p>
        <p className="mt-1 text-sm text-ink/60">
          Формат {aspectLabel(aspect)}. Модель отдаёт ближайший кадр ChatGPT, предпросмотр держит выбранные пропорции без
          обрезки. Агент берёт 2 генерации из лимита {used}/{limit}.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {aspects.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setAspect(item)}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ${
                aspect === item ? "bg-ink text-white ring-ink" : "bg-white text-ink ring-ink/10"
              }`}
            >
              {aspectLabel(item)}
            </button>
          ))}
        </div>
        <input type="hidden" name="visualAspect" value={aspect} />
        <div
          className="relative mx-auto mt-4 w-full max-w-56 overflow-hidden rounded-2xl bg-[#F3EEE5] ring-1 ring-[#DED6C9]"
          style={{ aspectRatio: aspectRatioCss(aspect) }}
        >
          <div className="absolute inset-[8%] rounded-xl border border-dashed border-[#78866A]/70" />
          <p className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-[#343632]">
            Безопасная зона {aspect}
            {defaultPlatform === "vk" ? " · стена ВК" : ""}
          </p>
        </div>
      </div>
    </div>
  );
}

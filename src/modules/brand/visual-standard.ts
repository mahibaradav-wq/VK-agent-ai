export const houseBrand = {
  name: "Дом по полочкам",
  palette: {
    beige: "#F3EEE5",
    milk: "#FAF8F3",
    olive: "#78866A",
    sage: "#A8B39A",
    graphite: "#343632",
    taupe: "#77766E",
    terracotta: "#C47D61",
    sand: "#DED6C9",
  },
} as const;

export const visualTargetPixels = {
  "1:1": { width: 1080, height: 1080, label: "универсальная карточка" },
  "4:5": { width: 1080, height: 1350, label: "карусель и обучающие карточки" },
  "16:9": { width: 1920, height: 1080, label: "широкая схема" },
  "9:16": { width: 1080, height: 1920, label: "вертикальное видео" },
} as const;

export function aspectRatioCss(aspect: string) {
  const [width, height] = aspect.split(":");
  if (!width || !height) {
    return "4 / 5";
  }
  return `${width} / ${height}`;
}

export const copyLengthSpec = {
  short: { min: 900, max: 1400, maxTokens: 1800, timeoutMs: 45_000, label: "Короткий · 900–1400 знаков" },
  medium: { min: 1900, max: 2600, maxTokens: 3200, timeoutMs: 70_000, label: "Средний · 1900–2600 знаков" },
  long: { min: 3800, max: 4090, maxTokens: 5000, timeoutMs: 120_000, label: "Длинный · 3800–4090 знаков" },
} as const;

export type CopyLengthKey = keyof typeof copyLengthSpec;

const copyLengthShape: Record<CopyLengthKey, string> = {
  short:
    "SHORT body: opening 2–3 sentences, why it matters, 4 numbered steps, one closing question. Title under 60 characters. Do not pad with empty adjectives.",
  medium:
    "MEDIUM body: opening 3–5 sentences; the problem in a small kitchen; 6 numbered practical steps with a one-sentence why after each; one typical mistake; a short benefit and a question.",
  long:
    "LONG body: opening scene 4–6 sentences; why the problem appears in a small kitchen; what not to do; 8–10 numbered steps, each with two sentences (action + why); a mini-checklist; two typical mistakes; a closing benefit and a question. Do not stop after a caption or after 1500 characters. The last paragraph must close the thought.",
};

export function resolveCopyLength(length?: string): CopyLengthKey {
  if (length === "short" || length === "long") {
    return length;
  }
  return "medium";
}

export function copyLengthRange(length?: string) {
  return copyLengthSpec[resolveCopyLength(length)];
}

export function copyLengthInstruction(length?: string) {
  const key = resolveCopyLength(length);
  const spec = copyLengthSpec[key];
  return `Post length ${key.toUpperCase()}. Body ${spec.min}–${spec.max} characters including spaces (count them; title is extra). ${copyLengthShape[key]}`;
}

export function copyUserLengthHint(length?: string) {
  const key = resolveCopyLength(length);
  const spec = copyLengthSpec[key];
  return `Длина: ${key}. Поле body — от ${spec.min} до ${spec.max} знаков с пробелами. Заголовок в подсчёт не входит. Текст законченный по смыслу: каждое предложение закрыто, список дописан, последний абзац — вывод и вопрос. Уложись в лимит сам, ничего не обрезай.`;
}

export function copyReviseHint(currentChars: number, length?: string) {
  const spec = copyLengthRange(length);
  if (currentChars < spec.min) {
    return `Предыдущий текст незавершённый и слишком короткий: ${currentChars} знаков, нужно ${spec.min}–${spec.max}. Верни JSON целиком с тем же title. Допиши законченный пост: все пункты списка закрыты, последний абзац — вывод и вопрос. Не обрывай фразу и не пиши только дополнение.`;
  }
  return `Предыдущий текст слишком длинный: ${currentChars} знаков, максимум ${spec.max}. Не обрезай конец. Перепиши целиком короче, сохрани смысл, закончи выводом и вопросом. Все предложения закрыты. Верни JSON с тем же title.`;
}

export function copyMaxTokens(length?: string) {
  return copyLengthRange(length).maxTokens;
}

export function copyTimeoutMs(length?: string) {
  return copyLengthRange(length).timeoutMs;
}

export function bodyMeetsCopyLength(body: string, length?: string) {
  const n = body.trim().length;
  const spec = copyLengthRange(length);
  return n >= spec.min && n <= spec.max;
}

export function preferRevisedCopy(original: string, revised: string, length?: string) {
  const spec = copyLengthRange(length);
  const a = original.trim();
  const b = revised.trim();
  if (!b) {
    return false;
  }
  const aFit = a.length >= spec.min && a.length <= spec.max;
  const bFit = b.length >= spec.min && b.length <= spec.max;
  if (bFit) {
    return true;
  }
  if (aFit) {
    return false;
  }
  if (a.length > spec.max) {
    return b.length < a.length;
  }
  return b.length > a.length;
}

export function copySystemRules(kind: string, length?: string) {
  return [
    `You write for «${houseBrand.name}»: practical home organization, especially small kitchens.`,
    "Language: Russian. Tone: calm, competent, friendly, not preachy, no hard sell.",
    "Do not invent sizes, discounts, reach, or product claims.",
    "Avoid ALL CAPS, stacks of exclamation marks, and leftover English filler.",
    kind === "post"
      ? [
          "For a post fill title and body.",
          "Title: a concrete household problem or a useful result.",
          copyLengthInstruction(length),
          "The length instruction is mandatory: write a finished body inside that character range. Lists for sequences. Break into paragraphs. Close every sentence and the numbered list. The last paragraph is a benefit and a question. Never truncate mid-thought. A 1300-character text is SHORT, not LONG.",
        ].join(" ")
      : `Task kind: ${kind}.`,
  ].join(" ");
}

export function visualStyleRules() {
  const { beige, olive, graphite, terracotta, sage } = houseBrand.palette;
  return [
    `Brand: ${houseBrand.name}. Warm modern minimalism for a real small kitchen.`,
    "Realistic daylight photograph or quiet illustration. Wood, ceramic, metal, glass, textile. Order, coziness, useful storage.",
    "Show a concrete problem, a way to organize, or a before/after. Keep important objects inside an 8% safe margin.",
    "No glossy CGI interiors, acid colors, heavy gradients, visual clutter, watermarks, logos, UI chrome, or tiny unreadable text.",
    "Do not render paragraphs of text in the image. Labels only if the kind is infographic, and then at most three short words.",
    `Infographic palette if needed: background ${beige}, type ${graphite}, accents ${olive} and ${sage}, terracotta ${terracotta} only as a rare highlight.`,
  ].join(" ");
}

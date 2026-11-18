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

export const copyLengthRules = {
  short:
    "Post length SHORT. Body 400–700 characters including spaces (count them). One short opening, 3 numbered steps, one closing line. Title under 60 characters. Do not pad with empty adjectives.",
  medium:
    "Post length MEDIUM. Body 900–1400 characters including spaces. This is longer than a caption. Opening 2–4 sentences; the solution; 4–6 numbered practical steps; a short benefit; one question.",
  long:
    "Post length LONG. Body 1800–2800 characters including spaces. Do not stop after a caption. Opening scene 3–5 sentences; why it matters in a small kitchen; 6–8 numbered steps with a one-sentence why after each; one typical mistake; a closing benefit and a question.",
} as const;

export function copyLengthInstruction(length?: string) {
  if (length === "short") {
    return copyLengthRules.short;
  }
  if (length === "long") {
    return copyLengthRules.long;
  }
  return copyLengthRules.medium;
}

export function copyMaxTokens(length?: string) {
  if (length === "short") {
    return 500;
  }
  if (length === "long") {
    return 1800;
  }
  return 900;
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
          "The length instruction is mandatory: write a body inside that character range. Lists for sequences. Break into paragraphs. Not a one-line caption unless length is SHORT.",
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

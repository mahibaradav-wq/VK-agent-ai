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

export function copySystemRules(kind: string) {
  return [
    `You write for «${houseBrand.name}»: practical home organization, especially small kitchens.`,
    "Language: Russian. Tone: calm, competent, friendly, not preachy, no hard sell.",
    "Do not invent sizes, discounts, reach, or product claims.",
    "Avoid ALL CAPS, stacks of exclamation marks, and leftover English filler.",
    kind === "post"
      ? [
          "For a post fill title and body.",
          "Title: a concrete household problem or a useful result.",
          "Body structure: 1-3 sentence situation; the solution; numbered practical steps; a short benefit; one fitting question.",
          "Paragraphs of 1-3 sentences. Lists for sequences. No wall of text.",
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

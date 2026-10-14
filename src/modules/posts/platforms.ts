export const previewPlatforms = [
  { id: "vk", label: "ВКонтакте", hint: "Собственный шаблон предпросмотра, не официальный виджет VK." },
  { id: "telegram", label: "Telegram", hint: "Собственный шаблон предпросмотра, не клиент Telegram." },
] as const;

export type PreviewPlatformId = (typeof previewPlatforms)[number]["id"];

export function parsePlatforms(values: string[]) {
  const allowed = new Set(previewPlatforms.map((item) => item.id));
  return [...new Set(values.filter((value) => allowed.has(value as PreviewPlatformId)))] as PreviewPlatformId[];
}

export const vkUnavailableMessage =
  "Публикация во ВКонтакте недоступна: нужен официальный VK ID. Authorization Code Flow отключён с 25 июня 2024, право wall выдаётся через поддержку. Пароль VK не принимается.";

export const previewPlatforms = [
  {
    id: "telegram",
    label: "Telegram",
    live: true,
    hint: "Собственный шаблон предпросмотра, не клиент Telegram.",
  },
  {
    id: "vk",
    label: "ВКонтакте",
    live: false,
    hint: "Предпросмотр макета. Публикация во ВК на этом этапе недоступна.",
  },
] as const;

export type PreviewPlatformId = (typeof previewPlatforms)[number]["id"];

export function isLivePublishPlatform(platform: string) {
  return previewPlatforms.some((item) => item.id === platform && item.live);
}

export function parsePlatforms(values: string[]) {
  const allowed = new Set(previewPlatforms.map((item) => item.id));
  return [...new Set(values.filter((value) => allowed.has(value as PreviewPlatformId)))] as PreviewPlatformId[];
}

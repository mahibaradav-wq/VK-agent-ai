export const vkUnavailableMessage =
  "Публикация во ВКонтакте недоступна: подключите ключ доступа сообщества с правом «Стена». Сервисный ключ приложения и пароль не подходят.";

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
    live: true,
    hint: "Стена сообщества через wall.post. Нужен ключ сообщества с правами «Стена» и «Фотографии», не сервисный ключ приложения.",
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

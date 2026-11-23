export const FIRST_SOCIAL_PLATFORM = "telegram" as const;

export const socialPlatformCatalog = [
  {
    id: "telegram",
    label: "Telegram",
    first: true,
    officialAuth: "Токен бота от @BotFather (Bot API)",
    passwordAllowed: false,
    docsUrl: "https://core.telegram.org/bots/api",
  },
  {
    id: "vk",
    label: "ВКонтакте",
    first: false,
    officialAuth:
      "Ключ админа клуба с photos.getWallUploadServer — текст и фото. Ключ сообщества с правом «Стена» — только текст, картинку выкладываете вручную. Сервисный ключ приложения только читает стены. Пароль не принимается.",
    passwordAllowed: false,
    docsUrl: "https://dev.vk.com/en/api/access-token/getting-started",
  },
] as const;

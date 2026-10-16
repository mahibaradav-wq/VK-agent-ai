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
    officialAuth: "VK ID OAuth 2.1 / ключ сообщества. Старый Authorization Code Flow отключён 25.06.2024",
    passwordAllowed: false,
    docsUrl: "https://dev.vk.com/en/api/access-token/getting-started",
  },
] as const;

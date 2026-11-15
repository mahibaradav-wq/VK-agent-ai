# Исследование социальных платформ (этап 8)

Документ фиксирует выбор первой официально доступной интеграции. Пароль
пользователя соцсети нигде не запрашивается.

## Таблица

| Платформа | Официальный механизм | Публикация | Пароль пользователя | Доступность в этом этапе | Решение |
|---|---|---|---|---|---|
| Telegram | [Bot API](https://core.telegram.org/bots/api): токен от [@BotFather](https://core.telegram.org/bots/features#botfather), HTTPS `https://api.telegram.org/bot<token>/<method>` | `sendMessage` | Нет. Токен бота — не пароль аккаунта | Да: метод публичный, без модерации приложения | **Первая интеграция** |
| ВКонтакте | [VK API](https://dev.vk.com/en/api/api-requests) `api.vk.ru`, ключ доступа сообщества с правом `wall`. Пользовательский ключ — через [VK ID OAuth 2.1](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/realization) (PKCE). [Authorization Code Flow и Implicit Flow отключены 25 июня 2024](https://dev.vk.com/en/api/access-token/getting-started). Сервисный ключ приложения стену не пишет | `wall.post` от имени сообщества | Нет, собирать пароль VK запрещено | Да: ключ сообщества из «Работа с API» | **Стена сообщества** |
| Instagram / Facebook | Meta Graph API, OAuth приложения | Graph publish | Нет | App Review, Business | Позже |
| X (Twitter) | X API v2, OAuth 2.0 | tweets | Нет | Платный доступ | Позже |

## Почему Telegram, а не VK

1. Официальный HTTP API и токен от BotFather доступны без заявки в поддержку.
2. Подключение не требует пароля пользователя Telegram.
3. Ошибки API документированы: `401` (недействительный токен), `429` (rate limit), `400`/`403` (чат недоступен).
4. VK публикует на стену сообщества официальным `wall.post` и ключом сообщества (не сервисный ключ приложения и не пароль). Пользовательский VK ID user token с правом `wall` по-прежнему выдаётся через поддержку и здесь не используется.

Без токена бота адаптер Telegram возвращает `integration_not_configured` и не имитирует успех.
Токен без канала допустим: бот сохраняется, публикация ждёт ваш канал или группу (`telegram_no_chat`). Чужой публичный канал по похожему имени не подставляется.
Без ключа сообщества адаптер VK делает то же самое с явной причиной.

## Capabilities первой интеграции

| Capability | Telegram | VK | Статус |
|---|---|---|---|
| `publish_text` | `sendMessage` | `wall.post` | Реализовано |
| `publish_media` | `sendPhoto` / upload | `photos.getWallUploadServer` + `photos.saveWallPhoto` + `wall.post` attachments | VK: включено. Telegram: пока текст с пометкой |
| `read_insights` | — | — | Этап 10 |

## Официальные источники

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram BotFather: https://core.telegram.org/bots/features#botfather
- VK API requests: https://dev.vk.com/en/api/api-requests
- VK access keys: https://dev.vk.com/en/api/access-token/getting-started
- VK wall.post: https://dev.vk.com/en/method/wall.post
- VK ID OAuth 2.1: https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/realization

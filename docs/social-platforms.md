# Исследование социальных платформ (этап 8)

Документ фиксирует выбор первой официально доступной интеграции. Пароль
пользователя соцсети нигде не запрашивается.

## Таблица

| Платформа | Официальный механизм | Публикация | Пароль пользователя | Доступность в этом этапе | Решение |
|---|---|---|---|---|---|
| Telegram | [Bot API](https://core.telegram.org/bots/api): токен от [@BotFather](https://core.telegram.org/bots/features#botfather), HTTPS `https://api.telegram.org/bot<token>/<method>` | `sendMessage` | Нет. Токен бота — не пароль аккаунта | Да: метод публичный, без модерации приложения | **Первая интеграция** |
| ВКонтакте | [VK API](https://dev.vk.com/en/api/api-requests) `api.vk.ru`, ключ `Authorization: Bearer`. Пользовательский ключ — через [VK ID OAuth 2.1](https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/realization) (PKCE). [Authorization Code Flow и Implicit Flow отключены 25 июня 2024](https://dev.vk.com/en/api/access-token/getting-started) | `wall.post` | Нет, собирать пароль VK запрещено | Нет как рабочий MVP: право `wall` для user token выдаётся «в исключительных случаях» через `devsupport@corp.vk.com`; нужны приложение VK ID и подтверждение бизнеса | Следующие этапы |
| Instagram / Facebook | Meta Graph API, OAuth приложения | Graph publish | Нет | App Review, Business | Позже |
| X (Twitter) | X API v2, OAuth 2.0 | tweets | Нет | Платный доступ | Позже |

## Почему Telegram, а не VK

1. Официальный HTTP API и токен от BotFather доступны без заявки в поддержку.
2. Подключение не требует пароля пользователя Telegram.
3. Ошибки API документированы: `401` (недействительный токен), `429` (rate limit), `400`/`403` (чат недоступен).
4. VK остаётся целевой платформой продукта, но текущий официальный путь публикации на стену (`wall.post` + право `wall`) в этом окружении не подтверждён: нет VK-приложения, нет исключительного права `wall`, старый OAuth отключён.

Без токена бота адаптер возвращает `integration_not_configured` и не имитирует успех.
Без приложения VK ID адаптер VK делает то же самое с явной причиной.

## Capabilities первой интеграции

| Capability | Telegram | Статус |
|---|---|---|
| `publish_text` | `sendMessage` | Реализовано |
| `publish_media` | `sendPhoto` / upload | Не включено: вложения не выдаются за опубликованные |
| `read_insights` | — | Этап 10 |

## Официальные источники

- Telegram Bot API: https://core.telegram.org/bots/api
- Telegram BotFather: https://core.telegram.org/bots/features#botfather
- VK API requests: https://dev.vk.com/en/api/api-requests
- VK access keys: https://dev.vk.com/en/api/access-token/getting-started
- VK wall.post: https://dev.vk.com/en/method/wall.post
- VK ID OAuth 2.1: https://id.vk.ru/about/business/go/docs/ru/vkid/latest/vk-id/connection/realization

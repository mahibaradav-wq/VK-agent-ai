# Runbook: интеграции

Каждая интеграция либо готова, либо показывает настройку. Готовность не рисуется при отсутствии credentials.

## Почта

- Dev: `AUTH_DEV_MAILBOX=true` → `/dev/mailbox`.
- Prod: `EMAIL_API_KEY` + `EMAIL_API_URL` + `EMAIL_FROM`. HTTP POST с Bearer.
- Если ничего не задано, in-app уведомление пишется, внешнее письмо не имитируется.

## Telegram Bot API

- Токен только от @BotFather, в кабинете `/app/social-accounts`.
- Пароль аккаунта отклоняется.
- 401 → `token_expired`, 429 → `rate_limit`. Успех только после ответа Bot API.

## AI

- В `/app/ai` Owner/Admin подключают ChatGPT, DeepSeek или Qwen API-ключом (`sk-...`). Пароль от чата отклоняется.
- Ключ проверяется живым `GET /models`, шифруется на сервере, во frontend не возвращается.
- DeepSeek пишет только текст. Визуал агента — ChatGPT (DALL·E) или Qwen Images.
- Без ключа (и без `AI_API_KEY` в env) генерация не имитируется.

## Биллинг

- `/app/subscription` рисует checkout URL, но оплата = только проверенный webhook.
- Без `BILLING_WEBHOOK_SECRET` webhook не принимается.
- Replay того же `PaymentEvent` не меняет подписку.

## Хранилище

- `STORAGE_DRIVER=local` пишет в `LOCAL_STORAGE_DIR`.
- `s3` требует endpoint, bucket и ключи. Без них загрузка не притворяется успешной.

## Админка статусов

`/admin/integrations` показывает ready/not-ready без секретов. Если карточка «требуется настройка» — смотрите этот runbook, а не логи с ключами.

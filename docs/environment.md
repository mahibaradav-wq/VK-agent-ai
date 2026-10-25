# Переменные окружения

Скопируйте `.env.example` в `.env` и заполните обязательные значения. Пустая переменная означает «интеграция не настроена», а не «можно показать фиктивный успех».

## Обязательные для запуска сайта

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | PostgreSQL. Пример: `postgresql://polka:пароль@localhost:5432/polka_social` |
| `AUTH_SECRET` | Секрет сессий Auth.js, минимум 32 случайных символа |
| `NEXT_PUBLIC_SITE_URL` | Публичный URL сайта, без завершающего `/` |
| `AUTH_URL` | Тот же публичный URL для Auth.js и писем. На хостинге равен `https://ваш-домен` |
| `SITE_DOMAIN` | Домен без `https://`, только для `docker-compose.prod.yml` и Caddy |
| `ACME_EMAIL` | Почта для Let's Encrypt. Caddy выпускает HTTPS-сертификат |

## Локальная разработка

| Переменная | Назначение |
|---|---|
| `AUTH_DEV_MAILBOX=true` | Письма подтверждения, сброса, приглашений и уведомлений пишутся в `/dev/mailbox` |
| `STORAGE_DRIVER=local` | Файлы в `LOCAL_STORAGE_DIR` (по умолчанию `./data/media`) |

В production `AUTH_DEV_MAILBOX` не задают. Иначе стенд писем станет публичной утечкой токенов.

## Опциональные интеграции

| Переменная | Назначение | Если пусто |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | Ключ AES для токенов соцаккаунтов | Берётся `AUTH_SECRET` |
| `REDIS_URL` + `QUEUE_DRIVER=redis` | BullMQ | Задачи пишутся в PostgreSQL, диспетчер Redis не стартует |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_IMAGE_MODEL`, `AI_MONTHLY_LIMIT` | запасной AI, если в кабинете нет ключа | UI предлагает подключить ChatGPT / DeepSeek / Qwen |
| `BILLING_WEBHOOK_SECRET` | HMAC оплаты | Checkout не имитирует оплату |
| `ADMIN_EMAILS` | Email через запятую → Superadmin при первом заходе в `/admin` | Админка пуста, пока роль не выдана |
| `EMAIL_API_KEY`, `EMAIL_API_URL`, `EMAIL_FROM` | Внешняя почта уведомлений | Без mailbox и без ключа письмо не отправляется |
| `STORAGE_DRIVER=s3` и `S3_*` | Объектное хранилище | Локальный диск или отказ загрузки |

Токен Telegram задаётся в кабинете, не в env. Глобальный bot token в окружении не используется.

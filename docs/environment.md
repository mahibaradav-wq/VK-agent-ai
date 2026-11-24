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
| `AUTH_ALLOW_PUBLIC_REGISTRATION=false` | Закрывает публичную регистрацию. Первый владелец на пустой БД и приглашённые email проходят |
| `STORAGE_DRIVER=local` | Файлы в `LOCAL_STORAGE_DIR` (по умолчанию `./data/media`) |
| `AI_LIVE_ENABLED=true` | Разрешает платные вызовы OpenAI и чтение баланса. Пока флаг не `true`, live-запросы не идут |

В production `AUTH_DEV_MAILBOX` не задают. Иначе стенд писем станет публичной утечкой токенов. Для личного кабинета после первого владельца задайте `AUTH_ALLOW_PUBLIC_REGISTRATION=false`. `AI_LIVE_ENABLED` не включайте, пока не согласован числовой бюджет.

## Опциональные интеграции

| Переменная | Назначение | Если пусто |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | Отдельный случайный ключ AES-256 для токенов соцаккаунтов; обязателен в production, минимум 32 символа, не совпадает с `AUTH_SECRET` | В development допускается fallback на `AUTH_SECRET`; в production шифрование без отдельного ключа блокируется. Старые токены можно расшифровать legacy-ключом `AUTH_SECRET`. |
| `REDIS_URL` + `QUEUE_DRIVER=redis` | BullMQ | Задачи пишутся в PostgreSQL, диспетчер Redis не стартует |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_IMAGE_MODEL` | запасной AI-провайдер, если в кабинете нет подключённого провайдера | UI предлагает подключить ChatGPT; без ключа генерация не имитируется. Счётчик usage безлимитен (`0`) и не является бюджетом |
| `YOOKASSA_SHOP_ID` + `YOOKASSA_SECRET_KEY` | ЮKassa. В личном кабинете checkout из UI выключен, таблицы не удаляются | Checkout не имитирует оплату |
| `BILLING_WEBHOOK_SECRET` | запасной HMAC-стенд для тестов | Не нужен, если задана ЮKassa |
| `ADMIN_EMAILS` | Email через запятую → Superadmin при первом заходе в `/admin` | Админка пуста, пока роль не выдана |
| `EMAIL_API_KEY`, `EMAIL_API_URL`, `EMAIL_FROM` | Внешняя почта уведомлений | Без mailbox и без ключа письмо не отправляется |
| `STORAGE_DRIVER=s3` и `S3_*` | Объектное хранилище | Локальный диск или отказ загрузки |
| `TELEGRAM_PROXY_URL` | Исходящий HTTP(S) прокси до Bot API, если с VPS нет прямого доступа к `api.telegram.org` | Прямое HTTPS к Telegram |
| `AI_PROXY_URL` | Исходящий прокси только для OpenAI, если `api.openai.com` отвечает `unsupported_country` | Прямой доступ. Не берёт `TELEGRAM_PROXY_URL` |
| `VK_API_BASE_URL` | Корень VK API для агента наблюдения. Идёт напрямую, не через Telegram-прокси | `https://api.vk.ru` |
| `TELEGRAM_API_BASE_URL` | Корень Bot API без завершающего `/` | `https://api.telegram.org` |

Токен Telegram задаётся в кабинете, не в env. Глобальный bot token в окружении не используется.

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
| `AUTH_ALLOW_PUBLIC_REGISTRATION=true` | Открывает публичную регистрацию. Без флага после первого владельца остаются только приглашения |
| `STORAGE_DRIVER=local` | Файлы в `LOCAL_STORAGE_DIR` (по умолчанию `./data/media`) |
| `AI_LIVE_ENABLED=true` | Разрешает платные вызовы OpenAI вместе с `AI_MONTHLY_HARD_LIMIT`. Пока оба не заданы, live-запросы не идут |
| `AI_MONTHLY_HARD_LIMIT` | Общий месячный лимит платных AI-операций кабинета (целое ≥ 1) |
| `SOCIAL_PUBLISH_LIVE=true` | На VPS (`POLKA_REQUIRE_PROD_SECRETS=true`) обязателен для живых VK/Telegram. Без флага адаптеры отказывают. Локально/в тестах по умолчанию разрешено; `=false` принудительно блокирует |

В production `AUTH_DEV_MAILBOX` не задают. Иначе стенд писем станет публичной утечкой токенов. Для личного кабинета после первого владельца задайте `AUTH_ALLOW_PUBLIC_REGISTRATION=false`. `AI_LIVE_ENABLED` и `SOCIAL_PUBLISH_LIVE` не включайте, пока не согласованы бюджет и токены.

## Опциональные интеграции

| Переменная | Назначение | Если пусто |
|---|---|---|
| `TOKEN_ENCRYPTION_KEY` | Отдельный случайный ключ AES-256 для токенов соцаккаунтов. **В production обязателен**: минимум 32 символа, не совпадает с `AUTH_SECRET`. `scripts/vps-up.sh` и `POLKA_REQUIRE_PROD_SECRETS` это проверяют | В development допускается fallback на `AUTH_SECRET`. Старые токены можно расшифровать legacy-ключом `AUTH_SECRET`. Не кладите ключ в Git и не включайте его в backup-архив |
| `REDIS_URL` + `QUEUE_DRIVER=redis` | BullMQ | Задачи пишутся в PostgreSQL, диспетчер Redis не стартует |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_IMAGE_MODEL` | запасной AI-провайдер, если в кабинете нет подключённого провайдера | UI предлагает подключить ChatGPT; без ключа генерация не имитируется. Счётчик usage безлимитен (`0`) и не является бюджетом |
| `ADMIN_EMAILS` | Email через запятую → Superadmin при первом заходе в `/admin` | Админка пуста, пока роль не выдана |
| `EMAIL_API_KEY`, `EMAIL_API_URL`, `EMAIL_FROM` | Внешняя почта (verify/reset/invite и уведомления) | Без mailbox и без ключа письмо не отправляется |
| `STORAGE_DRIVER=s3` и `S3_*` | Объектное хранилище | Локальный диск или отказ загрузки |
| `TELEGRAM_PROXY_URL` | Исходящий HTTP(S) прокси до Bot API, если с VPS нет прямого доступа к `api.telegram.org` | Прямое HTTPS к Telegram |
| `AI_PROXY_URL` | Исходящий прокси только для OpenAI, если `api.openai.com` отвечает `unsupported_country` | Прямой доступ. Не берёт `TELEGRAM_PROXY_URL` |
| `VK_API_BASE_URL` | Корень VK API для агента наблюдения. Идёт напрямую, не через Telegram-прокси | `https://api.vk.ru` |
| `TELEGRAM_API_BASE_URL` | Корень Bot API без завершающего `/` | `https://api.telegram.org` |

Токен Telegram задаётся в кабинете, не в env. Глобальный bot token в окружении не используется.

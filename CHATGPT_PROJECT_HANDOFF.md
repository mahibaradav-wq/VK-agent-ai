# Пакет передачи проекта ChatGPT — Polka Social / «Дом по полочкам»

Документ собран **только по коду и документации этого checkout**. Значения секретов не читались и сюда не попали. Код приложения не менялся. Зависимости не ставились. Миграции, деплой и платные API в этом аудите не вызывались. Тесты в этом аудите **не запускались**.

| Поле | Значение |
|---|---|
| Репозиторий | https://github.com/mahibaradav-wq/VK-agent-ai |
| Ветка документа | `cursor/chatgpt-project-handoff-ee77` |
| Описываемый checkout | `cursor/vk-manual-fallback-ee77` @ `30516dd` |
| PR этой ветки (ручной VK fallback + CI) | https://github.com/mahibaradav-wq/VK-agent-ai/pull/42 |
| База стека PR #42 | `cursor/tg-one-post-vk-visual-ee77` (PR #41) |
| Публичный URL в `next.config.ts` | `https://24dom-po-polochkam.ru` |
| Кабинет | `https://24dom-po-polochkam.ru/app` |

**Что проверено HTTP-запросом в этом аудите (без логина и без платных API):**

- `GET https://24dom-po-polochkam.ru/api/health` → `{"ok":true,"db":"up"}`
- `GET https://24dom-po-polochkam.ru/login` → страница «Вход · Polka Social», вход email+пароль

**Что в этом аудите не проверялось:** точный git SHA на VPS, Studio, публикация VK/Telegram, OpenAI, ЮKassa, почта, SSH, Docker на хосте.

---

## 1. Назначение проекта

Продукт в README и UI называется **Polka Social**. Бренд контента — «Дом по полочкам» (`houseBrand` в `src/modules/brand/visual-standard.ts`). Это SaaS-кабинет для:

- черновиков постов под Telegram и стену ВКонтакте;
- генерации текста и картинки через ChatGPT (OpenAI API);
- идей со стен чужих сообществ VK (Watch);
- календаря, очереди публикации, ручной выкладки фото во ВК, если ключ клуба не умеет `photos.getWallUploadServer`;
- команды, ролей, согласования, биллинга ЮKassa, платформенной админки.

Маркетинговый сайт и кабинет живут в одном Next.js-приложении. Кабинет — `/app`.

---

## 2. Текущая архитектура

Монолит **Next.js 16.4.5 App Router** (Node 22), не Python/FastAPI. В этом дереве **нет** `.py` файлов. Упоминания FastAPI в `docs/architecture.md` и `docs/implementation-plan.md` — исторические; текущий код их не реализует.

```
Браузер
  → Next.js (App Router pages + Server Actions + 9 Route Handlers)
  → сервисы в src/modules/* (права workspace, бизнес-логика)
  → src/server/* (адаптеры: AI, VK, Telegram, storage, queue, mail, billing)
  → PostgreSQL (Prisma 6.12)
  → опционально Redis/BullMQ, S3, исходящие прокси
```

- UI: React 19, Tailwind 4, Server Components + client forms (`useActionState`).
- Сессия: Auth.js / NextAuth v5, JWT, Credentials (email+пароль). Middleware `src/middleware.ts` закрывает `/app` и `/admin`.
- Права: `src/modules/access/permissions.ts` + `createAccessService` + `assertWorkspaceBound`.
- Публикация: `PublishJob` в PostgreSQL; без `REDIS_URL` очередь inline (`src/server/queue/inline-queue.ts`); воркер `src/server/queue/worker.ts`.
- Соцсети: адаптеры `createVkAdapter` / `createTelegramAdapter`; без ключа — `unconfigured-adapter` с `integration_not_configured`, успех не имитируется.
- AI: OpenAI-compatible HTTP в `createOpenAiCompatibleProvider`; ключ workspace шифруется; запасной ключ из env.
- Хостинг по репозиторию: Docker (`Dockerfile`, `docker-compose.prod.yml`), Caddy HTTPS, скрипты `scripts/vps-up.sh` / `scripts/vps-pull.sh`. GitHub Actions `Deploy VPS` — только `workflow_dispatch`, без автодеплоя с PR.

---

## 3. Структура файлов

| Путь | Назначение |
|---|---|
| `src/app/` | Маршруты App Router: маркетинг, `/app` кабинет, `/admin`, `/api` |
| `src/app/app/` | Кабинет: studio, calendar, ideas, products, connections, balance |
| `src/components/app/` | UI кабинета (Studio, календарь, VK fallback, AI) |
| `src/modules/` | Доменные сервисы и `"use server"` actions |
| `src/server/` | Инфраструктура: AI, VK/Telegram API, crypto, queue, storage, billing |
| `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts` | Auth.js |
| `prisma/schema.prisma`, `prisma/migrations/` | PostgreSQL-схема |
| `docs/` | Архитектура, деплой, env, security (часть устарела относительно кода) |
| `.github/workflows/ci.yml` | PR: typecheck + lint + vitest, без деплоя |
| `.github/workflows/deploy-vps.yml` | Ручной SSH-деплой |
| `e2e/` | Playwright |
| `.env.example`, `.env.production.example` | Имена переменных. `.env` в gitignore |

Кабинетные редиректы (`src/modules/cabinet/nav.ts` → `cabinetRedirects`): `/app/ai` → `/app/studio`, `/app/watch` → `/app/ideas`, `/app/social-accounts` → `/app/connections`, `/app/posts` → `/app/studio`, `/app/analytics` и `/app/queue` → `/app/calendar`, `/app/media` → `/app/studio`, `/app/team`, `/app/subscription`, `/app/notifications` → `/app`.

---

## 4. Технологический стек

Из `package.json` (зависимости, не догадки):

- **Runtime:** Node.js 22 (Dockerfile `node:22-bookworm-slim`)
- **App:** `next@16.4.5`, `react@19.3.0`, `next-auth@5.0.0-beta.32`
- **DB:** `prisma@6.12.0`, `@prisma/client`, PostgreSQL 16
- **Auth:** `@auth/prisma-adapter`, `bcryptjs`
- **Queue:** `bullmq`, `ioredis`
- **Storage:** `@aws-sdk/client-s3` или локальный диск
- **HTTP:** `undici` (прокси OpenAI/Telegram)
- **Время:** `luxon`
- **Валидация:** `zod` (есть в зависимостях)
- **UI:** `tailwindcss@4`, `class-variance-authority`, `lucide-react`, `recharts`
- **Тесты:** `vitest@5.0.4`, `@playwright/test`
- **Нет пакета `openai` SDK.** Вызовы — `fetch` на OpenAI-compatible URL.

---

## 5. Функциональность и состояние

Легенда статуса:

- **Код + тесты в репозитории** — реализация есть, есть vitest. Живой прод в этом аудите не гонялся.
- **Только код** — реализация есть, отдельного теста нет или UI спрятан редиректом.
- **Заглушка / ограничение продукта** — код честно отказывает или не имитирует успех.
- **Прод (этот аудит)** — только health и login HTML.

| Функция | Статус | Где реализована | Что осталось / оговорки |
|---|---|---|---|
| Маркетинг (/, pricing, features, blog, FAQ) | Код есть | `src/app/page.tsx`, `src/app/pricing/page.tsx`, `src/lib/site-data.ts` | Живые страницы в этом аудите не разбирались дальше login |
| Регистрация / вход / сброс пароля | Код + тесты | `src/modules/auth/auth-service.ts`, `src/modules/auth/actions.ts`, `src/auth.ts` | Credentials JWT. Первый пользователь в production автоподтверждается (`shouldAutoVerifyEmail`). Прод: страница login открывается |
| Кабинет `/app` | Код + тесты изоляции | `src/app/app/page.tsx`, `src/middleware.ts` | Без сессии middleware режет. Сценарии Studio на проде не проверялись |
| Проекты | Код + тесты | `src/modules/projects/project-service.ts` | — |
| Студия: черновик + визуал + публикация | Код + тесты publishing/social/ai | `src/app/app/studio/page.tsx`, `src/components/app/studio-working-card.tsx`, `createAiService.composeAgentPost` | Нужны ключи OpenAI и соцсетей; платный OpenAI |
| Календарь | Код + тесты | `src/modules/calendar/calendar-service.ts`, `src/app/app/calendar/page.tsx` | Слоты с `requires_manual_check` показывают скачивание JPEG |
| Публикация Telegram | Код + тесты (мок транспорта) | `src/server/social/telegram-adapter.ts`, `createPublishService` | Живой Bot API в этом аудите не вызывался. Платный только если считать трафик Bot API |
| Публикация VK стена | Код + тесты (мок) | `src/server/social/vk-adapter.ts`, `src/modules/social/social-service.ts` `connectVk` | Ключ клуба часто не грузит фото → ручной JPEG. VK ID OAuth **в коде нет** |
| Ручной fallback VK фото | Код + тесты | `src/modules/social/vk-manual.ts`, `confirmManualVk` в `publish-service.ts`, `VkManualFallback` | Не публикует во ВК само; пользователь выкладывает руками |
| Watch / идеи со стен VK | Код + тесты | `src/modules/watch/watch-service.ts`, `/app/ideas` | Нужен сервисный/community ключ VK для чтения. Идеи идут в OpenAI (платно) |
| Товары (Ozon/WB/Маркет/Магнит) | Код + тесты | `src/modules/products/` | Парсинг URL; отправка в Студию |
| Подключения соцсетей | Код + тесты | `src/modules/social/social-service.ts`, `/app/connections` | Токены шифруются `encryptToken` |
| ChatGPT в кабинете | Код + тесты (мок fetch) | `createAiConnectionService.connect`, `/api/ai/connect` | Платный OpenAI. Пароль чата отклоняется |
| Агент пост+картинка | Код + тесты | `composeAgentPost` | Платный chat + images. Без ключа не выдумывает черновик |
| Видео в Студии | Код + тесты ffmpeg | `src/modules/ai/video-encode.ts` | Не Sora: несколько stills → MP4 через ffmpeg |
| Баланс OpenAI в навбаре | Код + тесты | `src/modules/ai/balance-service.ts`, `src/server/ai/balance.ts` | Платный billing API OpenAI; кэш 60 с |
| Согласование / команда | Код + тесты | `src/modules/collaboration/` | UI `/app/team` редиректит на `/app` — функции есть в сервисах и на карточке поста |
| Очередь публикации | Код + тесты | `createPublishService`, `src/server/queue/` | UI `/app/queue` → календарь. Worker отдельным процессом |
| Аналитика | Код + тесты | `src/modules/analytics/` | UI `/app/analytics` → календарь. Telegram: только подписчики (`getChatMemberCount`). VK метрики: «VK ID не подключён». Demo-ряды помечены |
| Медиатека | Код + тесты | `src/modules/media/`, `/api/media/[id]` | UI `/app/media` → studio. GET файла требует сессию |
| ЮKassa | Код + тесты подписи | `src/server/billing/yookassa.ts`, `/api/webhooks/billing` | Без ключей checkout не имитируется. UI подписки редирект на `/app` |
| Платформенная админка `/admin` | Код + тесты | `src/modules/admin/` | Только `PlatformAdmin` / `ADMIN_EMAILS` |
| Dev mailbox | Код + тесты | `src/server/mail/dev-mailbox.ts`, `/dev/mailbox` | **Не включать в production** (`AUTH_DEV_MAILBOX`) |
| Health | Прод подтверждён | `src/app/api/health/route.ts` | Живой сайт: `ok/db up` |

Платные внешние API: OpenAI (чат, картинки, models, credit grants), ЮKassa, опционально HTTP-почта, S3. VK и Telegram API при реальной публикации/чтении стен тоже ходят наружу (не OpenAI-тариф).

Бесплатно локально без ключей: регистрация, черновики, календарь, тесты с моками, отказ адаптеров без имитации успеха.

---

## 6. Подключение OpenAI API

### SDK

Пакета `openai` нет. Провайдер: `src/server/ai/openai-compatible.ts` → `createOpenAiCompatibleProvider`. HTTP через `createAiFetch()` (`src/server/http/outbound-fetch.ts`), опционально `AI_PROXY_URL` (не `TELEGRAM_PROXY_URL`).

Каталог провайдеров: `src/server/ai/catalog.ts`. **Единственный id: `"openai"`** (лейбл «ChatGPT (OpenAI)»). В тестах `src/modules/ai/provider.test.ts` провайдеры `deepseek` и `qwen` отклоняются.

### Модели (явно в коде)

| Назначение | Значение по умолчанию | Где |
|---|---|---|
| Текст | `gpt-4o-mini` | `aiProviderCatalog.model`, `AI_MODEL`, `createAiProviderFromEnv` |
| Картинка | `gpt-image-1.5` | `aiProviderCatalog.imageModel`, `AI_IMAGE_MODEL` |
| Устаревшие image | `dall-e-2` / `dall-e-3` в stored поле сбрасываются на spec | `currentImageModel` в `provider-service.ts` |

Размеры картинки: `1024x1024`, `1024x1536`, `1536x1024` (`src/server/ai/types.ts`, маппинг аспекта в `src/modules/ai/visual.ts`).

### Задачи AI

| Задача | Функция | HTTP |
|---|---|---|
| Проверка ключа при подключении | `probeAiApiKey` | `GET {baseUrl}/models` |
| Текст: ideas / post / headline / cta / hashtags | `AiProvider.generate` ← `createAiService.generate` | `POST {baseUrl}/chat/completions` |
| Агент пост + визуал | `createAiService.composeAgentPost` | chat + `images/generations` (N раз для карусели/видеокадров) |
| Правка карточки Студии | `createAiService.reviseStudioCard` | chat ± image |
| Идеи Watch | `createWatchService.collectIdeas` → AI kind `watch_ideas` | chat; в промпт попадают тексты постов VK |
| Картинка | `AiProvider.generateImage` | `POST {baseUrl}/images/generations` |
| Баланс ключа | `fetchAiBalance` | OpenAI dashboard/billing credit grants (см. `src/server/ai/balance.ts`) |

Точки входа UI/API:

- Server actions: `src/modules/ai/actions.ts` — `generateAi`, `composeAgentPost`, `reviseStudioCard`, `connectAiProvider`, `disconnectAiProvider`, `checkVisualModels`, `applyAiToPost`
- HTTP: `src/app/api/ai/connect/route.ts`, `src/app/api/ai/disconnect/route.ts`
- Watch: `src/app/api/watch/ideas/route.ts`, `src/app/api/watch/apply-idea/route.ts` (apply вызывает агента)

Резолв провайдера: `createAiConnectionService.resolveProvider` / `listProviders` — сначала `WorkspaceAiConnection`, если строк нет — env `getAiProvider()` из `AI_API_KEY`.

### Что уходит в запросах

**Chat (`generate`):** JSON `{ model, temperature: 0.7, max_tokens: copyMaxTokens(length), response_format: { type: "json_object" }, messages: [system, user] }`. System: правила длины из `copySystemRules`, тон, платформа (VK без markdown / Telegram caption), требование JSON `{"title","body","items"}`. User: бриф + хинт длины. Для `kind === "post"` при промахе длины — второй complete (rewrite). **`stream` в теле нет.**

Лимиты токенов/таймаута (`src/modules/brand/visual-standard.ts` `copyLengthSpec`): short 1800 / 45s, medium 3200 / 70s, long 5000 / 120s, caption 1200 / 45s.

**Images:** `{ model, prompt, n: 1, size }`; `response_format: b64_json` только если model начинается с `dall-e-`. Ответ: `b64_json` или HTTPS URL (скачивается). Байты > 8 МБ отклоняются (`MAX_MEDIA_BYTES`).

**Ключ:** заголовок `Authorization: Bearer …` только на сервере. В Public DTO ключ не отдаётся; тесты проверяют отсутствие `sk-` / `AI_API_KEY` в JSON.

### Ошибки

`src/server/ai/errors.ts`: регион `unsupported_country` → сообщение про хостинг в ЕС; 401/403 на probe → «нужен API-ключ, не пароль»; баланс → `AI_BALANCE_MESSAGE`. Пустой chat / битый image — `AccessError 400`. Регион запоминается в `WorkspaceAiConnection.lastError` (`rememberError`).

Потоковой генерации (SSE/`stream: true`) **нет**.

### Лимиты стоимости / количества

- `createAiService` `DEFAULT_MONTHLY_LIMIT = 0`. `isUnlimitedUsage(limit)` считает `<= 0` безлимитом (`src/modules/billing/usage.ts`). `resolveLimit` **не читает** `Plan.aiGenerations`.
- `AI_MONTHLY_LIMIT` есть в `docs/environment.md` и `.env.example` комментарии, **в `src/` не используется** (grep пустой).
- Каталог тарифов всё ещё содержит `aiGenerations: 50/500/5000` в `src/modules/billing/plans.ts` — это не подключено к `createAiService`.
- Учёт `UsageRecord` metric `ai_generations` всё равно инкрементируется (`reserveUsage`), но при limit 0 не блокирует.
- `max_tokens` и таймауты — единственные жёсткие лимиты вызова модели в коде.

### Переменные ключа (имена, не значения)

| Имя | Назначение |
|---|---|
| `AI_API_KEY` | Запасной ключ OpenAI на процесс, если в кабинете нет connection |
| `AI_BASE_URL` | По умолчанию `https://api.openai.com/v1` |
| `AI_MODEL` | По умолчанию `gpt-4o-mini` |
| `AI_IMAGE_MODEL` | По умолчанию `gpt-image-1.5` |
| `AI_PROXY_URL` | Исходящий прокси только для AI fetch |
| `TOKEN_ENCRYPTION_KEY` (иначе `AUTH_SECRET`) | AES-256-GCM для ключа в `WorkspaceAiConnection.encryptedApiKey` |

Где должен храниться ключ кабинета: таблица `WorkspaceAiConnection.encryptedApiKey`, запись через `createAiConnectionService.connect` после `probeAiApiKey`. Env-ключ — только `.env` / `.env.production` на сервере, файлы в `.gitignore`.

Серверные функции, которые **читают** ключ (расшифровка или env), не отдают его клиенту: `createOpenAiCompatibleProvider`, `probeAiApiKey`, `createAiProviderFromEnv`, `createAiBalanceService`, `providerFromRow` в `provider-service.ts`.

**Может ли ключ попасть в браузер?** В коде отдачи `encryptedApiKey` / raw key во frontend нет. `PublicAiConnection` содержит `hasKey: boolean`. Риск: включённый `AUTH_DEV_MAILBOX` на проде (другие токены писем), логи ошибок провайдера (код режет `sk-` из message), утечка `.env`. `NEXT_PUBLIC_*` есть только `NEXT_PUBLIC_SITE_URL` — не ключ.

**Переиспользование в другом проекте:** да, как HTTP-обёртка OpenAI-compatible: файлы `src/server/ai/openai-compatible.ts`, `catalog.ts`, `probe.ts`, `errors.ts`, `index.ts`, плюс шифр `token-cipher.ts`. Кабинетный слой (`provider-service`, `ai-service`, Prisma-модель) привязан к workspace. Не тащить ключ на клиент. Нужен хостинг, с которого OpenAI не отвечает `unsupported_country` (в комментариях — ЕС / Amsterdam).

---

## 7. Переменные окружения (только имена)

Обязательные для сайта: `DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_SITE_URL`, `AUTH_URL`. Для Docker/Caddy: `SITE_DOMAIN`, `ACME_EMAIL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`.

Опциональные: `AUTH_DEV_MAILBOX`, `STORAGE_DRIVER`, `LOCAL_STORAGE_DIR`, `TOKEN_ENCRYPTION_KEY`, `QUEUE_DRIVER`, `REDIS_URL`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`, `AI_IMAGE_MODEL`, `AI_PROXY_URL`, `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`, `BILLING_WEBHOOK_SECRET`, `ADMIN_EMAILS`, `EMAIL_API_KEY`, `EMAIL_API_URL`, `EMAIL_FROM`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_FORCE_PATH_STYLE`, `TELEGRAM_PROXY_URL`, `TELEGRAM_API_BASE_URL`, `VK_API_BASE_URL`, `FFMPEG_PATH`, `HTTPS_PROXY`, `SITE_URL`.

`AI_MONTHLY_LIMIT` документирован, в коде не читается.

Токены Telegram/VK/OpenAI кабинета в env **не** кладутся (кроме запасного `AI_API_KEY`).

---

## 8. База данных

PostgreSQL через Prisma (`datasource db` → `env("DATABASE_URL")`). Миграции в `prisma/migrations/` (последняя в этом checkout: `20261123220000_post_requires_manual_check` — значение enum `PostStatus.requires_manual_check`).

Основные сущности:

- `User`, `Account`, `Session`, `PasswordResetToken`, `VerificationToken`
- `Workspace`, `WorkspaceMember` (роли Owner/Admin/Editor/Approver/Viewer)
- `Project`, `ProjectAccess`
- `Post`, `PostVersion`, `PostTarget`, `PostMedia`, `Schedule`
- `MediaAsset`
- `SocialAccount`, `SocialAccountCapability`
- `PublishJob`, `PublishAttempt`
- `AIRequest`, `WorkspaceAiConnection`, `UsageRecord`
- `VkWatchCommunity`, `VkWatchCredential` (дальше по schema)
- `ShopProduct`, `ShopPartnerCredential`
- `AnalyticsSnapshot`
- `Invitation`, `Comment`, `Approval`, `Notification`, `AuditLog`
- `Plan`, `Subscription`, `CheckoutSession`, `PaymentEvent`
- `PlatformAdmin`
- `DevMailMessage`

Связи: Post → Workspace/Project/User; targets и media к Post; jobs к Post+PostVersion; AI connection unique `(workspaceId, provider)`.

---

## 9. Интеграции

| Сервис | Как | Файлы |
|---|---|---|
| OpenAI | HTTP compatible | `src/server/ai/` |
| Telegram Bot API | `createTelegramTransport` | `src/server/social/telegram-api.ts` |
| VK API `api.vk.ru` | `createVkTransport`, без Telegram-прокси | `src/server/social/vk-api.ts` |
| VK ID OAuth 2.1 | Только в `docs/social-platforms.md` | **Реализации в `src/` нет** |
| ЮKassa | checkout + webhook | `src/server/billing/yookassa.ts` |
| S3 | если `STORAGE_DRIVER=s3` | `src/server/storage/s3-storage.ts` |
| Redis/BullMQ | если `REDIS_URL` | `src/server/queue/bullmq-queue.ts` |
| ffmpeg | JPEG для VK, слайдшоу MP4 | `jpeg-encode.ts`, `video-encode.ts` |
| HTTP email | если `EMAIL_API_KEY` | `src/server/notifications/http-email.ts` |
| Caddy / Let's Encrypt | compose prod | `deploy/Caddyfile`, `docker-compose.prod.yml` |

---

## 10. Безопасность и риски

Не исправлялось. Приоритет — оценка по коду, не pentest прода.

| Риск | Приоритет | Факт |
|---|---|---|
| CSP `script-src 'unsafe-inline' 'unsafe-eval'` | Средний | `src/server/security/headers.ts`; зафиксировано в `docs/security.md` |
| Rate limit логина в памяти процесса | Средний | `src/server/security/rate-limit.ts` `Map`; несколько инстансов не делят счётчик |
| `AUTH_DEV_MAILBOX=true` на проде | Высокий, если включён | Письма с токенами на `/dev/mailbox`. В `.env.production.example` явно запрещено. **Включён ли флаг на VPS — в этом аудите неизвестно** |
| Health без авторизации | Низкий | Только `{ok, db}` |
| Секреты в клиентском бандле | Низкий по коду | `NEXT_PUBLIC_SITE_URL` — единственный `NEXT_PUBLIC_`. Ключи AI/VK/TG не с этим префиксом |
| Подмена workspaceId | Закрыто тестами | `assertWorkspaceBound`, `src/modules/access/isolation.test.ts` |
| Пароли соцсетей | Отклоняются | `rejectPassword` в social/watch |
| Токены соцсетей и AI | AES-256-GCM | `encryptToken` / `decryptToken` |
| Billing webhook | HMAC | `src/server/billing/`; redirect не делает paid |
| Server Actions origins | Список хостов | `next.config.ts` `serverActions.allowedOrigins` из SITE_URL + localhost |
| Логи | Низкий/средний | `watch.apply-idea` логирует `userId`, `requestId`, `itemIndex`, текст ошибки без ключа. Worker логирует ошибки job |
| CORS | Не настроен отдельно | Отдельного CORS middleware нет; same-origin + CSP `connect-src 'self'` |
| VK photo access | Продукт | Ключ сообщества → ручная выкладка, не silent fail |
| JWT Credentials | Средний (модель) | Нет 2FA, нет VK ID login |
| `experimental.agentUpgrade: "security"` | Инфо | `next.config.ts`; Next 16.4.5 |

Авторизация API: `/app` и `/admin` — сессия. `/api/media/[id]`, `/api/ai/*`, `/api/watch/*` — `auth()`. `/api/health` открыт. `/api/webhooks/billing` — подпись, не сессия. `/api/subscription` — смотреть перед изменениями (не разбирался построчно в этом файле: путь `src/app/api/subscription/route.ts`).

Валидация: email regex, токены VK/Telegram форматом, `looksLikeApiKey` (`sk-...`), Zod в зависимостях (не везде). Длины постов и media mime проверяются сервером.

---

## 11. Тестирование

**В этом аудите тесты не запускались** (могли писать в локальную PostgreSQL).

Существующие автотесты (50 файлов `*.test.ts` под `src/`, vitest `fileParallelism: false`, exclude `e2e/`):

- access, admin, ai (ai, provider, visual, video, balance), analytics, auth, billing, brand, calendar, collaboration, e2e/critical-path, media, posts, products, projects, publishing, social, watch
- server: ai probe/balance, billing yookassa, crypto, db migrations, http outbound, mail, rate-limit, secrets, telegram/vk api, hosting stack

Playwright: `e2e/auth-ui.spec.ts`, `e2e/cabinet-smoke.spec.ts`, `e2e/http.spec.ts`. Нужен живой `next start` (`playwright.config.ts`). Могут ходить в локальное приложение и БД — в этом аудите не запускались.

CI: `.github/workflows/ci.yml` — `prisma migrate deploy` + `typecheck` + `lint` + `npm test` на PR. Deploy workflow тесты не запускает.

**Сведения с той же ветки до этого аудита (не повтор этого прогона):** локально 220 vitest, typecheck, eslint, `next build` 16.4.5; GitHub check **Test** на `30516dd` conclusion `success` (2026-11-23 19:34 UTC). Это не доказательство текущего прода.

Без платных API: vitest с мок-`fetch`/`scriptedVk`/`scriptedTelegram`. Не вызывать e2e против продакшена. Не гонять тесты, которые ходят в реальный OpenAI — в ai.test.ts fetch подменяется; если подменить нельзя, не запускать.

---

## 12. Известные ошибки и долги

Подтверждены кодом / тестами репозитория, не «живым багом прода»:

1. Ключ сообщества VK часто не вызывает `photos.getWallUploadServer` (ошибки 27/200) → пост паркуется в `vk_manual_photo`, Telegram может уйти сам.
2. VK ID OAuth в приложении отсутствует — пользовательский ключ админа вставляется вручную.
3. Аналитика VK не собирается (явная причина в `platformMetricAvailability`).
4. UI аналитики/очереди/команды/подписки спрятан редиректами; сервисы остаются.
5. Лимит AI тарифа в `PLAN_CATALOG` не применяется в `createAiService`.
6. Документация FastAPI и `AI_MONTHLY_LIMIT` расходится с кодом.
7. In-memory rate limit и CSP unsafe-eval.
8. Видео — склейка картинок ffmpeg, не генерация ролика моделью.
9. Стек GitHub PR длинный (много `cursor/*-ee77`); FastAPI-ветка в списке агента **не** этот checkout.
10. Несовпадение «что на VPS» и «что в `30516dd`» этим аудитом **не установлено**.

Исправления аудита PR #42 уже в описываемом SHA: leftover `confirmManualVk` job; error 200 → manual; mixed TG/VK → `requires_manual_check`; `toVkWallText` вынесен; connect без `wall.post`; Next 16.4.5; CI.

---

## 13. Что уже сделано

- Next.js SaaS-кабинет с PostgreSQL, ролями, Studio, календарём, публикацией TG/VK.
- OpenAI-only провайдер, ключ в БД шифруется, без ключа нет фейковой генерации.
- Watch идей VK + отправка в агент.
- Ручной JPEG для ВК, когда ключ клуба не грузит фото.
- ЮKassa-каркас, админка, health, Docker/Caddy доки, CI на PR.
- Живой домен отвечает health и показывает login Polka Social.

---

## 14. Что осталось сделать

По коду и докам, без оценки календаря:

- Сверить SHA на VPS с `cursor/vk-manual-fallback-ee77` (нужен доступ к хосту; этот аудит его не имел).
- Решить, нужен ли VK ID OAuth вместо ручной вставки user-ключа.
- Либо починить загрузку фото ключом клуба (ограничение VK API), либо оставить ручной поток как основной.
- Вернуть или явно выкинуть AI monthly limit / plan.aiGenerations.
- Решить судьбу спрятанных экранов (аналитика, команда, подписка).
- Обновить `docs/architecture.md` (убрать FastAPI как текущий стек).
- Настроить мониторинг/бэкапы — в коде продукта их нет.
- Не мержить PR #42, пока не просмотрен родитель #41 (как в описании PR).

---

## 15. Рекомендуемый порядок дальнейшей разработки

1. Прочитать этот файл и `prisma/schema.prisma`.
2. Не путать FastAPI-ветки с этим Next.js checkout.
3. Не коммитить `.env`. Не логировать ключи.
4. Для фич кабинета идти от `src/app/app/studio/page.tsx` и `createPublishService` / `createAiService`.
5. Для OpenAI — только `src/server/ai/*` + `provider-service.ts`; не тащить SDK, пока не решите заменить fetch.
6. Любую публикацию VK/TG и генерацию — сначала vitest с моками, без живых постов и без платного ключа в CI.
7. Деплой Timeweb — только ручной workflow, не из PR CI.
8. Перед сменой провайдера AI проверить `aiProviderIds` (сейчас только openai).

---

## 16. Какие файлы изучить первыми

1. `CHATGPT_PROJECT_HANDOFF.md` (этот файл)
2. `prisma/schema.prisma`
3. `src/auth.ts`, `src/middleware.ts`, `src/modules/access/permissions.ts`
4. `src/app/app/studio/page.tsx`, `src/components/app/studio-working-card.tsx`
5. `src/modules/ai/ai-service.ts`, `src/modules/ai/provider-service.ts`, `src/server/ai/openai-compatible.ts`, `src/server/ai/catalog.ts`
6. `src/modules/publishing/publish-service.ts`, `src/server/social/vk-adapter.ts`, `src/modules/social/vk-manual.ts`
7. `src/modules/social/social-service.ts` (`connectVk`)
8. `src/modules/watch/watch-service.ts`
9. `src/modules/cabinet/nav.ts`
10. `.env.example`, `docs/environment.md`, `docs/deploy.md`, `docs/security.md`
11. `.github/workflows/ci.yml`

Не начинать с `docs/architecture.md` как с истины по стеку: там ещё FastAPI mock.

---

## Приложение A. Маршруты App Router

Кабинет (после логина): `/app`, `/app/studio`, `/app/calendar`, `/app/ideas`, `/app/products`, `/app/connections`, `/app/balance`. Редиректы см. §3.

API: `/api/health`, `/api/auth/[...nextauth]`, `/api/media/[id]`, `/api/ai/connect`, `/api/ai/disconnect`, `/api/watch/ideas`, `/api/watch/apply-idea`, `/api/webhooks/billing`, `/api/subscription`.

Админка: `/admin`, `/admin/users`, `/admin/workspaces`, `/admin/plans`, `/admin/integrations`, `/admin/queues`, `/admin/errors`, `/admin/audit`.

---

## Приложение B. Как отличить подтверждение от наличия кода

| Утверждение | Основание |
|---|---|
| Приложение на домене живое, БД с того инстанса отвечает | HTTP health 2026-11-23 |
| Это тот же git SHA, что `30516dd` | **Не подтверждено** |
| OpenAI на проде подключён и генерирует | **Не подтверждено** |
| Посты уходят в Telegram/VK с прода | **Не подтверждено** |
| Vitest 220 зелёных | Предыдущий прогон той же ветки, не этот аудит |
| CI Test success | GitHub check на `30516dd`, не повтор |

Конец документа. Значений ключей, паролей и токенов здесь нет.

# PR #73 — Единый интеграционный аудит Polka Social

Стек: #63 → … → #72 → **#73**. Базовая ветка: `cursor/pr72-spool-fsync-restart-ee77`.

- **Исходный HEAD (PR #72):** `79f8e44c6d51706a4e79b7a954a2b75e0d958851` (`cursor/pr72-spool-fsync-restart-ee77`)
- **Рабочая ветка:** `cursor/pr73-full-integration-audit-ee77`
- **Коммит кода, тестов и `test:full`:** `8f960eedf98008bfef97d4736e0d962aba5f0199`
- **Исправление таймаута CI в `migrations.test.ts` и актуализация отчёта:** поверх `c2a3de871659b1b8d08684b185e3c4670289e5e4` (точный SHA нового итогового HEAD приводится в финальном ответе и обновляется в PR #73).

---

## 1. Блок A — Матрица покрытия по всем 10 подсистемам

До начала доработок изучены `package.json`, `vitest.config.ts`, `playwright.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/vps-readiness.yml`, `prisma/schema.prisma`, 64 файла Vitest, 4 файла Playwright E2E, `scripts/tests/vps-ops.test.sh` и отчёты PR #63–#72 (`docs/pr*.md`).

| № | Подсистема | Существующее покрытие (до PR #73) | Выявленные пробелы (Блок A) | Закрыто в PR #73 |
|---|---|---|---|---|
| 1 | **Авторизация и сессии** | `auth-service.test.ts`, `session-token.test.ts`, `session-invalidation.integration.test.ts`, `e2e/auth-ui.spec.ts`, `e2e/session-invalidation.spec.ts` | Не проверялись `logoutUser`, поведение Node `auth()` и API-маршрутов при отказе БД, сквозная защита всех Server Actions и `/api/ai/*`, `/api/watch/*`, `/api/media/[id]` | `b1-b2-auth-projects-integration.test.ts`, фикс **D1** + регрессия в `e-defects-regression.test.ts` |
| 2 | **Пользователи и workspace** | `isolation.test.ts`, `permissions.test.ts`, `collaboration.test.ts`, `admin.test.ts` | Не было интеграционной проверки переключения контекста (`selectWorkspace`/`selectProject`), `addWorkspaceMember` и `grantPlatformAdmin` через Server Actions при меж-workspace атаках | `b1-b2-auth-projects-integration.test.ts` |
| 3 | **Проекты и архивирование** | `project-service.test.ts` (лимит 10, гонка создания, базовый архив/восстановление) | Не тестировалась параллельная гонка `restore` около лимита 10 и сквозной запрет операций на архивном проекте (`composeAgentPost`, `reviseStudioCard`, `schedule`, `enqueue`, `publishNow`, `createRequiresSetup`) | `b1-b2-auth-projects-integration.test.ts` |
| 4 | **AI и лимиты** | `live-guard.test.ts`, `ai.test.ts`, `provider.test.ts`, `ai-usage-accounting.test.ts`, `http-response-billing.test.ts`, `billing-classification.test.ts` | Существующие тесты передавали `{ provider }` или `{ connections }`, что выставляло `skipPaidGate = true` — сквозной реальный цикл без обхода gate до HTTP spy не проверялся | `b3-ai-full-cycle-integration.test.ts` (локальный `node:http` OpenAI spy-сервер без `provider`/`connections` override) |
| 5 | **AI overage и spool** | `overage-atomicity.test.ts`, `overage-recovery.test.ts`, `fail-closed-recovery.test.ts` | Не было интеграции полного цикла HTTP spy → отказ БД на перерасходе → повреждённый/симлинк spool → fail-closed блокировка → восстановление → разблокировка + параллельные запросы около лимита | `b3-ai-full-cycle-integration.test.ts` |
| 6 | **VK и Telegram** | `publish-live-guard.test.ts`, `vk-api.test.ts`, `telegram-api.test.ts`, `social.test.ts`, `publish.test.ts` (мок-адаптеры) | `publish.test.ts` использовал мок-адаптеры вместо реальных `createVkAdapter`/`createTelegramAdapter` и штатных транспортов; не было сквозной проверки «нет расшифровки токена при выключенном `SOCIAL_PUBLISH_LIVE`», «нет глобального fallback токена» и архивирования проекта во время публикации | `b4-b5-social-worker-integration.test.ts` (локальные HTTP spy-серверы через `VK_API_BASE_URL` и `TELEGRAM_API_BASE_URL`) |
| 7 | **Очередь и worker** | `publish.test.ts` (блокировка job, идемпотентность, retry, `parkStalePublishJobs`), `worker-log.test.ts` | `src/server/queue/worker.ts` не тестировался вообще; не защищался от перекрывающихся `tick()`, преждевременного `$disconnect()` во время активного `tick()`, а также не тестировался `createQueueFromEnv` (`unconfigured` без `REDIS_URL`) | `b4-b5-social-worker-integration.test.ts`, фикс **D2** + регрессия в `e-defects-regression.test.ts` |
| 8 | **Медиа и хранилище** | `file-validation.test.ts`, `local-storage.test.ts` | Не было тестов `createMediaService`, `/api/media/[id]` (401/404 изоляция, 8/32 МБ, MIME/расширение), удаления физического файла на диске и реакции адаптеров VK/TG; `local-storage.ts` принимал ключ `"."` и не блокировал симлинки | `b6-b7-media-commercial-integration.test.ts`, фикс **D3** + регрессия в `e-defects-regression.test.ts` |
| 9 | **Миграции БД** | `src/server/db/migrations.test.ts` (проверял только количество строк `_prisma_migrations`) | Не проверялись `prisma validate`, идемпотентность повторного `prisma migrate deploy`, число таблиц/FK/уникальных индексов и отсутствие дрейфа (`prisma migrate diff --exit-code`) | Расширен `src/server/db/migrations.test.ts` + аудит Блока C |
| 10 | **API и Server Actions** | `cabinet.test.ts`, `e2e/http.spec.ts` | Отсутствовали прямые интеграционные тесты `/api/health` (DB up/down → 503), `/api/media/[id]`, `/api/ai/connect`, `/api/ai/disconnect`, `/api/watch/ideas`, `/api/watch/apply-idea` и основных Server Actions | `b1-b2-auth-projects-integration.test.ts`, `b6-b7-media-commercial-integration.test.ts` |

---

## 2. Найденные и исправленные дефекты (Блок E)

| ID | Критичность | Дефект | Исправление (минимальное) | Регрессионный тест |
|---|---|---|---|---|
| **D1** | **Серьёзный** | В `src/auth.ts` callback `jwt` вызывал `loadUserSessionVersion` без `try/catch`, а в `src/app/api/media/[id]/route.ts` запрос `prisma.mediaAsset.findUnique` выполнялся вне `try/catch`. При недоступности PostgreSQL Node `auth()` и `/api/media/[id]` падали необработанным исключением (500) вместо безопасного fail-closed. | В `src/auth.ts` запрос версии сессии обёрнут в `try/catch` с возвратом `{}` (fail closed). В `src/app/api/media/[id]/route.ts` запрос `mediaAsset.findUnique` обёрнут в `try/catch` с ответом `503`. | `e-defects-regression.test.ts` (`D1`) |
| **D2** | **Серьёзный** | В `src/server/queue/worker.ts` обработчик `shutdown()` вызывал `clearInterval` и сразу `prisma.$disconnect()` / `process.exit(0)`, не дожидаясь выполняющегося `tick()`; отсутствовала single-flight защита от наложения `tick()`, а `void main()` запускался при импорте модуля. | Выделен `createWorkerLoop` с single-flight защитой (`activeTick`), флагом `stopping`, идемпотентным `shutdown()`, ожидающим завершения активного `tick()` до закрытия BullMQ/Redis/Prisma, и запуском `main()` только при прямом CLI-запуске (с сохранением `assertProductionCabinetGuards` и `sanitizeDiagnosticError`). | `e-defects-regression.test.ts` (`D2`) + `worker-log.test.ts` + `production-stack.test.ts` |
| **D3** | **Средний** | В `src/server/storage/local-storage.ts` проверка `if (fullPath !== root && !fullPath.startsWith(prefix))` разрешала ключ `"."` (`fullPath === root`), а `get`/`put` не проверяли символические ссылки, выводящие за пределы `rootDir`. | Запрещён ключ на корень (`!fullPath.startsWith(prefix)` → `AccessError(400)`), добавлена проверка `lstat`/`realpath` для файла и существующих предков пути в `put` и `get`. | `e-defects-regression.test.ts` (`D3`) + `local-storage.test.ts` |
| **D4** | **Незначительный** | В `src/modules/posts/post-service.ts` метод `posts.create` вызывал `reserveUsage` в `$transaction` без предварительной блокировки `lockWorkspaceMetric(tx, workspaceId, USAGE_METRICS.posts)`, что создавало риск гонки `P2002` при первом параллельном создании поста в начале месяца. | В `posts.create` перед `reserveUsage` добавлен `await lockWorkspaceMetric(tx, workspaceId, USAGE_METRICS.posts)`. | `e-defects-regression.test.ts` (`D4`) |

### Зафиксированные ограничения области (не исправлялись в PR #73)

В соответствии с правилом «не добавлять новые пользовательские функции и не менять архитектуру без необходимости»:

1. **Смена пароля по старому паролю из ЛК:** в текущем кабинете отсутствует отдельный UI/Server Action для смены пароля авторизованным пользователем по старому паролю — реализован только сброс пароля через `requestPasswordReset` / `resetPassword` (с инкрементом `sessionVersion` и инвалидацией всех старых сессий). Потребует отдельной продуктовой задачи, если такая форма понадобится.
2. **Удаление загруженных медиафайлов и GC хранилища:** `StorageDriver` реализует только `put`/`get`; пользовательского API/Action удаления медиа из UI нет. В PR #73 проверена безопасная реакция системы (`404` в `/api/media/[id]`, `media_missing` в адаптерах) при физическом отсутствии файла на диске.

---

## 3. Новые и обновлённые тесты

- `src/modules/audit/b1-b2-auth-projects-integration.test.ts` — Блок B1 и B2: сброс пароля и инвалидация старой cookie на Server Actions, удаление пользователя (fail closed), `logoutUser`, защита API-маршрутов и Server Actions от неавторизованного и меж-workspace доступа, 503 при отказе БД в `/api/health` и `/api/auth/session-check`, лимит 10 активных проектов, параллельные `create` и `restore` около лимита, изоляция и полный запрет операций для архивного проекта.
- `src/modules/audit/b3-ai-full-cycle-integration.test.ts` — Блок B3: сквозной реальный контур без обхода `skipPaidGate` (`AI_LIVE_ENABLED="true"`, `AI_MONTHLY_HARD_LIMIT`, локальный `node:http` OpenAI spy): отключение AI → `AI_PAID_DENIED` (0 HTTP), полный цикл (резерв → HTTP spy → БД → расчёт → аудит), отказ при нехватке резерва (0 HTTP), `ECONNREFUSED` до отправки (0 единиц), обрыв сокета после POST (1 единица), HTTP 200 с битым JSON (1 единица), ошибка ссылки изображения (биллинг без сохранения медиа), отказ БД при фиксации перерасхода → spool → повреждённый/симлинк spool → `AiAccountingPendingError` (0 HTTP) → восстановление → разблокировка, параллельные запросы около лимита.
- `src/modules/audit/b4-b5-social-worker-integration.test.ts` — Блок B4 и B5: реальные `createVkAdapter`/`createTelegramAdapter` против локальных HTTP spy-серверов (`VK_API_BASE_URL`, `TELEGRAM_API_BASE_URL`): строгий `SOCIAL_PUBLISH_LIVE === "true"`, отсутствие расшифровки токена и сетевых запросов при выключенном флаге, привязка аккаунта к проекту без глобального fallback токена, ручная и отложенная публикация, временная/постоянная ошибка, обрыв сокета → `requires_manual_check` и запрет слепого повтора, блокировка параллельной обработки одного `PublishJob`, восстановление зависшего задания (`parkStalePublishJobs`), архивирование проекта во время публикации, отказ `unconfigured` очереди без `REDIS_URL`.
- `src/modules/audit/b6-b7-media-commercial-integration.test.ts` — Блок B6 и B7: локальное хранилище без `S3_*`, ограничения 8 МБ / 32 МБ, проверка MIME и расширения, изоляция и 404 для чужого workspace на `/api/media/[id]`, защита от path traversal, обработка отсутствующего файла на диске через API и адаптеры VK/TG, `410` на `/api/subscription` и `/api/webhooks/billing` и отказ checkout-actions.
- `src/modules/audit/e-defects-regression.test.ts` — регрессии D1–D4.
- `src/server/db/migrations.test.ts` — расширена проверка чистой БД (добавлены `prisma validate`, повторный идемпотентный `prisma migrate deploy`, проверка количества таблиц/FK/уникальных индексов/индексов и `prisma migrate diff --exit-code`).

---

## 4. Единый запуск `test:full` и результаты проверок (Блоки C и D)

Добавлены `scripts/test-full.sh` и npm-скрипт `"test:full": "bash scripts/test-full.sh"` в `package.json`.
Скрипт выполняет 12 этапов последовательно без маскировки ошибок (с проверкой безопасности, что `DATABASE_URL` указывает только на локальную тестовую БД) и печатает единый отчёт при завершении или сбое. Для воспроизводимости на чистом checkout этап `Production build` выполняется непосредственно перед `Playwright E2E` (так как `playwright.config.ts` запускает `npm start`).

### Аудит чистой PostgreSQL (Блок C)

Проверено на чистой изолированной БД `polka_audit_clean` + shadow БД `polka_audit_shadow`:
- `prisma validate`: schema valid.
- `prisma migrate deploy` (1-й запуск): применены все **19 миграций** (`20261012193101_init_auth` … `20261126000000_ai_overage_settlement`).
- Структура в PostgreSQL: **41 таблица** (40 доменных + `_prisma_migrations`), **71 внешний ключ**, **70 уникальных индексов**, **98 индексов**.
- Прогон `npx vitest run src/modules/audit/` по чистой БД: **4/4 файла, 11/11 тестов — PASS**.
- Повторный `prisma migrate deploy`: `No pending migrations to apply.`
- `prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url ... --exit-code`: `-- This is an empty migration.` (exit 0).
- `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`: `-- This is an empty migration.` (exit 0).

### Полный прогон `npm run test:full` после исправлений Блока E и CI-таймаута `migrations.test.ts`

| Этап | Команда / проверка | Результат | Время |
|---|---|---|---|
| 1 | Clean test PostgreSQL (`polka_social` reset on `localhost:5432`) | **PASS** | 0s |
| 2 | `npx prisma generate` | **PASS** | 1s |
| 3 | `npx prisma validate` | **PASS** | 1s |
| 4 | `npx prisma migrate deploy` (19 миграций) | **PASS** | 1s |
| 5 | `npm run typecheck` (`tsc --noEmit`) | **PASS** | 2s |
| 6 | `npm run lint` (`eslint .`) | **PASS** | 6s |
| 7 | `npm test` (Vitest: **68 файлов, 427 тестов**) | **PASS** | 130s |
| 8 | `npm run test:vps` (`scripts/tests/vps-ops.test.sh`: **108 проверок**) | **PASS** | 6s |
| 9 | `npm run build` (`next build`, 62 маршрута) | **PASS** | 5s |
| 10 | `npm run test:e2e` (Playwright: **12/12 тестов**) | **PASS** | 18s |
| 11 | `bash -n` для 9 VPS/test-full shell-скриптов | **PASS** | 0s |
| 12 | `git grep` по отслеживаемым файлам на секреты | **PASS** | 0s |
| **Итог** | `OVERALL: PASS (12 stages)` | **PASS** | ~170s |

---

## 5. Статус CI / VPS readiness и оставшиеся ограничения

- **GitHub CI и VPS readiness (предыдущий коммит `c2a3de871659b1b8d08684b185e3c4670289e5e4`):**
  - `CI / Test` ([run 45945108550](https://github.com/mahibaradav-wq/VK-agent-ai/actions/runs/45945108550)): **PASS**.
  - `VPS readiness / Readiness checks` ([run 45945108452](https://github.com/mahibaradav-wq/VK-agent-ai/actions/runs/45945108452/job/140327908965)): **FAIL** — единственный сбой в `src/server/db/migrations.test.ts` (`Error: Test timed out in 5000ms`, фактическое время 5242ms из-за 4 последовательных вызовов `npx prisma` в одном `it`-блоке). Исправлено минимально добавлением явного таймаута `30_000` мс в `it(..., 30_000)` в `src/server/db/migrations.test.ts` без ослабления проверок.
- **Текущий запуск CI / VPS readiness:** перезапускается автоматически после push исправления в ветку `cursor/pr73-full-integration-audit-ee77`.
- **Что НЕ проверено на реальном VPS (вне рамок локального аудита и строго запрещено правилами PR #73):**
  1. Боевые сетевые запросы к внешним API OpenAI, VK API (`api.vk.com`) и Telegram Bot API (`api.telegram.org`) — все проверки выполнены только против локальных `node:http` spy-серверов.
  2. Работа очереди `BullMQ` / `IORedis` против реального процесса Redis (проверены `inline`, `unconfigured` и PostgreSQL polling / `createWorkerLoop`).
  3. Боевой стек Docker Compose + Caddy + TLS/HTTPS + DNS домена + реальный `.env.production` + backup/restore на реальном диске VPS (проверено только на изолированном probe-стенде в `vps-ops.test.sh`).
  4. Хранилище S3 (проверена только работа локального `StorageDriver` без переменных `S3_*`; реальный S3-совместимый бакет не подключался).

## Подтверждение соблюдения ограничений

В ходе работы не выполнялись: merge PR (#63–#73), deploy, SSH или обследование VPS, подключение к production DB, чтение/вывод/изменение production `.env` и секретов, реальные платные запросы к AI-провайдерам, реальные публикации в VK/Telegram, удаление существующих миграций или ослабление защитных механизмов.

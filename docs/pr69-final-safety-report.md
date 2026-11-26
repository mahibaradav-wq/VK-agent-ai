# PR #69: финальная безопасность (AI overage recovery, default-off публикации, аудит)

Стек: #63 → #64 → #65 → #66 → #67 → #68 → **#69**. Base: `cursor/pr68-ai-overage-atomicity-ee77`.

- Базовый SHA (PR #68): `7a33102e0e866f796a6f65512a43886c643eeed1`
- Ветка: `cursor/pr69-final-safety-ee77`
- Коммит с кодом, миграцией и тестами: `820b0b4731635bed602862bd6516a061e3f0957c`
- Итоговый HEAD: коммит с этим отчётом, следующий за `820b0b4`. Точный SHA и ссылки на GitHub Actions зафиксированы в описании PR #69 и в копии отчёта в store (`docs/pr69-report.md`).

---

## БЛОК A. AI accounting — долговременное восстановление overage

### 1. Исследование сценария PR #68

В PR #68 `settlePaidAccount` выполнял до 2 попыток интерактивной транзакции `commitOverageTransaction` (`recordSpentOverage` + `auditLog.create("AI_USAGE_OVERAGE")`). Если обе попытки падали из-за недоступности БД или ошибки вставки аудита:
- `UsageRecord.used` оставался равным `reserved` (подтверждённый перерасход терялся без следа);
- наружу выбрасывалась сырая ошибка БД;
- в `ai-service.ts` вызов `settlePaidAi(account)` в блоках `catch` затирал исходную ошибку операции (`generate`, `composeAgentPost`, `reviseStudioCard`) и при падении `settlePaidAi` в `try` вызывался повторно в `catch`.

### 2. Реализованное восстановление, идемпотентность и аудит

- **Модель и миграция `AiOverageSettlement`** (`prisma/schema.prisma`, `prisma/migrations/20261126000000_ai_overage_settlement/migration.sql`):
  - уникальное поле `settlementId` хранит факт фиксации конкретного перерасхода (`workspaceId`, `metric`, `periodStart`, `units`, `attempts`, `recovered`, `lastError`, `sourceError`, `createdAt`, `recoveredAt`).
- **Атомарный файловый spool** (`src/modules/ai/paid-settlement.ts`):
  - если 2 попытки коммита overage в БД не удались, запись сохраняется атомарно (временный файл `O_EXCL` `0600` + `fsync` + `rename`) в каталог `resolveSettlementSpoolDir` (`spoolDir` → `AI_SETTLEMENT_SPOOL_DIR` → `<LOCAL_STORAGE_DIR>/data/media/.ai-settlement-spool`, который в production монтируется на общий Docker volume `media_data` между `app` и `worker`).
  - В записи сохраняются `settlementId`, `workspaceId`, `periodStart`, `overage`, счётчик попыток и санитизированные `lastError` / `sourceError`.
- **Идемпотентная фиксация и восстановление без повторного платного запроса**:
  - Внутри `commitOverageTransaction` под `pg_advisory_xact_lock(hashtext(workspaceId), hashtext(metric))` выполняется `INSERT INTO "AiOverageSettlement" ... ON CONFLICT ("settlementId") DO NOTHING`.
  - Если вставка вернула 0 строк (`already_settled`), `recordSpentOverage` и `AI_USAGE_OVERAGE` **не повторяются** — двойное списание исключено при повторных запусках `recoverPendingOverageSettlements`, гонках между воркерами и повторных вызовах `settlePaidAccount`.
  - При восстановлении (`recovered: true`) предварительно выполняется `tx.usageRecord.upsert(..., update: {})` для гарантии наличия строки `UsageRecord`, затем `recordSpentOverage` + `AI_USAGE_OVERAGE` (`details: "units=..."`) + `AI_USAGE_OVERAGE_RECOVERED` с полной диагностикой (`settlementId`, `units`, `attempts`, `lastError`, `sourceError`).
  - Функция `recoverPendingOverageSettlements(prisma)` подключена в периодический `tick()` воркера (`src/server/queue/worker.ts`) и в `syncPendingOverage()` перед `ai.usage` и `beginPaidAi` в `src/modules/ai/ai-service.ts`. Если в `beginPaidAi` синхронизация spool всё ещё падает (`recovery.failed > 0`), новый платный запрос блокируется до восстановления учёта.
- **Сохранение исходной ошибки операции** (`PaidSettlementError` в `src/modules/ai/paid-settlement.ts`, `src/modules/ai/ai-service.ts`):
  - При падении settlement выбрасывается `PaidSettlementError` с полями `settlementId`, `settlementError`, `sourceError`, `spooled` и `cause: sourceError ?? settlementError`; исходная ошибка провайдера/операции и причина сбоя БД обе доступны для диагностики.
  - Во всех 3 `catch`-блоках `ai-service.ts` (`generate`, `composeAgentPost`, `reviseStudioCard`) исключён повторный вызов `settlePaidAi`, если ошибка уже `PaidSettlementError`, и передаётся `sourceError`.
  - Для ветки `reserved > charged` при ошибке `releaseUsage` и наличии `sourceError` также выбрасывается `PaidSettlementError`, сохраняющий `sourceError`.
- **Тесты** (`src/modules/ai/overage-recovery.test.ts`, 10 тестов на реальной PostgreSQL):
  - отказ БД на 2 попытках → spool без потери;
  - восстановление после подъёма БД без повторного платного вызова, честный `UsageRecord.used` и блокировка следующего запроса по месячному лимиту;
  - идемпотентность при повторном восстановлении (в т.ч. если файл spool не был удалён) и при повторном вызове `settlePaidAccount`;
  - конкурентная обработка (`Promise.all` по нескольким воркерам/попыткам для одного и нескольких `settlementId`);
  - сохранение `sourceError` в `PaidSettlementError` для overage и для `releaseUsage`;
  - санитизация секретов в диагностике, авто-синхронизация в `ai.usage`/`ai.generate`, повторный отказ БД при восстановлении, восстановление при отсутствующей строке `UsageRecord`, отказ записи самого spool (`spooled: false`).

### 3. Ограничения (честно без преувеличения гарантий)

- **Без долговременной записи гарантированное восстановление невозможно.** Если одновременно недоступна БД и не удалось сохранить файл spool на диск (`spooled: false`, например при полном исчерпании диска или EACCES), либо если эфемерная ФС контейнера уничтожена до сброса на постоянный том, приложение не сможет автоматически восстановить неподтверждённый overage. В `PaidSettlementError` (`spooled: false`) и логе stderr факт сбоя сохраняется для ручного разбора.
- Для совместного восстановления процессами `app` и `worker` на VPS каталог spool должен располагаться на общем томе `media_data` (`LOCAL_STORAGE_DIR=/app/data/media`).

---

## БЛОК B. Безопасность публикаций

### 1. Исправление политики и охват всех путей

- **`src/server/social/publish-live-guard.ts`**:
  - Удалена ветка `if (POLKA_REQUIRE_PROD_SECRETS === "true") ... else return SOCIAL_PUBLISH_LIVE !== "false"`.
  - Теперь `isSocialPublishLiveEnabled()` во **всех** окружениях (`production`, `development`, `test`) проверяет строгое равенство `process.env.SOCIAL_PUBLISH_LIVE === "true"`. По умолчанию live-публикации запрещены везде.
- **`src/server/social/vk-adapter.ts` и `src/server/social/telegram-adapter.ts`**:
  - После проверки привязанного аккаунта (`integration_not_configured` / `capability_unavailable` / `vk_no_group` / `telegram_no_chat`) и строго **до** расшифровки токена, чтения медиа и любых сетевых вызовов проверяется `!usingInjectedTransport && !isSocialPublishLiveEnabled()`, возвращая `socialPublishLiveBlockedOutcome()` (`permanent_failure`, `code: "social_publish_disabled"`).
- **Defense-in-depth на уровне транспорта** (`src/server/social/vk-api.ts`, `src/server/social/telegram-api.ts`):
  - `createVkTransport()` (без подменённого `fetchImpl`) блокирует методы записи/публикации (`wall.post`, `market.add`, `photos.saveWallPhoto`, `photos.createAlbum`, `photos.getUploadServer`, `photos.save`, `video.save`) и все upload-методы (`uploadWallPhoto`, `uploadAlbumPhoto`, `uploadDocument`, `uploadVideo`), если `!isSocialPublishLiveEnabled()`.
  - `createTelegramTransport()` (без подменённого `fetchImpl`) блокирует методы публикации/отправки (`sendMessage`, `sendPhoto`, `sendVideo`, `sendMediaGroup`, `sendDocument`, `sendAudio`, `sendAnimation`, `sendVoice`, `sendPoll`, `copyMessage`, `forwardMessage`, `editMessageText`, `editMessageCaption`), если `!isSocialPublishLiveEnabled()`.
  - Read-only проверки подключения и аналитики (`getMe`, `getChat`, `getChatMember`, `getChatMemberCount`, `groups.getById`, `wall.get`) продолжают работать без разрешения на публикацию.
- **`vitest.config.ts`**:
  - В `test.env` явно зафиксировано `SOCIAL_PUBLISH_LIVE: "false"`, чтобы случайная переменная окружения в shell разработчика или CI не разрешила live-отправку во время прогона тестов.
- **Проверенные пути отправки**:
  - ручной (`publishNowPost` → `publishNow`),
  - отложенный (`reschedulePost` → `calendar.schedule` → `enqueueDueSchedules`),
  - фоновый воркер (`worker.ts` → `processDueJobs` / BullMQ → `processJob`),
  - повторная отправка (`enqueue` retry и автоповтор при `temporary_failure`).
- **Тесты** (`src/server/social/publish-live-guard.test.ts`, `src/server/social/vk-api.test.ts`):
  - матрица для `NODE_ENV` = `production`, `development`, `test` (с `POLKA_REQUIRE_PROD_SECRETS` и без него) для `undefined`, `""`, `"false"`, `"0"`, `"1"`, `"TRUE"`, `"true "`, `"true"`;
  - интеграционные прогоны через `PublishService` с реальной БД и локальным HTTP spy-сервером по всем 4 путям (ручной, отложенный, worker, retry) в `production`, `development` и `test` — 0 исходящих запросов без `SOCIAL_PUBLISH_LIVE === "true"`, прохождение только при строгом `"true"`.

---

## БЛОК C. Заключительный аудит

Проверены следующие области:
1. **Авторизация, `sessionVersion` и права доступа**: `src/auth.ts`, `src/auth.config.ts`, `src/middleware.ts`, `src/app/api/auth/session-check/route.ts`, `src/modules/auth/session-token.ts`, `src/app/admin/layout.tsx`, `src/modules/admin/access.ts`, `src/modules/access/permissions.ts`, `src/modules/access/access-service.ts`. Edge-middleware сверяет `sessionVersion` с Node endpoint `/api/auth/session-check` на доверенном origin с таймаутом и fail-closed; API routes и Server Actions повторно вызывают `auth()` и RBAC (`requirePermission` / `requirePlatformAdmin`).
2. **Изоляция workspace и проектов**: `assertWorkspaceBound`, `assertActiveProject`, `src/modules/posts/post-service.ts`, `src/modules/media/media-service.ts`, `src/app/api/media/[id]/route.ts`, `src/modules/watch/watch-service.ts`, `src/modules/analytics/analytics-service.ts`. Меж-workspace доступ к медиа отдаёт 404 без раскрытия существования ресурса; архивные проекты блокируются для записи и планирования; активные job в воркере останавливаются при архивации проекта.
3. **Привязка социальных аккаунтов**: `src/modules/social/social-service.ts`, `src/server/social/resolve-account.ts`, `src/server/crypto/token-cipher.ts`. Токены шифруются AES-256-GCM с обязательным отдельным `TOKEN_ENCRYPTION_KEY` в production; пароли соцсетей отклоняются; при публикации выбирается только подключённый аккаунт того же `workspaceId` и `projectId` (без неявного fallback на workspace-global токен).
4. **Идемпотентность публикаций**: `src/modules/publishing/publish-service.ts`. Уникальный `idempotencyKey = post:<id>:version:<id>`, атомарный `claim` (`status: "pending"` → `"claimed"`), `publishAttempt` upsert по `(jobId, targetId, attemptNumber)`, уже опубликованные или `requires_manual_check` цели повторно не отправляются, зависшие задачи паркуются в `requires_manual_check`.
5. **AI-резервы и месячные лимиты**: `src/server/ai/live-guard.ts`, `src/modules/billing/usage.ts`, `src/modules/ai/ai-service.ts`, `src/modules/ai/paid-settlement.ts`. Работает только при `AI_LIVE_ENABLED=true` и положительном `AI_MONTHLY_HARD_LIMIT`; `pg_advisory_xact_lock` сериализует резервирование и фиксацию overage; совместимость цепочки PR #64–#69 сохранена (учёт сетевых ошибок PR #65, `sessionVersion` PR #66, HTTP-ответов PR #67, атомарности overage PR #68, восстановления overage и блокировки live-публикаций PR #69).
6. **VPS backup/migrate/rollback**: `scripts/lib/vps-common.sh`, `scripts/backup-vps.sh`, `scripts/restore-vps.sh`, `scripts/vps-up.sh`, `scripts/vps-pull.sh`, `scripts/vps-migrate.sh`, `scripts/vps-rollback.sh`. Остановка writers на время дампа, SHA-256 манифест, запрет migrate без подтверждённого бэкапа или `FIRST_INSTALL=YES`, изоляция probe-тестов через `env -i` и allowlist.
7. **Отсутствие секретов в логах (найден и исправлен дефект с воспроизводящим тестом)**:
   - *Дефект*: в `src/server/queue/worker.ts` (обработчики `poll failed`, `bullmq job failed`, `fatal`) в `console.error` передавался сырой `error`, а `sanitizeDiagnosticError` в `src/modules/ai/paid-settlement.ts` не маскировал `bot<id>:<token>` в URL Telegram (граница `\b` между `bot` и цифрами не срабатывала), `redis://:pass@...` и `vk2.*`.
   - *Воспроизведение и исправление*: написан воспроизводящий тест `src/server/queue/worker-log.test.ts` (сначала упал на базовом коде), правила маскирования вынесены в `redactDiagnosticSecrets` (`src/server/security/secrets.ts`, что также соблюдает grep-проверку `vps-readiness.yml` по tracked-файлам), все `console.error` в `src/server/queue/worker.ts` переведены на `sanitizeDiagnosticError(error)`.

### Риски и ограничения (без изменения архитектуры)

1. **Эфемерный spool при потере диска**: при одновременном отказе PostgreSQL и недоступности/потере тома `media_data` неподтверждённый overage может остаться только в stderr-логе (`PaidSettlementError` с `spooled: false`).
2. **Обычный локальный `AI_SERVICE` в тестах без env-лимита**: в unit-тестах с `injected` провайдером `skipPaidGate=true` (сознательный механизм для тестирования без реального OpenAI); в runtime без injected-провайдера всегда действуют `AI_LIVE_ENABLED=true` и `AI_MONTHLY_HARD_LIMIT`.
3. **Предупреждения сборки Next.js/Turbopack**: динамические `readdir`/`path.resolve` в `paid-settlement.ts` и `spawn(ffmpegBin())` в `video-encode.ts`/`jpeg-encode.ts` выдают штатные tracing-предупреждения при `next build`, на результат сборки и runtime не влияют.
4. **Реальные внешние API не вызывались**: в ходе проверки не выполнялись платные AI-вызовы и реальные публикации в VK/Telegram; сетевые пути проверены через локальный HTTP spy-сервер и тестовую PostgreSQL.

---

## Изменённые файлы

| Файл | Назначение |
|---|---|
| `prisma/schema.prisma` | Модель `AiOverageSettlement` |
| `prisma/migrations/20261126000000_ai_overage_settlement/migration.sql` | Миграция таблицы `AiOverageSettlement` |
| `src/modules/ai/paid-settlement.ts` | Spool, идемпотентное восстановление, `PaidSettlementError`, `recoverPendingOverageSettlements` |
| `src/modules/ai/ai-service.ts` | Передача `sourceError`, защита от двойного `settlePaidAi`, синхронизация spool |
| `src/modules/ai/overage-recovery.test.ts` | 10 интеграционных тестов восстановления и конкурентности overage на реальной БД |
| `src/server/security/secrets.ts` | Централизованная функция `redactDiagnosticSecrets` |
| `src/server/queue/worker.ts` | Восстановление spool в `tick()` + санитизация всех `console.error` |
| `src/server/queue/worker-log.test.ts` | Регрессионный тест маскирования секретов в диагностике и логах воркера |
| `src/server/social/publish-live-guard.ts` | Строгое `SOCIAL_PUBLISH_LIVE === "true"` по умолчанию false во всех окружениях |
| `src/server/social/vk-adapter.ts` | Блокировка live-публикаций до расшифровки токена и сетевых вызовов |
| `src/server/social/telegram-adapter.ts` | Блокировка live-публикаций до расшифровки токена и сетевых вызовов |
| `src/server/social/vk-api.ts` | Защита default-транспорта от write/upload-вызовов без `SOCIAL_PUBLISH_LIVE=true` |
| `src/server/social/telegram-api.ts` | Защита default-транспорта от send-методов без `SOCIAL_PUBLISH_LIVE=true` |
| `src/server/social/vk-api.test.ts` | Явный локальный `SOCIAL_PUBLISH_LIVE=true` в тесте `postKnownLength` на `127.0.0.1` |
| `src/server/social/publish-live-guard.test.ts` | Матрица `production`/`development`/`test` + все 4 пути отправки с локальным HTTP spy |
| `vitest.config.ts` | Принудительный `SOCIAL_PUBLISH_LIVE: "false"` в `test.env` |
| `docs/environment.md` | Актуализация описания `SOCIAL_PUBLISH_LIVE` |
| `docs/pr69-final-safety-report.md` | Этот отчёт |

---

## Результаты проверок (на `820b0b4`, перед финальной перепроверкой HEAD)

| Проверка | Результат |
|---|---|
| `bash -n` всех VPS-скриптов | PASS |
| Secret-shaped tracked files (`git grep` из `vps-readiness.yml`) | PASS |
| `npm ci` | PASS |
| `npx prisma generate` / `npx prisma validate` / `npx prisma migrate deploy` | PASS (19 миграций) |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm test` (`PROBE_HARNESS_ADMIN_URL`, `AUTH_DEV_MAILBOX=true`) | PASS — 62 файла, 383 теста |
| `npm run test:vps` | PASS — 108 тестов |
| `npm run build` | PASS |
| Playwright E2E (`AUTH_ALLOW_PUBLIC_REGISTRATION=true`, `AUTH_DEV_MAILBOX=true`) | PASS — 12 тестов |

Финальный прогон на итоговом HEAD и результаты GitHub Actions (**CI** и **VPS readiness**) зафиксированы в описании PR #69 и в копии отчёта в store (`docs/pr69-report.md`).

## Подтверждение ограничений

Без merge (#63–#69), deploy, SSH, обследования VPS, изменений production DB, реальных платных AI-запросов, реальных публикаций в VK/Telegram, чтения/вывода/изменения `.env` и секретов, а также без добавления новых провайдеров.

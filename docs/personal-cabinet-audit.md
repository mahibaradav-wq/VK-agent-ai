# Итоговый отчёт Cursor: личный кабинет Polka Social

Дата: 24 ноября 2026, Europe/Moscow.  
Задание: консолидация и завершение технического аудита. Цель — безопасное личное использование владельцем (до 10 активных проектов), не публичный SaaS.

**Готовность не равна зелёному CI.** Ниже: все перечисленные проверки выполнены локально, негативные сценарии покрыты тестами, граф PR понятен. Production-действия (deploy, SSH, живые VK/Telegram, платный OpenAI, ЮKassa) не выполнялись и требуют отдельного решения владельца.

---

## 1. Текущая ветка и SHA

| Поле | Значение |
|---|---|
| Ветка | `cursor/personal-cabinet-safety-ee77` |
| SHA кода (проверки) | `46b7243ab912d55df719d91cac024d147fe40d7a` |
| Этот файл | коммит поверх кода аудита; содержимое отчёта относится к SHA выше |
| PR | [#57](https://github.com/mahibaradav-wq/VK-agent-ai/pull/57) |
| База PR | [#56](https://github.com/mahibaradav-wq/VK-agent-ai/pull/56) `chatgpt/p12-clear-approver-scope-on-demotion-20261124` @ `2a87f51` |
| `main` | `252230b` (FastAPI/SQLite mock, не живой продукт) |
| CI Test на HEAD | success, 24.11.2026 ~21:13 Europe/Moscow |

Коммиты поверх #56:

1. `91f8143` — stale publish → `requires_manual_check`, без слепого retry.
2. `6732981` — соцаккаунт привязан к проекту поста; IDOR-тесты.
3. `46b7243` — auth, AI live-guard, лимит 10 проектов, billing UI выключен, backups/docs.
4. Этот markdown-отчёт — отдельный коммит документации, без изменения поведения.

---

## 2. Карта PR и зависимости

На 24.11.2026 PR **#41–56 не влиты в `main`**. Merge запрещён без отдельного решения владельца.

### Safety chain (живёт в #56, не в `main`)

```text
#44 → #45 → #46 → #53 → #54 → #55 → #56
```

Audit branch **не предполагает**, что #56 содержит #48–#52. Это проверено: HEAD #56 (`2a87f51`) всё ещё имел старое stale-поведение (`failed` + retry). Фикс #51 внесён отдельно, без merge PR.

### Параллельные PR на базе #46

| PR | Тема | Входит в audit branch? |
|---|---|---|
| #41 / #42 | фото Telegram/VK, manual fallback | **Нет** (отдельная photo-цепочка) |
| #43 | `CHATGPT_PROJECT_HANDOFF.md` | **Нет** |
| #48 | trusted-proxy rate limit | **Эквивалент:** Caddy `header_up X-Real-IP {remote_host}`; приложение берёт только `x-real-ip` |
| #49 | timezone календаря | **Да:** селектор + cookie `polka-timezone`, хранение UTC |
| #50 | atomic password reset | **Эквивалент:** `deleteMany` claim в транзакции до смены пароля |
| **#51** | stale publish, без дублей | **Да** — `91f8143` |
| **#52** | backup/restore | **Да** — `scripts/backup-vps.sh`, `scripts/restore-vps.sh`, `docs/runbooks/backups.md` |
| #56 | очистка Approver grants при demotion | **База** этого PR |

Стек GitHub: #57 стоит непосредственно над #56. `main` не менялся.

---

## 3. Найденные дефекты

Severity: P0 — риск дубля публикации или утечки между проектами; P1 — эксплуатационная безопасность / деньги; P2 — модель личного кабинета; P3 — документация.

| Sev | Дефект | Где | Статус |
|---|---|---|---|
| P0 | Зависший publish job в #56 помечался `failed` и мог уйти на повтор, хотя внешний результат неизвестен | `src/modules/publishing/publish-service.ts` (`parkStalePublishJobs`, ~159–209) | Исправлено: job/target → `requires_manual_check`; published-цели не трогаются |
| P0 | Публикация проекта могла пойти через Telegram/VK другого проекта или global-токен workspace (`projectId=null`) | `src/modules/social/social.test.ts` ~262; сервис публикации/адаптеры | Исправлено: чужой и global аккаунт не используются; `integration_not_configured` |
| P1 | Rate limit доверял клиентскому `X-Forwarded-For` | `src/modules/auth/actions.ts` (~36), `deploy/Caddyfile` (~8) | Исправлено: только `X-Real-IP` от Caddy |
| P1 | Сброс пароля не был single-use при гонке | `src/modules/auth/auth-service.ts` (~353–364) | Исправлено: `deleteMany` claim, count === 1 |
| P1 | `DEFAULT_MONTHLY_LIMIT = 0` — безлимит, не бюджет | `src/modules/ai/ai-service.ts` (~82–83) | Не меняли семантику счётчика. Fail-closed: `AI_LIVE_ENABLED` |
| P1 | Кабинет на каждом заходе мог дергать billing OpenAI | `src/server/ai/balance.ts`, `src/app/app/layout.tsx` | Исправлено: без `AI_LIVE_ENABLED` баланс не запрашивается |
| P2 | Публичная регистрация открыта | `src/modules/auth/auth-service.ts` (`isPublicRegistrationOpen`, ~20–22, ~86) | Флаг `AUTH_ALLOW_PUBLIC_REGISTRATION=false`; пустая БД и приглашённые email проходят |
| P2 | Map rate limiter — память одного процесса Node | `src/server/security/rate-limit.ts` | Не баг для одного инстанса. Не распределённая защита |
| P2 | CSP: `'unsafe-inline'` / `'unsafe-eval'` | `src/server/security/headers.ts` (~11–12) | Документировано; nonce не внедряли |
| P2 | 2FA/TOTP нет | схема Prisma, auth | Не внедряли: нужна миграция |
| P3 | Документы описывали FastAPI как живой продукт | `docs/architecture.md`, `docs/implementation-plan.md`, `README.md` | Заголовки обновлены: Next.js 16 + PostgreSQL |

`projectId=null` у соцаккаунта — **намеренная** модель «глобальный токен workspace». Для личного кабинета он **не** подставляется в чужой проект. Подключение без `projectId` остаётся возможным, публикация проекта его не берёт.

---

## 4. Изменения в audit branch

### Блок 2 — публикации и очередь

- Неопределённый адаптер → `requires_manual_check`, не `failed`.
- Retry не шлёт уже `published` и `requires_manual_check`.
- Stale claim (>2 мин) паркуется один раз, в том числе при гонке двух воркеров.
- Mixed Telegram published + VK unknown → статус поста `requires_manual_check`.
- Архивный проект проверяется до внешнего adapter call.
- Только mocked adapters.

### Блок 3 — изоляция

- Workspace/project binding для Posts, Media, AI, Social, Watch, Calendar, Products, Comments, Approval, Notifications (негативные тесты в `isolation.test.ts`, `social.test.ts`, collaboration).
- Approver grants чистятся при demotion (из #56).
- Архив проекта закрывает user/server actions, queue и worker.

### Блок 4 — auth

- Caddy перезаписывает `X-Real-IP`; приложение не читает `X-Forwarded-For`.
- Reset token: single-use + concurrency test.
- Закрытая регистрация — opt-in флаг (по умолчанию открыта, чтобы первый владелец и тесты работали).
- `AUTH_DEV_MAILBOX=true` только в `.env.example`; в production-example закомментирован.
- Token cipher: отдельный `TOKEN_ENCRYPTION_KEY` в production; legacy decrypt с `AUTH_SECRET`; encrypt новым ключом не совпадает с `AUTH_SECRET`.

### Блок 5 — AI и бюджет

- Call sites `generate` / `generateImage` / `probeAiApiKey` без injected `fetchImpl` режутся `assertAiLiveEnabled()`.
- `fetchAiBalance` без live-флага не ходит в OpenAI.
- Без ключа провайдер `unconfigured` бросает ошибку, не имитирует текст/картинку.
- Ключ не попадает в public DTO (проверка в `ai.test.ts` / `provider.test.ts`).
- Qwen/DeepSeek не подключались.
- Studio page load не вызывает `generateImage`.
- **Live AI не включали:** `AI_LIVE_ENABLED` в примерах закомментирован.

### Блок 6 — личная модель

Зависимости Plan/Subscription/Checkout/YooKassa **оставлены в коде** (обратимость, без удаления таблиц):

- `src/modules/billing/*`, `src/server/billing/*`
- `prisma` модели Plan, Subscription, CheckoutSession, PaymentEvent
- `/api/webhooks/billing`, `/api/subscription`
- админка `/admin/plans`

Убрано из целевого UI:

- пункт «Тарифы» в навигации и sitemap
- `PricingTable` с главной
- `/pricing` — страница-уведомление, не витрина
- `/app/subscription` уже redirect на `/app`
- `startPlanCheckout` / `cancelSubscription` не вызывают ЮKassa

Жёсткий лимит: `PERSONAL_ACTIVE_PROJECT_LIMIT = 10` внутри транзакции с `lockWorkspaceMetric`, включая concurrent create.

Оставлены операционные лимиты Start-плана: соцаккаунты, участники, посты/месяц, размер медиа.

### Блок 7 — backup, timezone, документы

- Backup: dump PostgreSQL + tar медиа + SHA-256. App/worker останавливаются на время копии.
- Restore: `CONFIRM_RESTORE=YES`, checksum, совпадение имён в manifest, ввод `RESTORE`. Против VPS **не запускался**.
- Календарь: выбор пояса, UTC в БД.
- Документы больше не выдают FastAPI за текущий продукт.
- CI: `bash -n` для backup/restore/vps скриптов.

---

## 5. Тесты и фактические результаты

Локально на HEAD `46b7243` (24.11.2026, Europe/Moscow):

| Команда | Результат |
|---|---|
| `npx prisma validate` | schema valid |
| `bash -n scripts/backup-vps.sh scripts/restore-vps.sh scripts/vps-up.sh scripts/vps-pull.sh` | OK |
| `npm test` | **51 файл, 255 тестов, все passed** (~69 с) |
| `npm run typecheck` | OK |
| `npm run lint` | OK |
| `npm run build` | Next.js 16.4.5 OK; прежние Turbopack-предупреждения ffmpeg spawn (не регрессия этого аудита) |
| GitHub Actions `Test` на `46b7243` | **success** |

Playwright e2e (`npm run test:e2e`) в этом задании не гонялся как обязательный блок.

Файлы vitest (51):

- `src/modules/access/isolation.test.ts`
- `src/modules/access/permissions.test.ts`
- `src/modules/admin/admin.test.ts`
- `src/modules/ai/ai.test.ts`
- `src/modules/ai/balance-service.test.ts`
- `src/modules/ai/provider.test.ts`
- `src/modules/ai/video-encode.test.ts`
- `src/modules/ai/visual.test.ts`
- `src/modules/analytics/analytics.test.ts`
- `src/modules/analytics/metrics.test.ts`
- `src/modules/auth/auth-service.test.ts`
- `src/modules/billing/billing.test.ts`
- `src/modules/brand/visual-standard.test.ts`
- `src/modules/calendar/calendar.test.ts`
- `src/modules/calendar/timezone.test.ts`
- `src/modules/collaboration/collaboration.test.ts`
- `src/modules/e2e/critical-path.test.ts`
- `src/modules/media/file-validation.test.ts`
- `src/modules/media/jpeg-encode.test.ts`
- `src/modules/posts/draft-fields.test.ts`
- `src/modules/posts/editor.test.ts`
- `src/modules/posts/platforms.test.ts`
- `src/modules/posts/variants.test.ts`
- `src/modules/products/product-prompt.test.ts`
- `src/modules/products/product-service.test.ts`
- `src/modules/products/shop-fetch.test.ts`
- `src/modules/products/shop-labels.test.ts`
- `src/modules/products/shop-url.test.ts`
- `src/modules/projects/project-service.test.ts`
- `src/modules/publishing/publish.test.ts`
- `src/modules/social/social.test.ts`
- `src/modules/social/telegram-chat.test.ts`
- `src/modules/social/vk-wall-text.test.ts`
- `src/modules/watch/parse.test.ts`
- `src/modules/watch/prompt.test.ts`
- `src/modules/watch/watch.test.ts`
- `src/lib/mailbox-url.test.ts`
- `src/server/ai/balance.test.ts`
- `src/server/ai/live-guard.test.ts`
- `src/server/ai/probe.test.ts`
- `src/server/billing/yookassa.test.ts`
- `src/server/crypto/token-cipher.test.ts`
- `src/server/db/migrations.test.ts`
- `src/server/hosting/production-stack.test.ts`
- `src/server/http/outbound-fetch.test.ts`
- `src/server/mail/dev-mailbox.test.ts`
- `src/server/security/rate-limit.test.ts`
- `src/server/security/secrets.test.ts`
- `src/server/social/telegram-api.test.ts`
- `src/server/social/telegram-text.test.ts`
- `src/server/social/vk-api.test.ts`

Новые/расширенные негативные сценарии этого аудита: stale publish race, mixed TG/VK, IDOR соцаккаунтов, concurrent 10 проектов, concurrent reset token, закрытая регистрация, live-guard generate/image/probe/balance, checksum restore, отсутствие PricingTable.

---

## 6. Что проверено mock/CI и что не проверялось в production

### Проверено (mock / локально / CI)

- Очередь публикаций, guid/idempotency, stale/manual VK — **mocked adapters**, без живых API.
- Изоляция workspace/project, архив, Approver grants.
- Auth, rate limit по `X-Real-IP`, closed registration, token cipher (тестовые ключи, не секреты VPS).
- `AI_LIVE_ENABLED` fail-closed; тесты инжектят `fetchImpl`.
- Сборка, lint, Prisma migrate в CI Postgres.
- Синтаксис backup/restore скриптов (`bash -n`), не выполнение на сервере.

### Не проверялось и не запускалось

- SSH на Timeweb, `scripts/vps-up.sh` / `vps-pull.sh` против живого хоста.
- Миграции production БД.
- Реальные публикации VK/Telegram.
- Платежи ЮKassa.
- Платные вызовы OpenAI.
- Restore на VPS (скрипт разрушительный).
- Распределённый rate limit на нескольких инстансах.
- 2FA, nonce-CSP в браузере production.

Живой сайт `https://24dom-po-polochkam.ru` этим заданием не менялся.

---

## 7. Риски и решения владельца

1. **Merge/deploy** цепочки #44…#56 + #57 — только вручную, без auto-merge. `main` не трогать, пока не решено, что именно становится production.
2. После появления первого владельца на VPS: `AUTH_ALLOW_PUBLIC_REGISTRATION=false`.
3. Числовой бюджет OpenAI → затем `AI_LIVE_ENABLED=true`. До этого флаг не включать.
4. Отдельное разрешение на живые VK/Telegram.
5. Photo-цепочка #41/#42 **не** в этом PR; если нужны manual photo fallback с #42 — отдельная интеграция/rebase.
6. Удаление таблиц ЮKassa/Plan — только после бэкапа и отдельного решения. В этом задании таблицы сохранены.
7. 2FA и nonce-CSP — следующий этап, не блокер личного кабинета с закрытой регистрацией.
8. Rate limit: один процесс Node достаточен; кластер потребует таблицу PostgreSQL с TTL, не обязательный Redis.

Приоритет остаточного риска: закрытая регистрация и `AI_LIVE_ENABLED` > TOKEN_ENCRYPTION_KEY и выключенный mailbox > 2FA > nonce-CSP.

---

## 8. План безопасного merge/deploy (не выполнять)

Отдельный этап после решения владельца:

1. Снять бэкап: `BACKUP_DIR=/opt/polka-social-backups bash scripts/backup-vps.sh`. Копию унести с VPS.
2. Прочитать diff #57 относительно #56 и полный diff относительно того, что реально крутится на VPS (цепочка может быть не равна HEAD #57).
3. Решить, вливать ли #41/#42 до выкладки, если нужны текущие photo-фиксы.
4. Выкладка только `workflow_dispatch` Deploy VPS или ручной `vps-pull.sh` выбранной ветки. Не из `pull_request`.
5. На сервере: `AUTH_DEV_MAILBOX` не задавать; задать `TOKEN_ENCRYPTION_KEY` ≠ `AUTH_SECRET`; после первого входа — закрыть регистрацию.
6. `AI_LIVE_ENABLED` не ставить, пока нет бюджета.
7. Проверить `/api/health`, вход, календарь, студию **без** живой публикации и без AI.
8. Откат: restore с `CONFIRM_RESTORE=YES` и вводом `RESTORE` только после checksum.

Ни один из шагов 1–8 этим агентом не выполнялся.

---

## 9. Итог

| Вопрос | Ответ |
|---|---|
| Личный кабинет, не SaaS? | Да, в целевом UI. Биллинг-таблицы на месте для обратимости |
| До 10 проектов? | Да, серверный hard cap с блокировкой гонок |
| Можно ли считать production-ready по CI? | **Нет.** CI + локальные тесты закрывают перечисленный аудит. Production не трогали |
| Можно ли merge в `main`? | Нет, без отдельного решения владельца |
| Можно ли включать AI / VK / TG? | Нет, без явного разрешения и бюджета |

# Итоговый отчёт: личный кабинет Polka Social

Дата проверки: 24 ноября 2026, Europe/Moscow.  
Задание: единый OpenAI на кабинет, исключение коммерческих сценариев, один владелец и до 10 активных проектов, безопасные VK/Telegram, резервное копирование.  
Production, SSH, merge в `main`, живые публикации и платные вызовы OpenAI не выполнялись.

**Это не заявление о 100% готовности к включению платных функций.** Ниже — фактические статусы проверок.

---

## 1. Проверенный branch и commit SHA

| Поле | Значение |
|---|---|
| Рабочая ветка | `cursor/personal-openai-cabinet-ee77` |
| SHA этого отчёта | будет совпадать с HEAD указанной ветки после коммита документации |
| Родитель | `78a319b9236e6f33f4056483c95e365f022c501b` (`cursor/personal-cabinet-safety-ee77`) |
| Исходный PR | [#57](https://github.com/mahibaradav-wq/VK-agent-ai/pull/57), open, не merged |
| База #57 | [#56](https://github.com/mahibaradav-wq/VK-agent-ai/pull/56) @ `2a87f51` |
| `main` | FastAPI/SQLite mock `252230b`; не живой продукт, не менялся |

После push SHA этой ветки нужно смотреть в созданном PR поверх #57.

---

## 2. Состояние исходного PR

PR **#57** «Personal cabinet safety audit on the #56 chain»:

- состояние: **open**, draft=false, mergeable;
- HEAD на момент старта этой работы: `78a319b`;
- CI Test на `78a319b`: **success** (GitHub Actions, 24.11.2026 21:24 Europe/Moscow);
- в `main` не влит;
- стек: #57 стоит над #56.

Эта работа **не обновляет #57** и **не делает merge**. Новый PR идёт отдельной веткой поверх #57.

---

## 3. Какие файлы изменены

Новые:

- `src/modules/cabinet/limits.ts`
- `src/modules/cabinet/commercial.ts`
- `src/modules/cabinet/cabinet.test.ts`
- `docs/personal-cabinet-final-audit.md`

Существенные правки:

- AI: `src/server/ai/live-guard.ts`, `openai-compatible.ts`, `probe.ts`, `balance.ts`, `src/modules/ai/ai-service.ts`, `provider-service.ts`
- кабинет: проекты, регистрация, billing HTTP, social resolve-account, UI `/app`, `/register`, `/admin/plans`, `/app/connections`
- тесты: cabinet, projects, social, billing, live-guard, production-stack, e2e
- env/docs: `.env.example`, `.env.production.example`, `docs/environment.md`, `docs/security.md`
- `vitest.config.ts` — для unit-тестов регистрация открыта явно

Полный `git diff --stat` относительно `78a319b`: 35+ файлов до отчёта, плюс этот markdown.

---

## 4. Что исправлено

1. Платные AI-вызовы идут через один кабинетный шлюз: `AI_LIVE_ENABLED` + `AI_MONTHLY_HARD_LIMIT` + advisory lock счётчика.
2. Один OpenAI-ключ кабинета шарится между проектами владельца; чужой владелец ключ не получает.
3. Checkout, webhook ЮKassa и HTTP `/api/subscription` закрыты, пока `BILLING_CHECKOUT_ENABLED` не равен `true`.
4. Операционные лимиты отвязаны от строк `Plan`: 10 активных проектов, свои лимиты аккаунтов/участников/постов.
5. Публикация VK/Telegram не берёт workspace-global токен (`projectId=null`) как скрытый fallback.
6. Архив/восстановление проекта с тем же cap=10 и UI на `/app`.
7. Публичная регистрация по умолчанию закрыта после первого владельца; страница `/register` это показывает.
8. E2E приведены к текущему кабинету (без email в шапке).

---

## 5. Как реализовано единое подключение OpenAI

Статус: **PASS** (архитектура и mock-тесты). Живой OpenAI: не вызывался.

- Ключ хранится в `WorkspaceAiConnection` (AES-256-GCM), не в проекте.
- `loadRows()` сначала читает подключение этого workspace; если его нет — берёт connected OpenAI других workspace того же Owner.
- Проекты одного кабинета не требуют повторного connect.
- Каталог провайдеров по-прежнему только OpenAI (`ROLE_ORDER`: ideas/copy/image → openai). Новые провайдеры не подключались.
- Проект задаёт контекст генерации (`projectId` в `AIRequest`), не свой API-ключ.

Проверено тестом «uses one OpenAI connection for every project of the owner» и изоляцией чужого кабинета.

---

## 6. Как обеспечивается общий контроль расходов

Статус: **PASS** для счётчика и блокировок; **не является** денежным биллингом OpenAI.

- `AI_MONTHLY_HARD_LIMIT` — целое ≥ 1, общий лимит кабинета на месяц.
- Без этой переменной `assertPaidAiAllowed()` запрещает live-путь даже при `AI_LIVE_ENABLED=true`.
- `beginPaidAi()` в транзакции берёт `pg_advisory_xact_lock` + `reserveUsage`, так что параллельные запросы не обходят лимит.
- Исчерпание пишет `AI_PAID_DENIED` с `budget_exhausted` (без ключа).
- `DEFAULT_MONTHLY_LIMIT = 0` остаётся безлимитом **только** для injected mock-провайдеров в тестах.

Prepaid-цифра с `platform.openai.com` по-прежнему не запрашивается, пока live выключен (`fetchAiBalance`).

---

## 7. Как заблокированы платные AI-вызовы

Статус: **PASS** (fail-closed, без реальных запросов).

Точки, которые обязаны пройти шлюз:

| Путь | Механизм |
|---|---|
| `generate` / `composeAgentPost` / `rewrite` | `beginPaidAi` → `assertPaidAiAllowed` |
| `OpenAICompatibleProvider.generate` / `generateImage` | тот же assert, если нет injected `fetchImpl` |
| `probeAiApiKey` (connect / проверка моделей) | assert, если нет injected fetch |
| `fetchAiBalance` | не ходит в billing API OpenAI без live+лимита |
| Watch `collectIdeas` / apply | через `createAiService().generate` / `composeAgentPost` |

Выключение `AI_LIVE_ENABLED` блокирует default fetch, не только UI. Тесты `live-guard.test.ts` и cabinet-тест `AI_PAID_DENIED` это подтверждают. Секреты в audit и ответах не пишутся.

Ограничение: сохранить ключ через живой `/models` probe тоже нельзя, пока шлюз закрыт. Это сознательный fail-closed, не обход.

---

## 8. Какие коммерческие компоненты отключены или удалены

Статус: **PASS** для работающего приложения; код биллинга не вычищен целиком.

Отключено в рабочем сценарии:

- HTTP `GET /api/subscription` и `POST /api/webhooks/billing` → 403;
- `startCheckout` / `cancel` / `handleWebhook` без `BILLING_CHECKOUT_ENABLED=true`;
- UI `/pricing` без витрины и checkout; `/app/subscription` редирект на `/app`;
- навигация кабинета без «Подписка» и без ссылки на pricing;
- тарифные лимиты больше не режут проекты, соцаккаунты, участников и посты.

Не удалялось:

- модуль `billing-service`, провайдер ЮKassa, `PricingTable.tsx`, `PLAN_CATALOG`;
- админка `/admin/plans` (есть баннер, что лимиты кабинета не оттуда);
- таблицы БД (см. §9).

Unit-тесты биллинга по-прежнему гоняются при явно включённом `BILLING_CHECKOUT_ENABLED` в `billing.test.ts`, чтобы не потерять защиту webhook-логики на случай обратного включения. Это не рабочий сценарий кабинета.

---

## 9. Что осталось в базе данных и почему

Статус: **PASS** (безопасный вариант: оставить, отвязать).

Используются действующими функциями:

| Таблица | Зачем сейчас |
|---|---|
| `Plan`, `Subscription` | `attachFreeSubscription` при регистрации; чтение state; **не** лимит проектов |
| `CheckoutSession`, `PaymentEvent` | только если коммерческий флаг включён в тестах/аварийном режиме |
| `UsageRecord` | общий счётчик AI и постов кабинета |
| `WorkspaceAiConnection` | единый ключ OpenAI |
| `AuditLog` | журнал, в том числе `AI_PAID_DENIED` |
| `Project.archivedAt` | архив |

Пользовательские данные и история миграций не трогались. Отдельная миграция на DROP `Plan`/`Subscription` **не нужна** на этом этапе: регистрация всё ещё создаёт free-подписку, чтобы не ломать схему. Безопасная очистка позже: бэкап → отключить `attachFreeSubscription` → миграция DROP после проверки, что никто не читает эти таблицы.

---

## 10. Как реализован лимит 10 активных проектов

Статус: **PASS**.

- Константа `PERSONAL_ACTIVE_PROJECT_LIMIT = 10`.
- `create` и `restore` в транзакции: `lockWorkspaceMetric(projects)` + `count(archivedAt: null)`.
- Конкурентное создание: тест `caps active projects at 10 even under concurrent creates`.
- Восстановление при полном cap отклоняется; чужой workspace не восстанавливает чужой проект (403).
- UI: форма создания, «В архив», список архива и «Восстановить».

Клиентские workspace, платные аккаунты и коммерческие роли не вводились. Регистрация: первый пользователь на пустой БД проходит; дальше — только `AUTH_ALLOW_PUBLIC_REGISTRATION=true` или действующее приглашение. Способ входа (credentials JWT) не менялся.

---

## 11. Результаты проверки VK и Telegram

Статус: **PASS** на mock-адаптерах. Живые публикации: не выполнялись.

- `resolvePublishSocialAccount` принимает только `connected` аккаунт **этого** `post.projectId`.
- Bound global (`projectId=null`) и чужой проект → `integration_not_configured`, без `sendMessage`/`wall.post`.
- Подключение без `projectId` по-прежнему сохраняет токен как явный общий ресурс, но публикация его не берёт. В UI такие токены не показываются как рабочие для клуба.
- Идемпотентность `wall.post` guid, unknown → `requires_manual_check`, stale jobs, архив с очередью — покрыты прежними тестами `social.test.ts` / `publish.test.ts` (259 unit).
- Реальных вызовов VK/Telegram API не было.

---

## 12. Результаты проверки безопасности

Статус: **PASS** для реализованных контролей; часть рисков — инфраструктура VPS.

Проверено тестами/кодом:

- auth + Owner; Viewer не генерирует AI и не стартует checkout;
- IDOR проектов и соцаккаунтов;
- изоляция OpenAI-ключа между владельцами;
- rate limit логина/регистрации по `X-Real-IP` (не клиентский `X-Forwarded-For`);
- AES-256-GCM токенов, `TOKEN_ENCRYPTION_KEY` обязателен в production и ≠ `AUTH_SECRET`;
- секреты не попадают в JSON ответов и audit details;
- публичная регистрация закрыта по умолчанию;
- `/app` и `/admin` редиректят анонима (e2e http).

Не раскрывались значения секретов и `.env`.

Риски, которые **требуют VPS/внешней настройки** (не закрываются этим PR):

| Риск | Почему снаружи |
|---|---|
| `TOKEN_ENCRYPTION_KEY` на сервере | должен быть задан в production env, не в Git |
| `AUTH_ALLOW_PUBLIC_REGISTRATION` | на VPS не ставить `true` после первого владельца |
| `AUTH_DEV_MAILBOX` | в production не задавать |
| `AI_LIVE_ENABLED` / лимит | не включать без согласованного бюджета |
| TLS, firewall, ssh, обновления | Caddy/хостинг |
| Копии вне VPS | скрипты есть, расписания нет |
| 2FA | нет в схеме |
| CSP nonce вместо `'unsafe-inline'` | отдельная работа |
| Распределённый rate limit | in-memory Map одного процесса |

---

## 13. Результаты проверки резервного копирования

| Проверка | Статус | Комментарий |
|---|---|---|
| `bash -n` backup/restore/vps scripts | **PASS** | синтаксис |
| Отказ restore без `CONFIRM_RESTORE=YES` | **PASS** | exit 1 |
| Локальный `pg_dump -Fc` → отдельная БД `polka_restore_probe` | **PASS** | 2171 пользователей совпали, 40 public tables |
| Целостность SHA-256 dump+media tar | **PASS** | изолированный каталог `/tmp` |
| Восстановление медиа из tar | **PASS** | контрольный файл |
| Полный `restore-vps.sh` через docker compose production | **BLOCKED** | нет Docker и `.env.production` в этой среде; к production не подключались |
| Расписание и копия вне VPS | **BLOCKED** | нужна настройка сервера владельцем |

Инструкция: `docs/runbooks/backups.md`. Destructive restore на живых данных не выполнялся.

---

## 14. Точные команды тестирования и результаты

Среда: локальный PostgreSQL `polka_social`, без платного OpenAI, без VK/Telegram live.

| Команда | Результат |
|---|---|
| `npx vitest run` | **PASS** 52 files, 259 tests |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** (предупреждения Turbopack про `spawn` ffmpeg, не ошибки) |
| `npx prisma validate` | **PASS** |
| `npx prisma migrate status` | **PASS** 17 migrations, schema up to date |
| `prisma migrate diff --from-migrations ... --exit-code` | **BLOCKED** нужен `--shadow-database-url`; статус миграций проверен иначе |
| `bash -n scripts/backup-vps.sh scripts/restore-vps.sh scripts/vps-up.sh scripts/vps-pull.sh` | **PASS** |
| изолированный dump/restore PostgreSQL + tar media | **PASS** |
| `npx playwright test` (`AUTH_ALLOW_PUBLIC_REGISTRATION=true AUTH_DEV_MAILBOX=true`, `npm start` после build) | **PASS** 7 tests |
| конкурентное создание проектов | **PASS** внутри vitest |
| единый AI-провайдер / лимит / отказ live | **PASS** внутри vitest |
| коммерческие HTTP 403 | **PASS** внутри vitest |
| изоляция проектов / publish без дубля | **PASS** внутри vitest |
| живой OpenAI | **не выполнялся** |
| живые VK/Telegram | **не выполнялись** |
| CI GitHub этой ветки | ещё не бежал до push |

Целевые тесты, которые требуют отдельного упоминания:

- `src/modules/cabinet/cabinet.test.ts`
- `src/server/ai/live-guard.test.ts`
- `src/modules/projects/project-service.test.ts` (cap 10 + restore)
- `src/modules/social/social.test.ts` (нет global fallback)
- `src/modules/auth/auth-service.test.ts` (закрытая регистрация)
- `src/modules/e2e/critical-path.test.ts` (unit-путь register → integration_not_configured)

---

## 15. Оставшиеся дефекты и ограничения

| Тема | Статус | Суть |
|---|---|---|
| Таблицы Plan/Subscription | ограничение | оставлены; не влияют на cap проектов |
| `/admin/plans` | ограничение | Superadmin всё ещё может править строки Plan; кабинет их не читает |
| `PricingTable.tsx` / `billing-service` | ограничение | мёртвый код для UI, живой только под тестовым флагом |
| Env `AI_API_KEY` | ограничение | запасной провайдер из env, если в кабинете нет ключа; всё равно режется live-guard |
| Probe ключа при выключенном AI | ограничение | connect с реальным `/models` заблокирован вместе с генерацией |
| 2FA, nonce-CSP, внешний backup | не сделано | внешняя инфраструктура / отдельные задачи |
| Photo-цепочка PR #41/#42 | не в этой ветке | не merge-или |
| `main` | не трогали | по-прежнему mock FastAPI |

P0/P1 из предыдущего аудита (`docs/personal-cabinet-audit.md`), относящиеся к этому заданию, в этой ветке закрыты либо явно отложены как инфраструктура.

---

## Сводный статус по блокам

| Блок | Статус | Кратко |
|---|---|---|
| A. Единый OpenAI | **PASS** | один ключ кабинета, общий лимит, fail-closed |
| B. Коммерция | **PASS** | сценарии недоступны; таблицы не удалены |
| C. Кабинет 10 проектов | **PASS** | create/restore/архив/регистрация |
| D. VK / Telegram | **PASS** | нет тихого global fallback; mock only |
| E. Безопасность | **PASS** | с оговоркой VPS-настроек |
| F. Backup | **PASS** локально / **BLOCKED** production compose | |

---

## Вывод

**Проект соответствует модели личного кабинета одного владельца** в пределах этой кодовой базы: один OpenAI на кабинет, до 10 активных проектов, коммерческие checkout/тарифы не участвуют в рабочем пути, публикация не берёт чужой или глобальный соцаккаунт по умолчанию.

Это **не** разрешение включать `AI_LIVE_ENABLED`, публиковать в VK/Telegram, деплоить или вливать в `main`. Нужно отдельное решение владельца после ревью этого PR.

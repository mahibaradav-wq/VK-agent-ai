# Итоговый отчёт: личный кабинет Polka Social

Дата проверки: 24 ноября 2026, ~22:30 Europe/Moscow.  
Задание: устранение замечаний приёмки PR #59 — коммерческие сценарии должны быть исключены из рабочего приложения, а не выключены флагом.  
Production, SSH, merge в `main`, живые публикации, реальные платежи и платные вызовы OpenAI не выполнялись.

**Это не заявление о 100% готовности включать `AI_LIVE_ENABLED` или деплоить.** Ниже — фактические статусы проверок.

---

## 1. Проверенный branch и commit SHA

| Поле | Значение |
|---|---|
| Рабочая ветка | `cursor/personal-openai-cabinet-ee77` |
| PR | [#59](https://github.com/mahibaradav-wq/VK-agent-ai/pull/59) |
| SHA до этой правки | `fca32cf8e6b6ed81ac29c8720b5685170a57c5ff` |
| SHA этой правки | `9dee4a9270535c304e9869ae3dedb60be1f82cdc` |
| База | PR [#57](https://github.com/mahibaradav-wq/VK-agent-ai/pull/57) `cursor/personal-cabinet-safety-ee77` @ `78a319b` |
| `main` | FastAPI/SQLite mock `252230b`; не живой продукт, не менялся |

Работа шла в текущей ветке PR #59, без новой PR-цепочки и без merge.

---

## 2. Состояние исходного PR

PR **#59** «Personal cabinet: one OpenAI, no commercial path, 10 projects»:

- состояние на старте этой правки: **open**, HEAD `fca32cf`;
- CI Test на `fca32cf`: **success** (GitHub Actions, 24.11.2026 22:00 Europe/Moscow);
- в `main` не влит;
- стек: #59 стоит над #57.

Эта правка **обновляет #59**. Merge, deploy и изменение `main` не выполнялись.

---

## 3. Что удалено из рабочего приложения

Удалены рабочие коммерческие сценарии, а не спрятаны за `BILLING_CHECKOUT_ENABLED`:

| Компонент | Как исключён |
|---|---|
| `PLAN_CATALOG` / `src/modules/billing/plans.ts` | файл удалён |
| `PricingTable` | файл удалён |
| `subscription-board.tsx` | файл удалён |
| ЮKassa (`yookassa.ts`, `yookassa.test.ts`) | файлы удалены |
| HMAC-checkout (`hmac-provider.ts`, `signature.ts`) | файлы удалены |
| Checkout / cancel / webhook в `billing-service` | заглушка: любой вызов → 403 |
| `BILLING_CHECKOUT_ENABLED` | больше не читается кодом приложения; `isCommercialBillingEnabled()` всегда `false` |
| `YOOKASSA_*` / `BILLING_WEBHOOK_SECRET` | не выбирают провайдера; `createBillingProviderFromEnv()` всегда `disabled` |
| `/admin/plans` | страница редиректит на `/admin`; пункт навигации снят |
| `PlanLimitsForm` / `updatePlanLimits` action | удалены из UI; сервис бросает 403 |
| Регистрация → `Plan`/`Subscription` | `attachFreeSubscription` / `ensureCanonicalPlans` убраны |
| Env how-to ЮKassa | убрано из `.env.example`, `.env.production.example`, `docs/environment.md` |

Оставшиеся заглушки, чтобы случайный импорт не включил оплату:

- `src/modules/cabinet/commercial.ts` — всегда `false`, HTTP 410;
- `src/modules/billing/billing-service.ts` — 403 на все коммерческие методы, `allowCommercial` игнорируется;
- `src/server/billing/index.ts` — только `disabled`;
- `src/modules/billing/actions.ts` — server actions возвращают сообщение «не продаёт тарифы».

---

## 4. Какие коммерческие маршруты исключены

| Маршрут | Поведение |
|---|---|
| `GET/POST/PUT/PATCH/DELETE /api/subscription` | **410 Gone**, JSON `{ ok: false }` |
| `GET/POST/PUT/PATCH/DELETE /api/webhooks/billing` | **410 Gone**, JSON `{ ok: false }` |
| `/app/subscription` | редирект на `/app` |
| `/admin/plans` | редирект на `/admin` |
| `/pricing` | информационная страница «тарифы не продаются», без checkout и без `PricingTable` |

Скрытых рабочих платёжных endpoints нет: провайдер ЮKassa не импортируется, webhook не проверяет подпись и не пишет `PaymentEvent`.

`BILLING_CHECKOUT_ENABLED=true`, `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` и `BILLING_WEBHOOK_SECRET` **не включают** checkout. Это покрыто unit-тестами `cabinet.test.ts` и `billing.test.ts`.

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
- `UsageRecord` считает AI/посты кабинета и больше не зависит от `Plan`/`PLAN_CATALOG`.

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

## 8. Что осталось в базе данных и почему

Статус: **PASS**. Таблицы и миграции **не удалялись**. Пользовательские данные не трогались.

| Таблица | В рабочем приложении | Почему оставлена |
|---|---|---|
| `Plan` | не читается и не пишется | история миграций и возможные старые строки; DROP потребовал бы отдельной миграции и разрешения владельца |
| `Subscription` | регистрация больше **не** создаёт строку | то же; безопасная отвязка уже сделана в коде |
| `CheckoutSession` | нет писателей | схема ЮKassa остаётся в PostgreSQL без сценария оплаты |
| `PaymentEvent` | нет писателей | webhook отвечает 410 и не идемпотентит платежи |
| `UsageRecord` | **используется** | внутренний учёт AI и постов (`reserveUsage` + advisory lock), не коммерческий биллинг |
| `WorkspaceAiConnection` | **используется** | единый ключ OpenAI кабинета |
| `AuditLog` | **используется** | журнал, в том числе `AI_PAID_DENIED` |
| `Project.archivedAt` | **используется** | архив / restore при cap=10 |

`npx prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` (отдельная shadow-БД) — **различий нет**. 17 миграций, schema up to date. Отдельная DROP-миграция **не нужна** на этом этапе.

Безопасная очистка позже, только по решению владельца: бэкап → убедиться, что приложение не читает таблицы → миграция DROP.

---

## 9. Что сохранено из уже принятых решений PR #59

Не нарушено:

- единый OpenAI для проектов владельца и одно место хранения ключа;
- централизованные настройки моделей;
- общий месячный лимит AI, `AI_LIVE_ENABLED`, `AI_MONTHLY_HARD_LIMIT`, защита от конкурентного превышения;
- лимит 10 активных проектов, архивирование и восстановление;
- запрет глобального fallback VK/Telegram;
- закрытая регистрация после создания владельца.

Новые AI-провайдеры не подключались. Настройки AI не менялись. Реальных платных запросов не было.

---

## 10. Как реализован лимит 10 активных проектов

Статус: **PASS**.

- Константа `PERSONAL_ACTIVE_PROJECT_LIMIT = 10`.
- `create` и `restore` в транзакции: `lockWorkspaceMetric(projects)` + `count(archivedAt: null)`.
- Конкурентное создание: тест `caps active projects at 10 even under concurrent creates`.
- Восстановление при полном cap отклоняется; чужой workspace не восстанавливает чужой проект (403).
- UI: форма создания, «В архив», список архива и «Восстановить».

Клиентские workspace, платные аккаунты и коммерческие роли не вводились. Регистрация: первый пользователь на пустой БД проходит; дальше — только `AUTH_ALLOW_PUBLIC_REGISTRATION=true` или действующее приглашение.

---

## 11. Результаты проверки VK и Telegram

Статус: **PASS** на mock-адаптерах. Живые публикации: не выполнялись.

- `resolvePublishSocialAccount` принимает только `connected` аккаунт **этого** `post.projectId`.
- Bound global (`projectId=null`) и чужой проект → `integration_not_configured`, без `sendMessage`/`wall.post`.
- Подключение без `projectId` по-прежнему сохраняет токен как явный общий ресурс, но публикация его не берёт.
- Реальных вызовов VK/Telegram API не было.

---

## 12. Результаты проверки безопасности

Статус: **PASS** для реализованных контролей; часть рисков — инфраструктура VPS.

Проверено тестами/кодом:

- auth + Owner; коммерческий checkout недоступен даже Superadmin;
- IDOR проектов и соцаккаунтов;
- изоляция OpenAI-ключа между владельцами;
- rate limit логина/регистрации по `X-Real-IP`;
- AES-256-GCM токенов;
- секреты не попадают в JSON ответов и audit details;
- публичная регистрация закрыта по умолчанию;
- коммерческие HTTP 410 без обработки платежа.

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

Локальный dump/restore из предыдущей итерации PR #59 не повторялся: схема и миграции не менялись. Синтаксис скриптов проверен снова.

| Проверка | Статус | Комментарий |
|---|---|---|
| `bash -n` backup/restore/vps scripts | **PASS** | синтаксис |
| Полный `restore-vps.sh` через docker compose production | **BLOCKED** | к production не подключались |
| Расписание и копия вне VPS | **BLOCKED** | нужна настройка сервера владельцем |

Destructive restore на живых данных не выполнялся.

---

## 14. Точные команды тестирования и результаты

Среда: локальный PostgreSQL `polka_social`, без платного OpenAI, без VK/Telegram live, без ЮKassa.

| Команда | Результат |
|---|---|
| `npx vitest run` | **PASS** 51 files, 250 tests (меньше 259: удалены тесты живого ЮKassa/HMAC) |
| `npm run typecheck` | **PASS** |
| `npm run lint` | **PASS** |
| `npm run build` | **PASS** (предупреждения Turbopack про `spawn` ffmpeg, не ошибки) |
| `npx prisma validate` | **PASS** |
| `npx prisma migrate status` | **PASS** 17 migrations, schema up to date |
| `prisma migrate diff --from-migrations … --exit-code` | **PASS** No difference detected (отдельная shadow-БД, затем удалена) |
| `bash -n scripts/backup-vps.sh scripts/restore-vps.sh scripts/vps-up.sh scripts/vps-pull.sh` | **PASS** |
| `npx playwright test` (`AUTH_ALLOW_PUBLIC_REGISTRATION=true`, `npm start` после build) | **PASS** 8 tests, включая 410 на `/api/subscription` и `/api/webhooks/billing` |
| конкурентное создание проектов | **PASS** внутри vitest |
| единый OpenAI / общий AI-лимит / отказ live | **PASS** внутри vitest |
| коммерческие HTTP 410; env не включает оплату | **PASS** внутри vitest и e2e |
| живой OpenAI | **не выполнялся** |
| живые VK/Telegram | **не выполнялись** |
| реальные платежи | **не выполнялись** |
| CI GitHub SHA `9dee4a9` | после push: смотреть check Test на PR #59 |

Целевые тесты:

- `src/modules/billing/billing.test.ts` — нет Plan/Subscription при регистрации, env не включает оплату, HTTP 410, `UsageRecord` атомарно
- `src/modules/cabinet/cabinet.test.ts` — `BILLING_CHECKOUT_ENABLED` и `allowCommercial` бесполезны; единый OpenAI
- `src/modules/admin/admin.test.ts` — Superadmin не управляет тарифами
- `src/server/hosting/production-stack.test.ts` — нет `PricingTable`, ЮKassa, `/admin/plans`, коммерческих файлов
- `src/modules/projects/project-service.test.ts` — cap 10 + restore
- `e2e/http.spec.ts` — commercial billing routes are gone

---

## 15. Оставшиеся ограничения

| Тема | Статус | Суть |
|---|---|---|
| Таблицы `Plan` / `Subscription` / `CheckoutSession` / `PaymentEvent` | ограничение | оставлены в PostgreSQL без рабочих сценариев |
| Файлы `/api/subscription` и `/api/webhooks/billing` | ограничение | отвечают 410, чтобы не оставлять скрытый рабочий endpoint |
| `/pricing` | ограничение | страница-уведомление, не витрина |
| `src/server/billing/types.ts` | ограничение | типы заглушки `disabled`, без ЮKassa |
| Env `AI_API_KEY` | ограничение | запасной провайдер из env, если в кабинете нет ключа; всё равно режется live-guard |
| Probe ключа при выключенном AI | ограничение | connect с реальным `/models` заблокирован вместе с генерацией |
| 2FA, nonce-CSP, внешний backup | не сделано | внешняя инфраструктура / отдельные задачи |
| `main` | не трогали | по-прежнему mock FastAPI |
| Deploy / merge | не выполнялись | ждут проверки владельца |

P0 приёмки PR #59 (коммерция только выключена флагом) в этой правке закрыт: флаг больше не является выключателем оплаты.

---

## Сводный статус по блокам

| Блок | Статус | Кратко |
|---|---|---|
| A. Единый OpenAI | **PASS** | один ключ кабинета, общий лимит, fail-closed |
| B. Коммерция | **PASS** | сценарии удалены из рабочего приложения; env не включает оплату; таблицы БД сохранены |
| C. Кабинет 10 проектов | **PASS** | create/restore/архив/регистрация |
| D. VK / Telegram | **PASS** | нет тихого global fallback; mock only |
| E. Безопасность | **PASS** | с оговоркой VPS-настроек |
| F. Backup | **PASS** синтаксис скриптов / **BLOCKED** production compose | |

---

## Вывод

**Проект соответствует модели личного кабинета одного владельца:** один OpenAI на кабинет, до 10 активных проектов, коммерческие checkout/тарифы/ЮKassa из рабочего приложения исключены, `BILLING_CHECKOUT_ENABLED` ничего не включает, публикация не берёт чужой или глобальный соцаккаунт по умолчанию.

Это **не** разрешение включать `AI_LIVE_ENABLED`, публиковать в VK/Telegram, деплоить или вливать в `main`. Нужно отдельное решение владельца после ревью этого PR.

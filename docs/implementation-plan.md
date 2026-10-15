# План реализации SaaS-платформы управления соцсетями

Документ относится к этапу 1. На этом этапе не пишется код приложения.

## 1. Результат исследования репозитория

Текущий репозиторий содержит Python/FastAPI mock MVP с SQLite, Jinja-шаблонами и
pytest. Это полезный функциональный прототип, но он не соответствует целевому
стеку из `AGENTS.md`.

Целевой продукт следует реализовывать как Next.js/TypeScript SaaS-приложение с
PostgreSQL, Prisma, Auth.js, Tailwind CSS и модульной backend-логикой. Текущий
FastAPI код не удаляется на этапе 1. Решение о миграции/замене принимается на
этапе 2.

## 2. Принятые технические решения

| Вопрос | Решение |
|---|---|
| Frontend/backend | Next.js App Router |
| Язык | TypeScript strict |
| UI | Tailwind CSS + shadcn/ui |
| ORM | Prisma |
| БД | PostgreSQL |
| Auth | Auth.js |
| Email в dev | локальный mail viewer/dev transport |
| Очереди | Redis + BullMQ |
| Медиа | S3-compatible storage |
| AI | provider adapter, ключи только server-side |
| Billing | provider interface, без фиктивных оплат |
| Тесты | Vitest + Playwright |
| Локальная инфраструктура | Docker Compose |

## 3. Зависимости и внешние сервисы

### Обязательные для рабочего продукта

- PostgreSQL;
- Redis;
- S3-compatible storage;
- email provider или dev mail stand;
- официальные credentials первой выбранной соцплатформы;
- AI provider key;
- billing provider credentials;
- мониторинг ошибок и логов.

### Решения, влияющие на бюджет/безопасность

- AI provider: влияет на стоимость генераций и лимиты пользователей.
- Billing provider: требует webhook verification и юридической настройки.
- Social APIs: требуют официальных OAuth/API credentials и соблюдения правил
  платформ.
- S3 storage: требует настройки приватного доступа и signed URLs.

## 4. Карта этапов

### Этап 1. Исследование и документы

Статус: выполнен в рамках текущего поручения.

Deliverables:

- исследование текущего репозитория;
- `docs/architecture.md`;
- `docs/implementation-plan.md`;
- карта маршрутов;
- модель данных;
- список зависимостей и внешних сервисов;
- предложение минимального вертикального среза.

Проверки:

- TypeScript: не применимо, Next.js приложение ещё не создано;
- lint: не применимо, код приложения не изменялся;
- tests: не применимо для этапа 1, так как изменялась только документация;
- build: не применимо, целевое приложение ещё не создано;
- миграции: не применимо.

### Этап 2. Настройка Next.js проекта и публичного сайта

Статус: выполнен. Публичный сайт, дизайн-система, metadata, sitemap/robots и формы со статусом настройки добавлены. `npm run lint`, `npm run typecheck` и `npm run build` проходят.

Deliverables:

- Next.js App Router;
- TypeScript strict;
- Tailwind CSS;
- shadcn/ui;
- CSS variables/design tokens;
- базовый marketing layout;
- страницы: главная, возможности, автопостинг, AI, аналитика, редактор,
  медиатека, команда, тарифы, FAQ, блог, статья, help, контакты, login,
  register, forgot/reset password, privacy, terms;
- sitemap.xml, robots.txt, metadata/canonical/Open Graph;
- базовые состояния UI: loading, empty, error, success, disabled, skeleton.

Проверки:

- typecheck;
- lint;
- unit tests для UI helpers;
- production build;
- ручная проверка responsive desktop/mobile.

### Этап 3. PostgreSQL, Prisma и авторизация

Статус: выполнен. Добавлены Docker Compose, Prisma-миграция, Auth.js, локальный почтовый стенд, создание workspace и защита `/app`. `npm run lint`, `npm run typecheck`, `npm test` и `npm run build` проходят.

Deliverables:

- Docker Compose для PostgreSQL;
- Prisma schema и первая миграция;
- Auth.js email/password;
- подтверждение email через dev mail;
- восстановление пароля;
- создание workspace при регистрации;
- server-side session checks;
- защита private routes.

Проверки:

- миграции применяются с нуля;
- регистрация/вход/выход;
- email verification;
- password reset;
- негативные тесты неверных токенов и занятых email.

### Этап 4. Workspaces, проекты, роли и изоляция данных

Статус: выполнен. Добавлены Project, матрица прав Owner/Admin/Editor/Approver/Viewer, server-side `AccessError`, переключение workspace/project и страницы `/app/projects` и `/app/team`. `npm run lint`, `npm run typecheck`, `npm test` (13) и `npm run build` проходят. Миграция `20261012194200_add_project` применяется.

Deliverables:

- WorkspaceMember;
- роли Owner/Admin/Editor/Approver/Viewer;
- проекты;
- переключение workspace/project;
- матрица permissions;
- server-side authorization helpers.

Проверки:

- пользователь не видит чужой workspace;
- подмена projectId/accountId/mediaId блокируется;
- роли не могут повышать себя самостоятельно;
- Viewer не создаёт проект;
- Admin не назначает Owner и не меняет равного Admin.

### Этап 5. Редактор публикаций и медиатека

Статус: выполнен. Добавлены Post, PostVersion, PostTarget, MediaAsset, редактор черновиков, медиатека, MIME-проверка и предпросмотр по внутренним шаблонам. S3-адаптер настоящий: без credentials загрузка не имитируется. `npm run lint`, `npm run typecheck`, `npm test` (19) и `npm run build` проходят. Миграция `20261014181100_add_posts_and_media` применяется.

Deliverables:

- редактор публикации;
- версии контента;
- PostTarget;
- сохранение черновика;
- media upload в S3;
- MIME/size validation;
- привязка media к post;
- предпросмотр по собственным шаблонам.

Проверки:

- сохранение черновика;
- загрузка валидного файла;
- отказ опасных/неподдержанных типов;
- version invalidation;
- подмена mediaId блокируется;
- отсутствие S3 credentials не создаёт фиктивный успех.

### Этап 6. Календарь контента

Статус: выполнен. Добавлены Schedule в UTC, страница `/app/calendar` с режимами месяц/неделя/день/список, фильтры, поиск, создание по дате и перенос с проверкой прав. `npm run lint`, `npm run typecheck`, `npm test` (26) и `npm run build` проходят. Миграция `20261014193200_add_schedule` применяется.

Deliverables:

- режимы месяц/неделя/день/список;
- фильтры по проектам, аккаунтам, статусам;
- поиск;
- создание по выбранной дате;
- изменение расписания;
- UTC storage + timezone display.

Проверки:

- смена дат;
- фильтры;
- проверка прав при переносе;
- edge cases timezone/DST;
- Viewer не переносит чужие и свои слоты без post.update.

### Этап 7. Очереди и автопостинг

Статус: выполнен. Добавлены Redis/BullMQ, PublishJob/PublishAttempt, ключ идемпотентности, атомарный claim, экспоненциальный backoff, `requires_manual_check` и агрегированный статус Post. Без credentials адаптер возвращает `integration_not_configured`, успешные цели повторно не отправляются. `npm run lint`, `npm run typecheck`, `npm test` (33) и `npm run build` проходят. Миграция `20261014203000_add_publish_jobs` применяется. В браузере: черновик «Очередь этапа 7» поставлен в очередь, worker обработал job, VK и Telegram получили `permanent_failure` / `integration_not_configured`, фиктивного успеха нет.

Deliverables:

- Redis + BullMQ;
- PublishJob;
- PublishAttempt;
- idempotency key;
- atomic claim;
- retries with exponential backoff;
- статус `requires_manual_check`;
- агрегированный статус Post.

Проверки:

- защита от повторной отправки;
- retry only temporary failures;
- partial success;
- неуспешная цель повторяется без повторной отправки успешной.

### Этап 8. Первая реальная социальная платформа

Статус: выполнен. Первая официальная интеграция — Telegram Bot API (токен @BotFather, без пароля пользователя). VK ID не подключается: Authorization Code Flow отключён с 25.06.2024, право `wall` выдаётся через поддержку. Добавлены SocialAccount/capabilities, шифрование токенов, обработка `token_expired` и `429`, страница `/app/social-accounts`. `npm run lint`, `npm run typecheck`, `npm test` (42) и `npm run build` проходят. Миграция `20261015180000_add_social_accounts` применяется. В браузере: поле пароля соцсети отсутствует; `requires_setup` создаётся без токена; паролеподобный ввод отвергается; фейковый токен получает `Unauthorized` от Telegram, без фиктивного успеха.

Deliverables:

- таблица исследования платформ;
- выбор первой официально доступной интеграции;
- OAuth/API подключение;
- capabilities;
- adapter implementation;
- обработка token expired/rate limits/API errors.

Проверки:

- подключение только официальным механизмом;
- отсутствие запросов пароля соцсети;
- понятная ошибка без credentials;
- ручная проверка в интеграционном окружении.

### Этап 9. AI-ассистент

Статус: выполнен. Добавлены интерфейс провайдера (OpenAI-compatible), история `AIRequest`, учёт `UsageRecord` с атомарным лимитом, типы идей/поста/заголовков/CTA/хештегов, адаптация тона/длины/платформы и перенос в редактор. Без `AI_API_KEY` сервер показывает настройку, а не фиктивный ответ модели. Ключ во frontend не попадает. `npm run lint`, `npm run typecheck`, `npm test` (47) и `npm run build` проходят. Миграция `20261015194000_add_ai_assistant` применяется. В браузере: баннер настройки, макет явно не ответ модели, генерация без ключа отклоняется, история пустая, секретов в HTML нет.

Deliverables:

- AI provider interface;
- generation history;
- идеи, посты, заголовки, CTA, хештеги;
- tone/length/platform adaptation;
- лимиты и usage accounting;
- перенос результата в редактор.

Проверки:

- ключ не попадает во frontend;
- отсутствие ключа показывает настройку/demo, не фиктивный рабочий ответ;
- лимиты соблюдаются.

### Этап 10. Аналитика

Статус: выполнен. Добавлены `AnalyticsSnapshot` с nullable метриками и `rawPayload`, сбор `getChatMemberCount` для Telegram, дашборд `/app/analytics` на Recharts, фильтры по датам/проектам/аккаунтам. Недоступные показы/охват не записываются как ноль; без реальных снимков показывается явная демо-метка, демо не смешивается с итогами. `npm run lint`, `npm run typecheck`, `npm test` (56) и `npm run build` проходят. Миграция `20261015200000_add_analytics_snapshots` применяется. В браузере: без снимков — баннер «Демо-данные» и графики с подписью «Демо-ряд»; сбор без токена не создаёт снимок; реальный Telegram-снимок показывает подписчиков 321, показы/охват «недоступно» без графика нулей, source и collectedAt на карточке, демо исключено из итогов.

Deliverables:

- normalized analytics layer;
- raw platform payload;
- dashboard;
- Recharts charts;
- фильтры по датам/проектам/аккаунтам;
- demo data clearly marked if real data absent.

Проверки:

- корректная агрегация;
- unknown metric availability handled;
- источник и collectedAt отображаются.

### Этап 11. Командная работа и согласование

Deliverables:

- приглашения;
- роли;
- комментарии к публикациям;
- approval workflow;
- уведомления о статусах;
- audit history.

Проверки:

- Approver может одобрить только разрешённый проект;
- Editor не может публиковать без approval;
- Viewer read-only.

### Этап 12. Подписки и платежи

Deliverables:

- тарифы в конфигурации/БД;
- subscription state;
- provider interface;
- webhook verification;
- PaymentEvent idempotency;
- usage limits atomic reservation.

Проверки:

- пользователь не считается оплатившим только после redirect;
- replay webhook не меняет состояние повторно;
- лимиты устойчивы к параллельным запросам.

### Этап 13. Админка и уведомления

Deliverables:

- admin-only routes;
- пользователи/workspaces/plans/integrations/queues/errors/audit;
- notification center;
- mark as read;
- email notification adapter.

Проверки:

- admin access только server-side;
- обычный пользователь не видит admin data;
- critical admin actions audited.

### Этап 14. Полное тестирование, безопасность, документация и deploy

Deliverables:

- security review;
- e2e coverage critical flows;
- production build;
- deployment docs;
- environment docs;
- runbooks для очередей и интеграций.

Проверки:

- all tests pass;
- production build pass;
- secrets not exposed;
- DB migrations from clean state;
- documented launch procedure works.

## 5. Минимальный вертикальный срез

Цель: получить маленький, но полностью рабочий SaaS-path без фиктивных успехов.

Объём:

1. Регистрация email/password.
2. Подтверждение email через dev mail.
3. Автоматическое создание workspace.
4. Создание проекта.
5. Создание демонстрационного social account со статусом `requires_setup`.
6. Создание черновика публикации.
7. Сохранение версии публикации.
8. Отправка на согласование.
9. Approval текущей версии владельцем.
10. Планирование публикации.
11. Создание PublishJob.
12. Worker забирает job.
13. Adapter возвращает `integration_not_configured`.
14. PostTarget получает `failed` или `requires_manual_check`.
15. PublishAttempt, Notification и AuditLog сохраняются.

Почему этот срез выбран:

- проверяет auth;
- проверяет workspace isolation;
- проверяет проекты;
- проверяет редактор;
- проверяет approval;
- проверяет очередь;
- проверяет adapter boundary;
- не создаёт ложных внешних публикаций.

## 6. Блокеры перед этапом 2

Перед началом реализации нужно принять техническое решение:

1. Текущий FastAPI MVP оставить как архивный прототип или заменить целевым
   Next.js проектом в этом же репозитории.
2. Выбрать Auth.js email provider для production и dev mail stand.
3. Выбрать S3-compatible storage для dev/prod.
4. Выбрать первую реальную социальную платформу только после проверки
   официальной документации и доступности credentials.
5. Уточнить, нужен ли billing на раннем MVP или только архитектурный интерфейс до
   этапа 12.


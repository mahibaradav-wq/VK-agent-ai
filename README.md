# Polka Social

SaaS-платформа для планирования публикаций, AI-подготовки контента, согласований и аналитики соцсетей.

Этап 14: безопасность, e2e критических потоков, миграции с чистой БД и документация запуска. Доступ к /admin только у PlatformAdmin.

## Требования

- Node.js 22+
- npm
- Git

## Windows

Сайт на `127.0.0.1` открывается только на том компьютере, где сейчас запущен `start.bat`. Облачный агент Cursor — другой компьютер: его localhost до вашего Chrome не достучаться.

Ошибка «Сайт 127.0.0.1 не позволяет установить соединение» значит: на вашем ПК нет процесса на порту 3000 (окно сервера закрыто, Docker не запущен, или открыт адрес без `:3000`).

1. Поставьте [Docker Desktop](https://www.docker.com/products/docker-desktop/) и дождитесь, пока он запустится.
2. Скачайте репозиторий и откройте папку проекта.
3. Один раз: `setup.bat` (Git, Node.js LTS, `npm install`).
4. Каждый запуск: `start.bat`. Не закрывайте чёрное окно.
5. Когда в окне появится `Ready`, откройте:

```text
http://localhost:3000
```

Письма подтверждения: `http://localhost:3000/dev/mailbox`. Жив ли сервер: `http://localhost:3000/api/health`.

Если `winget` недоступен, поставьте вручную:

- Git: https://git-scm.com/download/win
- Node.js LTS: https://nodejs.org
- Docker Desktop: https://www.docker.com/products/docker-desktop/

## База данных

```bash
docker compose up -d
npx prisma migrate deploy
npm run worker
```

Без Docker можно использовать локальный PostgreSQL с тем же `DATABASE_URL`, что в `.env.example`.

## Установка

```bash
npm install
cp .env.example .env
```

Заполните `AUTH_SECRET` в `.env`.

## Запуск

```bash
npm run dev
```

Открыть:

```text
http://localhost:3000
```

Регистрация создаёт workspace с ролью Owner. Письма подтверждения, сброса пароля и приглашений не уходят во внешнюю почту — они лежат в `/dev/mailbox`. После подтверждения email кабинет `/app` показывает текущее пространство, проекты, черновики, календарь, очередь, AI, аналитику, команду и уведомления. Подмена чужого `workspaceId`/`projectId`/`mediaId` на сервере отклоняется. Без настроек S3 загрузка не притворяется успешной: по умолчанию файлы пишутся в локальный стенд `data/media`. Без Redis задачи всё равно пишутся в PostgreSQL; диспетчер BullMQ требует `REDIS_URL`. Первая соцплатформа — Telegram Bot API: токен от @BotFather шифруется на сервере. Без токена адаптер возвращает `integration_not_configured`, а не фиктивный успех. Пароль Telegram/VK не принимается. Без `AI_API_KEY` ассистент показывает настройку, а не выдуманный текст модели. Аналитика Telegram берёт `getChatMemberCount`; показы и охват недоступны и не заполняются нулями. Без реальных снимков графики помечены как демо. В очередь уходит только согласованная текущая версия. Без `BILLING_WEBHOOK_SECRET` оплата не имитируется. Платный статус ставит только проверенный webhook; повтор того же события не меняет состояние. Админка `/admin` открывается только платформенным администраторам из `ADMIN_EMAILS` или таблицы `PlatformAdmin`. Выдача роли и смена лимитов тарифа пишутся в audit. Почтовые уведомления идут через адаптер: локальный стенд или HTTP-провайдер, без фиктивной внешней отправки.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Запуск после сборки: `npm start`, проверка `curl -fsS http://127.0.0.1:3000/api/health`.

## Основные страницы

- `/` — главная
- `/features` — возможности
- `/pricing` — тарифы
- `/faq` — вопросы
- `/blog` — блог
- `/help` — справка
- `/contacts` — контакты
- `/login` и `/register` — вход и регистрация
- `/forgot-password` и `/reset-password` — восстановление доступа
- `/app` — кабинет и переключение workspace/project
- `/app/projects` — проекты текущего пространства
- `/app/calendar` — календарь: месяц, неделя, день, список
- `/app/posts` — черновики публикаций
- `/app/ai` — AI-ассистент контента
- `/app/analytics` — аналитика: фильтры, графики, источник и collectedAt
- `/app/queue` — очередь автопостинга
- `/app/social-accounts` — Telegram Bot API и статусы интеграций
- `/app/media` — медиатека
- `/app/team` — приглашения, роли и проекты Approver
- `/app/notifications` — уведомления о согласовании и комментариях
- `/app/subscription` — тариф, лимиты и статус оплаты
- `/admin` — обзор платформы (только PlatformAdmin)
- `/admin/users` — пользователи и выдача ролей админки
- `/admin/workspaces` — все рабочие пространства
- `/admin/plans` — лимиты тарифов
- `/admin/integrations` — статусы интеграций без секретов
- `/admin/queues` — очередь публикаций
- `/admin/errors` — сбойные задачи и аккаунты
- `/admin/audit` — журнал действий
- `/accept-invite` — принятие приглашения из локального почтового стенда

Формы сайта проверяют ввод и показывают статус «Требуется настройка интеграции», если backend ещё не подключён. Письма и платежи не имитируются.

## Документация

- [Архитектура](docs/architecture.md)
- [План реализации](docs/implementation-plan.md)
- [Исследование соцплатформ](docs/social-platforms.md)
- [Безопасность](docs/security.md)
- [Переменные окружения](docs/environment.md)
- [Запуск и выкладка](docs/deploy.md)
- [Очереди](docs/runbooks/queues.md)
- [Интеграции](docs/runbooks/integrations.md)

# Polka Social

SaaS-платформа для планирования публикаций, AI-подготовки контента, согласований и аналитики соцсетей.

Этап 10: аналитика. Нормализованные метрики и сырой payload платформы; без реальных снимков дашборд показывает явно помеченные демо-данные.

## Требования

- Node.js 22+
- npm
- Git

## Windows

Я не могу установить программы на ваш компьютер удалённо. На Windows запустите установку сами:

1. Скачайте репозиторий и откройте папку проекта.
2. Дважды нажмите `setup.bat`.

Скрипт поставит Git и Node.js LTS через `winget`, переключит ветку `cursor/saas-stage-one-ee77` и выполнит `npm install`.

После этого в новом PowerShell:

```powershell
cd путь\к\VK-agent-ai
npm run dev
```

Откройте:

```text
http://localhost:3000
```

Если `winget` недоступен, поставьте вручную:

- Git: https://git-scm.com/download/win
- Node.js LTS: https://nodejs.org

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

Регистрация создаёт workspace с ролью Owner. Письма подтверждения и сброса пароля не уходят во внешнюю почту — они лежат в `/dev/mailbox`. После подтверждения email кабинет `/app` показывает текущее пространство, проекты, черновики, календарь, очередь, AI, аналитику и социальные аккаунты. Подмена чужого `workspaceId`/`projectId`/`mediaId` на сервере отклоняется. Без настроек S3 загрузка не притворяется успешной: по умолчанию файлы пишутся в локальный стенд `data/media`. Без Redis задачи всё равно пишутся в PostgreSQL; диспетчер BullMQ требует `REDIS_URL`. Первая соцплатформа — Telegram Bot API: токен от @BotFather шифруется на сервере. Без токена адаптер возвращает `integration_not_configured`, а не фиктивный успех. Пароль Telegram/VK не принимается. Без `AI_API_KEY` ассистент показывает настройку, а не выдуманный текст модели. Аналитика Telegram берёт `getChatMemberCount`; показы и охват недоступны и не заполняются нулями. Без реальных снимков графики помечены как демо.

## Проверки

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

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
- `/app/team` — участники и роли

Формы сайта проверяют ввод и показывают статус «Требуется настройка интеграции», если backend ещё не подключён. Письма и платежи не имитируются.

## Документация

- [Архитектура](docs/architecture.md)
- [План реализации](docs/implementation-plan.md)
- [Исследование соцплатформ](docs/social-platforms.md)

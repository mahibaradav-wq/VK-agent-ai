# Polka Social

SaaS-платформа для планирования публикаций, AI-подготовки контента, согласований и аналитики соцсетей.

Этап 2: публичный сайт, дизайн-система и рабочие маршруты. Авторизация, база данных и реальные интеграции ещё не подключены.

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

## Установка

```bash
npm install
```

## Запуск

```bash
npm run dev
```

Открыть:

```text
http://localhost:3000
```

## Проверки

```bash
npm run lint
npm run typecheck
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

Формы сайта проверяют ввод и показывают статус «Требуется настройка интеграции», если backend ещё не подключён. Письма и платежи не имитируются.

## Документация

- [Архитектура](docs/architecture.md)
- [План реализации](docs/implementation-plan.md)

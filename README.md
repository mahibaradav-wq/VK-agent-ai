# MVP «Дом по полочкам»

Система управления контентом и товарами для сообщества ВКонтакте. Проект
помогает готовить идеи, товары и материалы, проводить ревизию, получать
одобрение владельца и безопасно публиковать материалы в mock-режиме.

## Важно

Сейчас проект работает в **MOCK-режиме**. Реальная публикация в VK, Ozon и
Telegram отключена: все операции происходят локально в SQLite, а интеграции
возвращают детерминированные mock-ответы.

## Возможности MVP

- Создание задач, идей, товаров и контента
- Версионирование контента
- Проверка материалов через сервис ревизии
- Контрольная точка одобрения перед публикацией
- Аннулирование одобрения при изменении текста
- Идемпотентная mock-публикация
- Mock-статистика публикаций
- Полный аудит-лог действий
- Mock AI-генерация идей и черновиков
- Простая HTML-страница статуса

## Требования

- Python 3.11+
- pip

## Установка

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Windows PowerShell:

```powershell
py -3.11 -m venv venv
venv\Scripts\activate
py -3.11 -m pip install -r requirements.txt
```

## Инициализация БД

```bash
python -c "from app.database import init_db; init_db()"
```

Демо-данные:

```bash
python scripts/seed_demo.py
```

## Запуск

```bash
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Открыть браузер:

```text
http://localhost:8000
```

Рабочий кабинет:

```text
http://localhost:8000/app
```

## Тестирование

```bash
pytest tests/ -q
```

## Структура проекта

```text
app/
  main.py              # FastAPI приложение и API endpoints
  config.py            # Настройки окружения
  database.py          # SQLAlchemy + SQLite
  models.py            # ORM модели
  schemas.py           # Pydantic схемы
  repositories.py      # CRUD слой
  services.py          # Бизнес-правила approval/publish
  agents/              # Mock AI-агенты
  integrations/        # Mock-интеграции
  templates/           # HTML шаблоны
  static/              # CSS

tests/                 # Тесты
docs/                  # Документация
data/                  # SQLite и локальные данные
```

## API endpoints

### Сайт

- `GET /` — landing page
- `GET /app` — рабочий кабинет
- `POST /app/products` — создать товар через форму
- `POST /app/ideas` — сгенерировать AI-идею через форму
- `POST /app/content-drafts` — сгенерировать AI-черновик через форму
- `POST /app/content` — создать материал вручную
- `POST /app/content/{id}/review`
- `POST /app/content/{id}/approve`
- `POST /app/content/{id}/publish`

### Системные

- `GET /health` — проверка статуса

### Задачи

- `GET /api/tasks`
- `POST /api/tasks`
- `GET /api/tasks/{task_id}`

### Идеи

- `GET /api/ideas`
- `POST /api/ideas`
- `POST /api/ai/ideas` — создать идею через mock AI

### Товары

- `GET /api/products`
- `POST /api/products`

### Контент

- `GET /api/content`
- `POST /api/content`
- `POST /api/ai/content-drafts` — создать черновик через mock AI
- `GET /api/content/{content_id}`
- `GET /api/content/{content_id}/versions`
- `GET /api/content/{content_id}/reviews`
- `GET /api/content/{content_id}/approvals`
- `PATCH /api/content/{content_id}`
- `POST /api/content/{content_id}/review`
- `POST /api/content/{content_id}/approve`
- `POST /api/content/{content_id}/publish`

### Публикации, уведомления, аудит и метрики

- `GET /api/publications`
- `GET /api/notifications`
- `POST /api/mock/telegram/notify`
- `POST /api/mock/ozon/import-products`
- `GET /api/audit-logs`
- `GET /api/metrics`
- `POST /api/metrics/collect`

## Основной workflow

```text
IDEA -> RESEARCH -> PLANNED -> DRAFT
-> REVIEW_REQUIRED -> REVISION_REQUIRED / READY_FOR_APPROVAL
-> APPROVED -> SCHEDULED -> PUBLISHED
-> METRICS_COLLECTION -> ANALYZED
```

Критичные правила:

1. Без approval публикация запрещена.
2. Изменение текста аннулирует approval.
3. Повторная публикация той же версии не создаёт дубль.
4. Все значимые действия записываются в audit log.

## Mock AI

AI-генерация в MVP детерминированная и не вызывает внешние LLM API.

Создать идею:

```bash
curl -X POST http://localhost:8000/api/ai/ideas \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "хранение специй",
    "house_zone": "кухня",
    "content_format": "пост"
  }'
```

Создать черновик по идее:

```bash
curl -X POST http://localhost:8000/api/ai/content-drafts \
  -H "Content-Type: application/json" \
  -d '{
    "idea_id": "IDEA-AI-...",
    "content_type": "пост"
  }'
```

## Переменные окружения

См. `.env.example`.

```env
DEBUG=True
MOCK_MODE=True
DATABASE_URL=sqlite:///./data/app.db
```

## Документация

- [План реализации](docs/implementation-plan.md)
- [Архитектура](docs/architecture.md)
- [Рабочие процессы](docs/workflows.md)
- [Тестирование](docs/testing.md)
- [Предложения по сайту](docs/site-proposal.md)

## Статус

Версия: `0.1.0`

Статус: mock MVP

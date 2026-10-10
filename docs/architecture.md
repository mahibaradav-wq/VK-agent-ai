# Архитектура

Проект построен как локальный FastAPI MVP с чётким разделением слоёв.

```text
API -> Services -> Repositories -> SQLAlchemy models -> SQLite
```

## Слои

### API

Файл `app/main.py` содержит HTTP endpoints, зависимости FastAPI и обработку ошибок.

### Services

Файл `app/services.py` содержит бизнес-правила:

- создание версий контента;
- сброс approval после изменения материала;
- проверка статуса перед публикацией;
- идемпотентная mock-публикация;
- запись audit log.

### Repositories

Файл `app/repositories.py` содержит небольшие функции доступа к данным.

### Models

Файл `app/models.py` содержит SQLAlchemy ORM-модели.

### Agents

`app/agents/reviewer.py` содержит deterministic mock reviewer. Он не вызывает внешние
LLM API и подходит для тестов.

### Integrations

`app/integrations/mock_publishers.py` содержит mock-публикацию во внешние сервисы.

## Главная инварианта

Публиковать можно только текущую версию контента, для которой есть активное
одобрение владельца.


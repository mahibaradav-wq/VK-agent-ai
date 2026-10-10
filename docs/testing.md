# Тестирование

Запуск:

```bash
pytest tests/ -q
```

Тесты используют временную SQLite-базу и не изменяют `data/app.db`.

## Покрытые правила

- healthcheck возвращает `ok`;
- публикация без approval запрещена;
- review -> approval -> publish workflow работает;
- повторная публикация той же версии идемпотентна;
- изменение материала сбрасывает approval;
- слишком короткий материал требует revision.
- AI endpoints создают идеи и черновики;
- AI-черновик проходит полный approval/publish workflow;
- mock Ozon import создаёт и обновляет товары;
- mock Telegram notification сохраняется локально;
- ручной сбор mock-метрик сохраняет snapshot.


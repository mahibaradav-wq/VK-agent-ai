# Рабочие процессы

## Контент

```text
DRAFT -> REVIEW_REQUIRED -> READY_FOR_APPROVAL -> APPROVED -> PUBLISHED
```

В текущем MVP endpoint `POST /api/content/{id}/review` сразу выполняет mock-ревизию.
Если материал проходит проверку, он получает статус `READY_FOR_APPROVAL`.

## AI generation

Mock AI workflow:

```text
POST /api/ai/ideas
-> Idea(status=ai_generated)
-> POST /api/ai/content-drafts
-> ContentItem(status=DRAFT)
-> review
-> approval
-> publish
```

AI endpoints создают обычные записи в базе. После генерации черновик проходит
тот же workflow, что и контент, созданный вручную.

## Approval

Approval создаётся endpoint-ом:

```text
POST /api/content/{id}/approve
```

Approval привязан к `current_version_hash`. Если материал меняется, предыдущие
approval-записи становятся неактивными.

## Публикация

Публикация выполняется endpoint-ом:

```text
POST /api/content/{id}/publish
```

Правила:

1. Контент должен иметь статус `APPROVED` или `SCHEDULED`.
2. Для текущего `current_version_hash` должен существовать активный approval.
3. Повторная публикация той же версии на ту же платформу возвращает существующий
   mock URL и не создаёт дубль.


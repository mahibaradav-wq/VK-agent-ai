# Итоговый отчёт: изоляция harness admin PostgreSQL (PR #63)

Дата: 25 ноября 2026, Europe/Moscow.

**Итоговый статус: READY WITH WARNINGS**

Отдельный PR поверх PR #62. Merge, deploy, SSH, обследование VPS не выполнялись.

## Идентификаторы

| Поле | Значение |
|---|---|
| Исходный SHA (PR #62) | `889091d2b6b6e5f7e8dfacc3321ed845e74fb92a` |
| База | `cursor/vps-probe-libpq-hardening-ee77` |
| Рабочая ветка | `cursor/vps-probe-harness-isolation-ee77` |
| PR | будет #63 |
| `main` | не менялся |
| PR #61 / #62 | не объединялись |

Конечный SHA и ссылки CI — после push.

## Исправленный риск

Harness раньше вызывал `subprocess.run(["psql", admin])` с `DATABASE_URL` или `.env` без allowlist и без изоляции libpq. При production URL возможен CREATE/DROP на чужой БД.

Теперь: только `PROBE_HARNESS_ADMIN_URL`, строгий allowlist (loopback, порт 5432, user `polka`, maintenance DB `postgres`/`polka_social`), отказ при любом `PG*`, запуск через `env -i`, журнал `PROBE_CLIENT_LOG`.

## Изменённые файлы

- `scripts/lib/vps-common.sh` — harness admin validator + `vps_harness_*`
- `scripts/tests/vps-ops.test.sh` — без subprocess/`.env`/DATABASE_URL fallback
- `src/server/db/migrations.test.ts` — allowlist + минимальное env
- `src/server/hosting/production-stack.test.ts`
- `.github/workflows/ci.yml`, `.github/workflows/vps-readiness.yml` — `PROBE_HARNESS_ADMIN_URL`
- `docs/vps-probe-security.md`, `docs/vps-probe-libpq-inventory.md`, `docs/vps-readiness-final-report.md`

## Результаты тестов (локально)

| Сценарий | Результат |
|---|---|
| harness admin localhost / 127.0.0.1 / ::1 | PASS |
| публичный IPv4 / IPv6 | BLOCK, клиент не запущен |
| production hostname / unknown DNS / production URL | BLOCK |
| URL с query | BLOCK |
| PGHOSTADDR / PGSERVICE / PGSERVICEFILE / конфликтующие PG* | BLOCK |
| отсутствующий URL / только DATABASE_URL / production `.env` | BLOCK |
| DROP при невалидном URL | BLOCK |
| утечка секретов | не обнаружена |
| `npm run test:vps` | PASS 108 |
| полный регресс | после прогона |

## Подтверждения запретов

SSH, deploy, production DB/migrations/.env, платный OpenAI, VK/Telegram, merge `main` / #61 / #62 — не выполнялись.

## Оставшиеся WARNING

| Тема | Статус |
|---|---|
| Нет Docker на агенте | BLOCKED для compose-пути |
| Реальный VPS | не обследовался |
| CI должен задавать `PROBE_HARNESS_ADMIN_URL` | задан в workflows |

## Готовность

**READY WITH WARNINGS.** Путь harness к production PostgreSQL через `DATABASE_URL`/`.env` закрыт. Обследование VPS не начинать без отдельного решения владельца.

Не merge. Не deploy. Не SSH.

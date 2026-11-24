# Итоговый отчёт: изоляция libpq в probe-режиме (PR #62)

Дата: 25 ноября 2026, Europe/Moscow.

**Итоговый статус: READY WITH WARNINGS**

Отдельный PR поверх PR #61. Merge, deploy, SSH, обследование реального VPS не выполнялись.

## Идентификаторы

| Поле | Значение |
|---|---|
| Исходный SHA (PR #61) | `3926043974618362d6b523fed96a77c1c3cd4685` |
| База | `cursor/vps-readiness-hardening-ee77` |
| Рабочая ветка | `cursor/vps-probe-libpq-hardening-ee77` |
| PR | [#62](https://github.com/mahibaradav-wq/VK-agent-ai/pull/62) |
| Конечный SHA | `542343867d2306e679ddc5db38c163ce380a2c37` |
| `main` | не менялся |
| PR #59 / #60 / #61 | не объединялись |

GitHub CI Test: SUCCESS [45492197878](https://github.com/mahibaradav-wq/VK-agent-ai/actions/runs/45492197878).  
GitHub VPS readiness: SUCCESS [45492197911](https://github.com/mahibaradav-wq/VK-agent-ai/actions/runs/45492197911) (syntax, SSH-guard, prisma, lint, typecheck, test, probe, build, image, Playwright e2e, secret-scan).

## Изменённые файлы

- `scripts/lib/vps-common.sh` — `vps_probe_refuse_inherited_libpq`, `vps_probe_exec`, `vps_probe_migrate_deploy`
- `scripts/vps-migrate.sh` — migrate только через изолированный wrapper
- `scripts/tests/vps-ops.test.sh` — тесты обхода libpq + `PROBE_CLIENT_LOG`
- `src/server/hosting/production-stack.test.ts`
- `docs/vps-probe-security.md`, `docs/vps-probe-libpq-inventory.md`
- `docs/vps-readiness-audit.md`, `docs/vps-readiness-final-report.md`

## Реализация изоляции

1. Allowlist цели (host/port/user/db) как в PR #61.
2. Отказ, если в окружении родителя есть **любой** `PG*` (`PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE`, `PGOPTIONS`, конфликтующие `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE`, и прочие).
3. Клиенты запускаются через `env -i` с `PATH`/`HOME`/(locale)/`PGPASSWORD` из `PROBE_PGPASSWORD` и явными `-h/-p/-U/-d`.
4. Prisma: `env -i` + только проверенный `DATABASE_URL=$PROBE_DATABASE_URL`.
5. `PROBE_CLIENT_LOG` отмечает факт запуска клиента; BLOCK-тесты требуют пустой лог.

Compose/production не затронуты.

## Результаты тестов (локально)

| Проверка | Результат |
|---|---|
| localhost / 127.0.0.1 / ::1 + тестовая БД | PASS |
| PGHOSTADDR public IPv4 / IPv6 / documentation IP | BLOCK, клиент не запущен |
| PGHOSTADDR без PROBE host | BLOCK |
| PGSERVICE / PGSERVICEFILE / PGOPTIONS | BLOCK |
| конфликтующие PGHOST/PGPORT/PGUSER/PGDATABASE | BLOCK |
| лишний `PGCHANNELBINDING` | BLOCK |
| DROP SCHEMA при PGHOSTADDR | BLOCK до SQL |
| production URL / PGSERVICE в probe migrate | BLOCK до prisma |
| утечка пароля / URL | не обнаружена |
| `npm run test:vps` | PASS 84 |
| `npm ci` / prisma generate / validate / lint / typecheck / test / build / `bash -n` | PASS |
| GitHub **CI Test** `5423438` | SUCCESS |
| GitHub **VPS readiness** `5423438` | SUCCESS (e2e + secret-scan) |

## Подтверждения запретов

- SSH не использовался.
- Deploy / GitHub Deploy VPS не запускались.
- production DATABASE_URL, `.env` production, миграции production не выполнялись.
- Платный OpenAI, VK/Telegram live не вызывались.
- `main` не менялся; PR #61 не объединялся.

## Оставшиеся ограничения

| Тема | Статус |
|---|---|
| Docker Compose backup на агенте | BLOCKED — нет Docker |
| Реальный VPS | не обследовался |
| Harness CREATE/DROP probe-БД через admin `DATABASE_URL` | вне wrapper; только локальная тестовая БД |
| Worker без HTTP health | WARNING |
| Обследование VPS | запрещено этим заданием |

## Готовность

**READY WITH WARNINGS.** Сценарии обхода через libpq закрыты в коде и автотестах. Переход к обследованию VPS — только после независимой проверки и отдельного подтверждения владельца.

Не merge. Не deploy. Не SSH.

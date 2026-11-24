# Итоговый отчёт: усиление безопасности VPS readiness

Дата: 24 ноября 2026, Europe/Moscow.

**Итоговый статус: READY WITH WARNINGS**

Отдельный PR поверх PR #60. Merge, deploy, SSH, обследование реального VPS не выполнялись.

## Идентификаторы

| Поле | Значение |
|---|---|
| Исходный SHA (PR #60) | `62751d0ebe37b48632f19977aa1b1dff36760463` |
| База PR #60 | `cursor/vps-readiness-ee77` от PR #59 `ed014ba8f049511438a565606abc13e30dd21ac6` |
| Рабочая ветка | `cursor/vps-readiness-hardening-ee77` |
| Конечный SHA | `28df4752a405c31715fc92c89f1f0290369d092f` |
| `main` | не менялся |
| PR #59 / #60 | не объединялись |

GitHub CI и VPS readiness — после push этого SHA.

## Изменённые файлы

- `scripts/lib/vps-common.sh` — строгая probe-allowlist, проверка до любого SQL
- `scripts/backup-vps.sh`, `scripts/restore-vps.sh`, `scripts/vps-migrate.sh` — вызывают allowlist вместо подстрок hostname
- `scripts/vps-pull.sh` — `--plan` только читает состояние
- `scripts/tests/vps-ops.test.sh`, `src/server/hosting/vps-ops.test.ts`, `src/server/hosting/production-stack.test.ts`
- `.github/workflows/deploy-vps.yml` — отключён, без SSH
- `.github/workflows/vps-readiness.yml` — любой `ssh-action` в workflows запрещён
- `docs/vps-probe-security.md` (новый)
- `docs/vps-readiness-audit.md`, `docs/vps-readiness-final-report.md`
- `docs/runbooks/restore-validation.md`, `docs/runbooks/rollback.md`
- `docs/deploy.md`, `docs/security.md`

## Что исправлено

1. Probe больше не ищет подстроки `24dom-po-polochkam` / `timeweb`. Разрешены только loopback-IP или имена `localhost`/`postgres` с резолвом только в loopback, порт `5432`, пользователь `polka`, БД `polka_vps_probe` / `polka_vps_probe_<id>`. `VPS_RUNTIME=probe` недостаточно. `DROP SCHEMA` и `prisma migrate deploy` не идут до проверки. URL с query-параметрами отклоняется. Пароль и `DATABASE_URL` в ошибки не печатаются.
2. GitHub Deploy VPS не содержит SSH-action и не пересобирает сервисы. Любой `workflow_dispatch` завершается отказом. Workflow **не запускался**.
3. `vps-pull.sh --plan` не создаёт каталоги, не пишет `previous-sha`, не делает `git fetch`/checkout, backup, migrate, restart. Если целевой ref нет локально — отказ с пояснением.

## Результаты тестов (локально, 24 ноября 2026, Europe/Moscow)

| Проверка | Результат |
|---|---|
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS 52 files / 253 tests |
| `npm run test:vps` | PASS 68 сценариев |
| `npm run build` | PASS |
| `npx prisma validate` | PASS |
| `bash -n` VPS-скрипты | PASS |
| localhost + тестовая БД | PASS |
| hostname CI `postgres` в allowlist | PASS |
| публичный IPv4 / IPv6 | BLOCK |
| неизвестный DNS / production hostname | BLOCK |
| production-подобное имя БД | BLOCK |
| пустой хост / неверный порт / нет пользователя | BLOCK |
| restore/DROP до проверки | BLOCK |
| migrate с production URL в probe | BLOCK |
| секреты в stdout/stderr отказа | не выводились |
| `--plan` не меняет Git, файлы, каталоги | PASS |
| Deploy VPS не может SSH | PASS |
| GitHub CI / VPS readiness | ожидает push `28df475` |
| secret-scan workflow | в составе VPS readiness |

Тесты не использовали production credentials и не ходили на production PostgreSQL: только `localhost`/`127.0.0.1` и БД `polka_vps_probe_*`.

## Подтверждения запретов

- SSH не использовался.
- GitHub Deploy VPS не запускался.
- production DATABASE_URL, `.env` production, Docker Compose на VPS, Prisma migrate на production не выполнялись.
- Платный OpenAI, публикации VK/Telegram не вызывались.
- `main` не менялся; PR #59 и #60 не объединялись.

## Оставшиеся BLOCKED и WARNING

| Тема | Статус |
|---|---|
| Docker Compose backup/restore на этом агенте | BLOCKED — нет Docker |
| Реальный VPS, IPv6 daemon, overlay compose на сервере | BLOCKED, нужно обследование владельцем |
| Cron и off-site копии | не создавались |
| Worker без HTTP healthcheck | WARNING |
| Production `.env` не читался | намеренно |
| GitHub Deploy VPS отключён до решения владельца | WARNING / ожидаемо |
| Имя `postgres` в allowlist, но живой коннект только если резолв = loopback | fail-closed |

## Готовность

**READY WITH WARNINGS.** Следующий этап (обследование VPS, ручной `--plan`/`--apply`) — только после отдельного подтверждения владельца.

Не merge. Не deploy. Не SSH.

# Итоговый отчёт: готовность к безопасному развёртыванию VPS

Дата: 24 ноября 2026, Europe/Moscow.

**Итоговый статус: READY WITH WARNINGS**

Можно переходить к обследованию реального VPS после подтверждения владельца. Deploy, SSH, production-миграции и изменение `main` не выполнялись и не разрешены этим отчётом.

## Идентификаторы

| Поле | Значение |
|---|---|
| Исходный SHA (PR #59) | `ed014ba8f049511438a565606abc13e30dd21ac6` |
| Рабочая ветка | `cursor/vps-readiness-ee77` |
| PR готовности | [#60](https://github.com/mahibaradav-wq/VK-agent-ai/pull/60) |
| Итоговый SHA (зелёный CI) | `82149232eed5d7b30c1346099f0567ca614f53be` |
| База | PR [#59](https://github.com/mahibaradav-wq/VK-agent-ai/pull/59) `cursor/personal-openai-cabinet-ee77` |
| `main` | `252230b21725318eb3952cec13a059b94b093692`, не менялся |
| PR #59 | открыт, не объединён, HEAD `ed014ba` |

## Изменённые файлы

Новые: `scripts/lib/vps-common.sh`, `scripts/vps-migrate.sh`, `scripts/vps-rollback.sh`, `scripts/tests/vps-ops.test.sh`, `src/server/hosting/vps-ops.test.ts`, `.github/workflows/vps-readiness.yml`, `docs/vps-readiness-audit.md`, `docs/runbooks/restore-validation.md`, `docs/runbooks/migration-plan.md`, `docs/runbooks/rollback.md`, `docs/vps-readiness-final-report.md`.

Существенные правки: `Dockerfile`, `docker-compose.prod.yml`, `scripts/backup-vps.sh`, `scripts/restore-vps.sh`, `scripts/vps-up.sh`, `scripts/vps-pull.sh`, `.github/workflows/ci.yml`, `.github/workflows/deploy-vps.yml`, `src/server/security/secrets.ts`, `src/instrumentation.ts`, `.gitignore`, `.dockerignore`, `docs/deploy.md`, `docs/environment.md`, `docs/security.md`, `docs/runbooks/backups.md`.

## Исправленные проблемы

1. `prisma migrate deploy` больше не выполняется при старте контейнера app.
2. Обновление VPS требует `--plan`, затем `--apply` только после успешного backup.
3. `vps-up.sh` проверяет `TOKEN_ENCRYPTION_KEY`, отличие от `AUTH_SECRET`, URL-safe пароль БД, закрытый mailbox.
4. Backup: место на диске, mode 700/600, interrupt cleanup, сохранение предыдущих копий, возврат app/worker при ошибке.
5. Restore: один timestamp, SHA-256, staging медиа, отказ без подтверждения, сервисы не стартуют после ошибки.
6. Отдельные `vps-migrate.sh` и `vps-rollback.sh` (сценарии A и B).
7. `POLKA_REQUIRE_PROD_SECRETS` на app/worker; GitHub Deploy VPS требует фразу подтверждения и не стартует с `main` по умолчанию.
8. Workflow `vps-readiness.yml` без SSH; runner `ubuntu-24.04` (Playwright 1.56 не ставит Chromium на ubuntu 26.04).
9. Probe-дампы — plain SQL без `SET transaction_timeout`, чтобы клиент PostgreSQL 17 восстанавливал в сервер 16.
10. Vitest-обёртка `vps-ops` получила timeout 120 с (иначе GitHub обрывал suite на дефолтных 5 с).

## Результаты проверок

| Проверка | Результат |
|---|---|
| `npm run lint` | PASS (локально и GitHub) |
| `npm run typecheck` | PASS (локально и GitHub) |
| `npx vitest run` / `npm test` | PASS 52 files / 253 tests |
| `npm run test:vps` | PASS 41 probe-сценариев |
| `npm run test:e2e` | PASS 8 локально; Playwright e2e PASS в workflow VPS readiness |
| `npm run build` | PASS |
| `npx prisma validate` | PASS |
| `npx prisma migrate deploy` (тестовая БД CI) | PASS |
| `npx prisma migrate status` (локальная тестовая БД) | PASS 17 migrations, up to date |
| `bash -n` все VPS-скрипты | PASS |
| тесты backup / restore / отказов / rollback --plan | PASS |
| GitHub **CI Test** `8214923` | SUCCESS [45481119416](https://github.com/mahibaradav-wq/VK-agent-ai/actions/runs/45481119416) |
| GitHub **VPS readiness** `8214923` | SUCCESS [45481119359](https://github.com/mahibaradav-wq/VK-agent-ai/actions/runs/45481119359) (syntax, SSH-guard, prisma, lint, typecheck, test, probe, build, image, e2e, secret-scan) |
| единый OpenAI / AI-лимит / коммерция 410 | не ломались (vitest) |
| Docker Compose backup на этом агенте | **BLOCKED** — Docker недоступен |
| SSH / production deploy / production migrate | не выполнялись |
| платный OpenAI / VK / Telegram live | не вызывались |
| секреты в Git и отчётах | не выводились; `.env` не коммитился |

## Оставшиеся риски и BLOCKED

| Тема | Статус |
|---|---|
| Нет Docker на агенте — compose-путь backup/restore не гонялся | BLOCKED (probe-путь покрыт) |
| Реальный VPS, IPv6 daemon, `docker-compose.timeweb.yml` на сервере | BLOCKED, нужно обследование |
| Расписание backup и копия вне VPS | не создавались |
| Worker без HTTP healthcheck | предупреждение |
| `deploy-vps.yml` всё ещё умеет SSH после фразы подтверждения | предупреждение; workflow не запускался |
| Несогласованность БД/медиа, если dump прошёл, а tar на swap упал | сервисы остаются down; повтор backup |
| Production `.env` не читался | намеренно |

## Готовность к следующему этапу

**READY WITH WARNINGS.** Следующий этап — обследование VPS владельцем (Docker, тома, `.env.production` ключи без вывода значений, место, cron). Только после отдельного подтверждения: `vps-pull.sh --plan`, backup, `--apply`.

Не deploy. Не SSH. Не merge в `main`. Коммит этого отчёта может идти после зелёного SHA `8214923` и не меняет скрипты.

# PR #64 — Комплексный аудит готовности к VPS

База: PR #63 (`e2f4a20`). Ветка: `cursor/vps-full-readiness-audit-ee77`.

Это **не** заявление о production-ready VPS. Docker Engine и живой VPS в этом прогоне не использовались.

## Исправленные дефекты

| ID | Что сделано |
|---|---|
| A1 | Worker вызывает `assertProductionCabinetGuards` при `POLKA_REQUIRE_PROD_SECRETS` / production |
| A2 | Server Action origins: fallback только `localhost:3000`, без hardcoded production domain |
| A4 | `package.json` — личный кабинет, не SaaS |
| B1 | Dockerfile `USER polka` (uid 10001); worker compose `user: 10001:10001` |
| B2 | `vps-pull` health wait default 40×3s ≥ compose `start_period` 90s |
| B3 | `vps-up` отказывается, если `_prisma_migrations` уже есть |
| B6 | Caddy redirect `www` → apex; docs про DNS |
| B8 | `stop_grace_period: 30s` на app/worker |
| D2 | BullMQ `jobId: publish:${jobId}` + ignore duplicate |
| E1 | `bodySizeLimit: 32mb` |
| E2 | Path containment в local storage |
| E3 | `/api/media/[id]` всегда 404 при отсутствии прав |
| F1 | Auth/invite mail через email adapter |
| F2 | `User.sessionVersion` + invalidate JWT после reset (Node path) |
| F3 | Secure cookies в production |
| G1 | Post generate резервирует 2 AI unit (revise) |
| H1 | Нет blind-resend Telegram при `error_code===0` |
| H2 | `SOCIAL_PUBLISH_LIVE` fail-closed при `POLKA_REQUIRE_PROD_SECRETS` |

## Остаточные риски (без Docker Engine / VPS)

- Реальная сборка/запуск образа и права volume `media_data` не подтверждены на Engine.
- Worker healthcheck отсутствует; мониторинг диска/cron backup — на операторе.
- Agent AI usage может недоучитывать revise на live OpenAI (standalone post — исправлено).
- CSP `unsafe-inline`/`unsafe-eval`, in-memory rate limit — приняты для 1× Node.

## CI follow-up

После первого CI run (#45693091052) 8 тестов падали: без `AUTH_DEV_MAILBOX` адаптер почты был unconfigured и не писал `DevMailMessage`. Исправлено: `vitest.config.ts` + `.github/workflows/ci.yml` задают `AUTH_DEV_MAILBOX=true`; auth/collaboration предпочитают DevMailbox adapter при включённом стенде.

## Запреты соблюдены

Merge, deploy, SSH, production DB, платные AI, реальные VK/Telegram публикации — не выполнялись.

# Аудит готовности VPS

Дата: 24 ноября 2026, Europe/Moscow.  
Исходный HEAD PR #59: `ed014ba8f049511438a565606abc13e30dd21ac6`.  
Ветка работы: `cursor/vps-readiness-ee77` @ `21649303f4c7ca2010a2014e8e3ec80efb76f1fb`.  
SSH, production deploy, production-миграции и чтение секретов не выполнялись.

## Согласованность стека

| Тема | Факт | Оценка |
|---|---|---|
| Compose services | `postgres`, `app`, `worker`, `caddy` | согласовано |
| Volumes | `postgres_data`, `media_data`, `caddy_data`, `caddy_config` | согласовано |
| Медиа | `LOCAL_STORAGE_DIR=/app/data/media` ↔ volume `media_data` | согласовано |
| PostgreSQL | внутренний DNS `postgres:5432`, порты хоста не публикуются | согласовано |
| Caddy | 80/443/udp 443, `X-Real-IP`, HSTS | согласовано |
| `docker-compose.timeweb.yml` | нет в git; опциональный overlay только на VPS | предупреждение |
| Авто-migrate в CMD | **было**: `prisma migrate deploy && npm start` | исправлено |
| `TOKEN_ENCRYPTION_KEY` в `vps-up.sh` | **не проверялся** | исправлено |
| `vps-pull.sh` | pull+up без backup и без отдельной миграции | исправлено (`--plan` / `--apply`) |

## Файлы

| Файл | Проблема | Риск | Решение | Результат |
|---|---|---|---|---|
| `Dockerfile` | `CMD` запускал `prisma migrate deploy` при каждом старте app | высокий | CMD только `npm start`; migrate — `scripts/vps-migrate.sh` | исправлено |
| `docker-compose.prod.yml` | нет флага обязательных prod-секретов; worker без HTTP health | средний | `POLKA_REQUIRE_PROD_SECRETS=true`; health worker оставлен как предупреждение | частично |
| `deploy/Caddyfile` | только HSTS, остальное в приложении | низкий | без смены; заголовки приложения проверены тестами | ок |
| `.env.production.example` | ЮKassa не включается; `TOKEN_ENCRYPTION_KEY` описан | низкий | добавлены проверки в `vps-up` | ок |
| `.dockerignore` | дампы могли попасть в build context | средний | `*.dump`, `polka-*.sha256`, `.vps-state` | исправлено |
| `.gitignore` | дампы и `.vps-state` не игнорировались | средний | добавлены шаблоны | исправлено |
| `docs/deploy.md` | `vps-pull` без backup; SSH-ключ агента; migrate при старте | высокий | обновлён под `--plan`/`--apply` и отдельный migrate | исправлено в доке |
| `docs/environment.md` | `TOKEN_ENCRYPTION_KEY` как опциональный | средний | для production описан как обязательный | исправлено в доке |
| `docs/security.md` | не было процедуры обновления VPS | средний | ссылки на runbooks | исправлено в доке |
| `docs/runbooks/backups.md` | не покрывал probe-проверки и interrupt | средний | обновлён | исправлено |
| `scripts/vps-up.sh` | не проверял `TOKEN_ENCRYPTION_KEY`, charset пароля, AUTH_URL | высокий | `vps_validate_production_env_file` | исправлено |
| `scripts/vps-pull.sh` | сразу `git pull` + `up --build`, health по публичному URL | высокий | `--plan` по умолчанию; `--apply` только после backup | исправлено |
| `scripts/backup-vps.sh` | не было проверки места, mode 600, probe-режима | средний | добавлено | исправлено |
| `scripts/restore-vps.sh` | media wipe до успешного tar; нет сверки timestamp | высокий | staging + timestamp set; app не стартует при ошибке | исправлено |
| `.github/workflows/ci.yml` | не проверял новые скрипты | низкий | расширен `bash -n` | исправлено |
| `.github/workflows/deploy-vps.yml` | SSH на VPS без фразы подтверждения, default `main` | высокий | confirm phrase; default ref снят | исправлено, **не запускался** |
| Prisma migrations | 17 файлов, billing-таблицы на месте | — | DROP не добавлялся | ок |
| `/api/health` | `{ok, db}`, без connection string | — | без изменений | ок |
| worker | poll PostgreSQL / optional Redis, нет HTTP health | средний | документирован | предупреждение |

## DATABASE_URL

Compose подставляет пароль в URL без percent-encoding. Пароль с `@`, `:`, `/` сломает строку. Скрипты требуют URL-safe charset (`A-Z a-z 0-9 . _ ~ -`), как у `openssl rand -hex`.

## Ключи шифрования при обновлении

`AUTH_SECRET` и `TOKEN_ENCRYPTION_KEY` живут в `.env.production`, не в Git и не в backup-архиве. Обновление образа их не перезаписывает. Смена ключа без расшифровки старых токенов сломает VK/Telegram. Rollback A/B не трогает env.

## Секреты в образе

`.dockerignore` исключает `.env*` кроме example. В логах backup печатаются только имена файлов.

## Что нельзя проверить без VPS (BLOCKED)

- фактический Docker daemon / IPv6 на Timeweb;
- наличие `docker-compose.timeweb.yml` на сервере;
- свободное место и cron backup на VPS;
- живой HTTPS/сертификат Let's Encrypt;
- содержимое production `.env` (не читалось).

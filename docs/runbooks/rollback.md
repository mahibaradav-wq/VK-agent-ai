# Откат VPS

Реальный откат production не выполнялся. Скрипт: `scripts/vps-rollback.sh`. По умолчанию `--plan` (ничего не меняет).

Ключи `AUTH_SECRET` / `TOKEN_ENCRYPTION_KEY` в `.env.production` **не** откатываются из Git: их нет в репозитории и нет в backup-архиве. Менять ключи при откате нельзя, иначе перестанут читаться токены соцаккаунтов.

Предыдущий SHA пишется в `.vps-state/previous-sha` только на шаге `--apply` у `vps-pull.sh`. `--plan` этот файл не создаёт и Git не меняет. Предыдущий образ тегируется как `polka-social:prod-prev` также только при `--apply`.

```bash
bash scripts/vps-rollback.sh --plan A
bash scripts/vps-rollback.sh --plan B
```

## A. Ошибка приложения без изменения схемы

Признаки: health 5xx / бесконечный restart, `_prisma_migrations` совпадает с ожидаемым SHA, migrate не запускали.

1. `docker compose -f docker-compose.prod.yml --env-file .env.production stop app worker`
2. `git checkout` SHA из `.vps-state/previous-sha`
3. `docker tag polka-social:prod-prev polka-social:prod` если образ есть
4. `docker compose … up -d app worker caddy`
5. `docker compose exec app node -e "fetch('http://127.0.0.1:3000/api/health')…"`

Не делать `prisma migrate deploy` и не restore БД.

`--apply A` выполняет эти шаги на машине, где запущен скрипт. Не вызывать с CI.

## B. Ошибка после миграции

Признаки: `vps-migrate.sh` уже отработал или схема новее кода.

`git checkout` **недостаточен**: Prisma и PostgreSQL разъедутся.

1. Остановить app/worker (restore делает это сам).
2. Восстановить dump+media из копии, снятой непосредственно перед migrate:

```bash
CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
  DB_BACKUP=/opt/polka-social-backups/polka-db-….dump \
  MEDIA_BACKUP=/opt/polka-social-backups/polka-media-….tar.gz \
  BACKUP_MANIFEST=/opt/polka-social-backups/polka-….sha256 \
  bash scripts/restore-vps.sh
```

3. `git checkout` предыдущего SHA.
4. Вернуть `polka-social:prod-prev`, если тег есть.
5. Health, вход, медиа, очередь.

`--apply B` требует те же переменные backup, что и restore.

## Медиа и БД

Backup всегда пара dump+tar с одним timestamp. Откатывать только БД или только медиа нельзя: публикациям нужны файлы с теми же id.

## Если нет `prod-prev`

Собрать образ с предыдущего SHA: `docker compose build app` после `git checkout`. Это уже не мгновенный откат; backup БД всё равно нужен для сценария B.

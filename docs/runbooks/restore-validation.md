# Проверка восстановления

Разрушительное восстановление production **этим заданием не выполнялось**. Ниже — как проверять restore на изолированной среде и какие отказы покрыты.

## Изолированная проверка (обязательная перед VPS)

Нужны локальный PostgreSQL и каталог медиа, **не** production volumes и **не** production `DATABASE_URL`.

```bash
# отдельная БД и каталог, имена не из production
export VPS_RUNTIME=probe
export PROBE_PGHOST=127.0.0.1
export PROBE_PGPORT=5432
export PROBE_PGUSER=polka
# пароль только в окружении процесса, не в git
export PROBE_PGDATABASE=polka_vps_probe
export PROBE_MEDIA_DIR=/tmp/polka-probe-media
export PROBE_STATE_DIR=/tmp/polka-probe-state
export BACKUP_DIR=/tmp/polka-probe-backups
export FIRST_INSTALL=YES
export PROBE_DATABASE_URL="postgresql://polka:…@127.0.0.1:5432/polka_vps_probe"

createdb "$PROBE_PGDATABASE"
mkdir -p "$PROBE_MEDIA_DIR" "$PROBE_STATE_DIR"
bash scripts/vps-migrate.sh
bash scripts/backup-vps.sh
CONFIRM_RESTORE=YES RESTORE_CONFIRM=RESTORE \
  DB_BACKUP=/tmp/polka-probe-backups/polka-db-….dump \
  MEDIA_BACKUP=/tmp/polka-probe-backups/polka-media-….tar.gz \
  BACKUP_MANIFEST=/tmp/polka-probe-backups/polka-….sha256 \
  bash scripts/restore-vps.sh
```

Автоматический набор: `npm run test:vps` / `bash scripts/tests/vps-ops.test.sh`. Он создаёт `polka_vps_probe_<pid>`, мигрирует схему, снимает копию, меняет данные, восстанавливает и удаляет probe-БД.

Скрипт отказывается работать, если host/path содержит `24dom-po-polochkam` или `timeweb`.

## Production restore (только по решению владельца)

```bash
CONFIRM_RESTORE=YES \
DB_BACKUP=/opt/polka-social-backups/polka-db-YYYYMMDDTHHMMSSZ.dump \
MEDIA_BACKUP=/opt/polka-social-backups/polka-media-YYYYMMDDTHHMMSSZ.tar.gz \
BACKUP_MANIFEST=/opt/polka-social-backups/polka-YYYYMMDDTHHMMSSZ.sha256 \
bash scripts/restore-vps.sh
```

На TTY нужно ввести `RESTORE`. Без TTY — `RESTORE_CONFIRM=RESTORE` плюс `CONFIRM_RESTORE=YES`.

Порядок:

1. Проверка файлов, одного timestamp, SHA-256, `pg_restore --list`, `tar -tzf`.
2. Остановка app и worker.
3. Сброс `public` schema и restore dump.
4. Распаковка медиа во staging внутри volume, затем замена. Если tar падает, живые файлы ещё на месте.
5. Старт app/worker только если шаги 3–4 успешны.
6. Проверка `SELECT 1 FROM "_prisma_migrations"`.

## Покрытые отказы (`scripts/tests/vps-ops.test.sh`)

| Сценарий | Ожидание |
|---|---|
| Успешное восстановление | медиа и схема вернулись, сервисы помечены running |
| Manifest из другого каталога | отказ |
| Неверный SHA-256 | отказ |
| Повреждённый dump | отказ до замены данных |
| Повреждённый tar | отказ |
| Разные timestamps в именах | отказ |
| Отмена (`RESTORE_CONFIRM` ≠ `RESTORE`) | отказ |
| Ошибка PostgreSQL | app/worker не стартуют |
| Ошибка распаковки | app/worker не стартуют |

## Ограничения

- Compose-режим на этом агенте **BLOCKED**: Docker недоступен. Проверялся probe-режим с локальным PostgreSQL.
- Если dump уже применён, а распаковка медиа затем падает, база новая, файлы старые; сервисы остаются остановленными. Повтор того же backup или rollback B.
- Restore не трогает `.env.production` и сертификаты Caddy.

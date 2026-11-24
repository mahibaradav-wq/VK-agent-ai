# Модель безопасности probe-режима

Probe (`VPS_RUNTIME=probe`) нужен только для изолированных тестов backup, restore и migrate. Это **не** режим работы VPS и **не** доказательство безопасности само по себе.

Скрипты не подключаются к PostgreSQL, пока не пройдена allowlist-проверка **и** не очищено окружение libpq. При любой ошибке выполнение прекращается до запуска `psql` / `pg_dump` / `pg_isready` / `pg_restore` / `prisma migrate deploy`. `DROP SCHEMA public CASCADE` в restore вызывается только после этих проверок.

Инвентаризация вызовов: [vps-probe-libpq-inventory.md](vps-probe-libpq-inventory.md).

## Allowlist цели

Одновременно должны выполняться все условия:

| Поле | Allowlist |
|---|---|
| Host | loopback-IP (`127.0.0.0/8`, `::1`) **или** имя `localhost` / `postgres`, и это имя резолвится **только** в loopback |
| Port | `5432` |
| User | `polka` |
| Database | `polka_vps_probe` или `polka_vps_probe_<id>` (`[A-Za-z0-9]+` после `_`) |

`PROBE_DATABASE_URL` разбирается без печати пароля. Query-параметры запрещены.

## Изоляция окружения libpq

Проверенный `localhost` недостаточен: унаследованные переменные libpq могут подменить адрес. Перед каждым клиентом:

1. `vps_probe_assert_isolated_target` или `vps_probe_assert_isolated_url`.
2. `vps_probe_refuse_inherited_libpq` — любой непустой `PG*` в окружении родителя → отказ **без** запуска клиента (`PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE`, `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGOPTIONS`, и любые другие `PG*`).
3. Запуск через `vps_probe_exec` / `vps_probe_migrate_deploy`: `env -i` с только `PATH`, `HOME`, опционально `LANG`/`LC_*`/`TMPDIR`/`TERM`, и `PGPASSWORD` из `PROBE_PGPASSWORD` (для клиентов) либо `DATABASE_URL` из проверенного `PROBE_DATABASE_URL` (для Prisma). Параметры `-h/-p/-U/-d` передаются явно.

Production Compose-путь не использует этот wrapper: клиенты идут через `docker compose exec` внутри контейнера postgres.

## Что запрещено

- публичные IPv4 и IPv6;
- неизвестные DNS-имена и production-hostname;
- production-подобные имена БД;
- пустой хост, неверный порт, отсутствующий пользователь или имя БД;
- любой унаследованный `PG*`, в том числе `PGHOSTADDR` / service-файлы;
- защита «по подстроке» hostname — её нет.

Пароль, полный `DATABASE_URL` и другие секреты в сообщения об ошибках не выводятся. Тесты `PROBE_CLIENT_LOG` подтверждают, что при BLOCK клиент не стартовал.

## Как проверять

```bash
npm run test:vps
```

Тесты создают отдельную БД `polka_vps_probe_<pid>` на localhost. Production credentials, SSH и Docker Compose против VPS не используются.

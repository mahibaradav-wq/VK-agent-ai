# Модель безопасности probe-режима

Probe (`VPS_RUNTIME=probe`) нужен только для изолированных тестов backup, restore и migrate. Это **не** режим работы VPS и **не** доказательство безопасности само по себе.

Скрипты не подключаются к PostgreSQL, пока не пройдена allowlist-проверка **и** не очищено окружение libpq. При любой ошибке выполнение прекращается до запуска `psql` / `pg_dump` / `pg_isready` / `pg_restore` / `prisma migrate deploy`. `DROP SCHEMA public CASCADE` в restore вызывается только после этих проверок.

Инвентаризация вызовов: [vps-probe-libpq-inventory.md](vps-probe-libpq-inventory.md).

## Allowlist цели probe

| Поле | Allowlist |
|---|---|
| Host | loopback-IP (`127.0.0.0/8`, `::1`) **или** имя `localhost` / `postgres`, резолв только в loopback |
| Port | `5432` |
| User | `polka` |
| Database | `polka_vps_probe` или `polka_vps_probe_<id>` |

`PROBE_DATABASE_URL` без query-параметров. Пароль не печатается.

## Изоляция окружения libpq (probe-клиенты)

1. `vps_probe_assert_isolated_target` / `vps_probe_assert_isolated_url`.
2. `vps_probe_refuse_inherited_libpq` — любой `PG*` у родителя → отказ без запуска клиента.
3. `vps_probe_exec` / `vps_probe_migrate_deploy`: `env -i` + явные `-h/-p/-U/-d` или только проверенный `DATABASE_URL`.

## Административный harness (CREATE/DROP probe-БД)

Тестовый suite создаёт и удаляет `polka_vps_probe_*` через:

- **только** `PROBE_HARNESS_ADMIN_URL` (не `DATABASE_URL`, не `.env`);
- `vps_harness_assert_admin_url` / `vps_harness_admin_exec` / `vps_harness_prepare_probe_database` / `vps_harness_drop_probe_database`.

Allowlist admin URL:

| Поле | Allowlist |
|---|---|
| Host | loopback / `localhost` / `postgres` (резолв только в loopback) |
| Port | `5432` |
| User | `polka` |
| Database | только maintenance: `postgres` или `polka_social` |

Перед CREATE/DROP: проверка URL, отказ при любом унаследованном `PG*`, затем `env -i` с явными параметрами. `PROBE_CLIENT_LOG` фиксирует запуск клиента; при BLOCK лог пуст — CREATE/DROP не выполняются.

CI задаёт `PROBE_HARNESS_ADMIN_URL` на localhost. Отсутствие переменной → BLOCK до любого SQL.

## Запрещено

- публичные IP, неизвестные DNS, production hostname;
- query-параметры в URL;
- fallback на `DATABASE_URL` / чтение `.env` для admin-операций harness;
- любой унаследованный `PG*`.

## Как проверять

```bash
export PROBE_HARNESS_ADMIN_URL='postgresql://polka:…@127.0.0.1:5432/polka_social'
npm run test:vps
```

# Inventory: probe-mode PostgreSQL clients (PR #62)

Base: PR #61 `3926043974618362d6b523fed96a77c1c3cd4685`.

## Calls that talk to PostgreSQL in probe mode

| Location | Client | Connection source before fix | Inherited libpq risk |
|---|---|---|---|
| `vps_postgres_running` | `pg_isready` | `-h/-p/-U/-d` from `PROBE_*` | `PGHOSTADDR`, `PGSERVICE*`, `PG*` override |
| `vps_dump_database` | `pg_dump` | same + `PGPASSWORD` | same |
| `vps_reset_public_schema` | `psql` | same | same; runs `DROP SCHEMA` |
| `vps_restore_database` | `psql -f` | same | same |
| `vps_verify_database` | `psql -c` | same | same |
| `scripts/vps-migrate.sh` | `npx prisma migrate deploy` | `DATABASE_URL=$PROBE_DATABASE_URL` | Prisma/libpq may still read `PG*` / service files from the parent env |
| `scripts/tests/vps-ops.test.sh` | `psql` for CREATE/DROP probe DB and assertions | `DATABASE_URL` admin URL or `PROBE_*` | harness only; not production path |

Compose / production paths use `docker compose exec` inside the postgres container and are out of scope.

## Fix

All probe clients go through `vps_probe_exec` / `vps_probe_migrate`: allowlist check, then `env -i` with only `PATH`, `HOME`, `LANG`/`LC_*`, and `PGPASSWORD` (when set), plus explicit `-h/-p/-U/-d` or a parsed `DATABASE_URL` for Prisma. Any non-empty inherited `PGHOSTADDR`, `PGSERVICE`, `PGSERVICEFILE`, or conflicting `PGHOST`/`PGPORT`/`PGUSER`/`PGDATABASE`/`PGOPTIONS` causes refusal **before** the client binary runs.

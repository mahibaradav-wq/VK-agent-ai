# Inventory: probe and harness PostgreSQL clients

Base for PR #63: PR #62 `889091d2b6b6e5f7e8dfacc3321ed845e74fb92a`.

## Probe-mode application scripts

| Location | Client | Connection | Isolation |
|---|---|---|---|
| `vps_postgres_running` | `pg_isready` | `PROBE_*` | `vps_probe_exec` → allowlist + refuse `PG*` + `env -i` |
| `vps_dump_database` | `pg_dump` | `PROBE_*` | same |
| `vps_reset_public_schema` | `psql` | `PROBE_*` | same; `DROP SCHEMA` only after checks |
| `vps_restore_database` | `psql -f` | `PROBE_*` | same |
| `vps_verify_database` | `psql -c` | `PROBE_*` | same |
| `scripts/vps-migrate.sh` | `prisma migrate deploy` | `PROBE_DATABASE_URL` | `vps_probe_migrate_deploy` |

Compose/production paths use `docker compose exec` and are out of scope.

## Test harness admin CREATE/DROP

| Location | Before PR #63 | After PR #63 |
|---|---|---|
| `scripts/tests/vps-ops.test.sh` setup | `subprocess.run(["psql", admin])` via `DATABASE_URL` or `.env` | `vps_harness_prepare_probe_database` + `PROBE_HARNESS_ADMIN_URL` only |
| cleanup DROP | same unsafe path | `vps_harness_drop_probe_database` |
| assertion queries | `vps_probe_exec` | unchanged (probe path) |

## Other test CREATE/DROP

| Location | Mitigation |
|---|---|
| `src/server/db/migrations.test.ts` | Loopback/user/port/maintenance-db allowlist; refuse inherited `PG*`; minimal env for `psql` (no `...process.env`) |

## Required CI env

`PROBE_HARNESS_ADMIN_URL=postgresql://polka:…@localhost:5432/polka_social` in CI and VPS readiness workflows. Never derived from production `.env`.

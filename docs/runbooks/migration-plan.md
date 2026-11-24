# План Prisma-миграций

Production-миграции этим заданием не запускались. `Plan`, `Subscription`, `CheckoutSession`, `PaymentEvent` не удаляются.

## Текущая схема

Провайдер: PostgreSQL. Lockfile: `prisma/migrations/migration_lock.toml`.  
Локально на тестовой БД: `npx prisma migrate status` — 17 миграций, schema up to date.  
`prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma` (отдельная shadow-БД) — различий нет.

## Порядок (уже применённые, только вперёд)

1. `20261012193101_init_auth`
2. `20261012194200_add_project`
3. `20261014181100_add_posts_and_media`
4. `20261014193200_add_schedule`
5. `20261014203000_add_publish_jobs`
6. `20261015180000_add_social_accounts`
7. `20261015194000_add_ai_assistant`
8. `20261015200000_add_analytics_snapshots`
9. `20261016190000_add_collaboration`
10. `20261016200000_add_billing` — создаёт `Plan`, `Subscription`, `CheckoutSession`, `PaymentEvent`, `UsageRecord`
11. `20261021193000_add_platform_admin`
12. `20261022200000_add_workspace_ai_connection`
13. `20261114190000_add_vk_watch`
14. `20261115100000_multiple_ai_connections`
15. `20261116010000_shop_products`
16. `20261118190000_post_platform_variants`
17. `20261123220000_post_requires_manual_check`

Разрушительных `DROP TABLE` для billing-таблиц нет. Коммерческие сценарии отключены в коде; таблицы остаются.

## Совместимость с данными

Новые миграции в этом PR не добавлялись. `migrate deploy` на пустой probe-БД проходит и оставляет `Plan`. Существующие кабинеты: `UsageRecord` и `WorkspaceAiConnection` нужны живому AI-учёту; billing-строки могут быть пустыми после отключения регистрации от Plan.

Потенциально опасно в будущем: любое `DROP` / `ALTER … NOT NULL` без default / смена enum. Такие изменения требуют отдельного решения владельца, backup и сценария B.

## Безопасная процедура на VPS (не выполнять в этом задании)

1. `bash scripts/vps-pull.sh --plan <ref>`
2. `bash scripts/backup-vps.sh` и проверить `pg_restore --list` + `tar -tzf` + sha256
3. Только после успешной копии: `BACKUP_VERIFIED=YES bash scripts/vps-migrate.sh`
4. Старт app/worker, `/api/health`
5. При ошибке — `docs/runbooks/rollback.md` сценарий B, не `git checkout` в одиночку

Первый запуск пустой БД: `FIRST_INSTALL=YES bash scripts/vps-migrate.sh` из `vps-up.sh`. Не использовать `vps-up.sh` как обновление существующего сервера.

Запрещено: `prisma migrate reset`, `prisma migrate dev` на production, `prisma db push`.

## Восстановление после неудачной миграции

Если `migrate deploy` остановился:

1. Не стартовать app, пока `_prisma_migrations` и схема не согласованы.
2. Взять backup, снятый **до** migrate.
3. Сценарий B: restore dump+media, затем предыдущий Git SHA / `polka-social:prod-prev`.
4. Не запускать повторный migrate, пока restore не проверен на probe.

App-контейнер больше не вызывает migrate при старте, поэтому простой restart не «дожимает» половину миграции автоматически.

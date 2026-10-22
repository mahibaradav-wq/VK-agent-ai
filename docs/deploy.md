# Запуск и выкладка

Процедура ниже проверена на этапе 14: миграции с чистой БД, `npm run build`, `npm start`, `/api/health`.

## Локально (разработка)

```bash
cp .env.example .env
# задайте AUTH_SECRET (32+ случайных символа) и DATABASE_URL
docker compose up -d
npx prisma migrate deploy
npm install
npm run dev
```

Откройте `http://localhost:3000`. На Windows достаточно `start.bat` (PostgreSQL через Docker, миграции, `npm run dev`). Письма — `/dev/mailbox`. Очередь worker:

```bash
npm run worker
```

Без Docker подойдёт локальный PostgreSQL 16 с тем же `DATABASE_URL`.

## Production build на этой же машине

```bash
cp .env.example .env
# AUTH_SECRET, DATABASE_URL, NEXT_PUBLIC_SITE_URL
# AUTH_DEV_MAILBOX не задавать на настоящем проде
npx prisma migrate deploy
npm run lint
npm run typecheck
npm test
npm run build
npm start -- --hostname 0.0.0.0 --port 3000
```

Проверка:

```bash
curl -fsS http://127.0.0.1:3000/api/health
# {"ok":true,"db":"up"}
```

Отдельно, если сервер уже слушает 3000:

```bash
npm run test:e2e
```

## Выкладка на свой хост

1. Поднимите PostgreSQL 16. Redis и S3 — только если включены в `.env`.
2. Задайте секреты в окружении процесса, не в git.
3. Выполните `npx prisma migrate deploy` **до** старта новой версии приложения.
4. Соберите `npm run build` и запускайте `npm start` (или процесс-менеджер) плюс `npm run worker`, если нужна фоновая очередь.
5. Поставьте HTTPS на прокси. Там же включите HSTS.
6. Проверьте `/api/health`, вход, `/dev/mailbox` (должен быть выключен) и что `/admin` закрыт для обычного Owner.
7. Первый Superadmin: `ADMIN_EMAILS` с email уже зарегистрированного пользователя, затем заход в `/admin`.

Готового облачного деплоя в репозитории нет: нет фиктивного «успешно задеплоено на Vercel» без ваших credentials.

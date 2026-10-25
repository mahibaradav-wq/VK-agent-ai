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

## Выкладка на свой хост и домен

Быстрый туннель Cloudflare (`*.trycloudflare.com`) для продакшена не подходит: адрес меняется и сам истекает. Нужны свой домен и VPS.

Я не могу купить домен или оплатить хостинг с этой машины: нужны ваш аккаунт регистратора и SSH к серверу.

### Что купить

1. **Домен**, например `polkasocial.ru` или `dom-po-polochkam.ru`, у REG.RU, Timeweb или nic.ru.
2. **VPS** Ubuntu 22.04/24.04, от 2 ГБ RAM, открытые порты 22/80/443. Подойдут Timeweb Cloud, Selectel, REG.RU VPS, FirstVDS.

Vercel/Railway для этого проекта хуже: нужны PostgreSQL, воркер очереди, файлы медиатеки и постоянный `AUTH_URL`. Один VPS с Docker закрывает всё.

### DNS

В панели домена создайте A-запись на IP сервера:

| Тип | Имя | Значение |
|---|---|---|
| A | `@` | публичный IPv4 вашего VPS |
| A | `www` | тот же IPv4 |

Подождите, пока `ping ваш-домен.ru` начнёт отвечать с IP сервера. До этого Caddy не получит сертификат.

### На сервере

```bash
sudo apt-get update
sudo apt-get install -y git docker.io docker-compose-v2
sudo usermod -aG docker "$USER"
# перелогиньтесь, чтобы группа docker применилась
git clone https://github.com/mahibaradav-wq/VK-agent-ai.git
cd VK-agent-ai
git pull
cp .env.production.example .env.production
```

В `.env.production` замените заглушки:

```bash
SITE_DOMAIN=ваш-домен.ru
ACME_EMAIL=ваш@email.ru
NEXT_PUBLIC_SITE_URL=https://ваш-домен.ru
AUTH_URL=https://ваш-домен.ru
AUTH_SECRET=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 16)
```

`AUTH_DEV_MAILBOX` не задавайте. Затем:

```bash
bash scripts/vps-up.sh
curl -fsS https://ваш-домен.ru/api/health
# {"ok":true,"db":"up"}
```

Стек: Caddy (HTTPS) → Next.js → PostgreSQL, плюс воркер очереди. Медиа лежат в Docker-томе `media_data`.

Обновление после `git pull`:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Остановка: `npm run hosting:down` или тот же `docker compose ... down`.

Проверьте вход, что `/dev/mailbox` закрыт, и что `/admin` недоступен обычному Owner. Первый Superadmin: `ADMIN_EMAILS` с email уже зарегистрированного пользователя.

Секреты только в `.env.production` на сервере, не в git. Без ваших SSH-ключей и оплаченного VPS выкладка с этой машины невозможна.

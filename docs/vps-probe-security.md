# Модель безопасности probe-режима

Probe (`VPS_RUNTIME=probe`) нужен только для изолированных тестов backup, restore и migrate. Это **не** режим работы VPS и **не** доказательство безопасности само по себе.

Скрипты не подключаются к PostgreSQL, пока не пройдена allowlist-проверка. При любой ошибке выполнение прекращается. `DROP SCHEMA public CASCADE` в restore вызывается только после этой проверки.

## Что разрешено

Одновременно должны выполняться все условия:

| Поле | Allowlist |
|---|---|
| Host | loopback-IP (`127.0.0.0/8`, `::1`) **или** имя `localhost` / `postgres`, и это имя резолвится **только** в loopback |
| Port | `5432` |
| User | `polka` |
| Database | `polka_vps_probe` или `polka_vps_probe_<id>` (`[A-Za-z0-9]+` после `_`) |

Имя `postgres` — это служебное имя контейнера CI. Если оно не резолвится в loopback, живое подключение отклоняется (fail-closed). На VPS сервис Compose тоже называется `postgres`, но production-база `polka_social` в probe запрещена.

`PROBE_DATABASE_URL` разбирается без печати пароля. Query-параметры (`?host=`, `sslmode` и любые другие) запрещены: иначе libpq мог бы подменить хост.

## Что запрещено

- публичные IPv4 и IPv6;
- неизвестные DNS-имена, в том числе production-hostname;
- production-подобные имена БД (`polka_social`, `postgres`, `production` и любые, не совпадающие с шаблоном);
- пустой хост, неверный порт, отсутствующий пользователь или имя БД;
- защита «по подстроке» вроде `24dom-po-polochkam` / `timeweb` — её нет; неизвестный адрес отклоняется, потому что его нет в allowlist.

Пароль, полный `DATABASE_URL` и другие секреты в сообщения об ошибках не выводятся.

## Как проверять

```bash
npm run test:vps
```

Тесты создают отдельную БД `polka_vps_probe_<pid>` на localhost. Production credentials, SSH и Docker Compose против VPS не используются.

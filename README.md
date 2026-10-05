# Клиника доктора Сулейменова

## Запуск

```bash
npm install
npm start
```

Откройте:
- Сайт: http://localhost:3000
- Админка: http://localhost:3000/admin

## Запуск в Docker

```bash
docker compose up -d --build     # собрать и запустить
docker compose logs -f           # логи (JSON-строки ошибок + обычный вывод)
docker compose down              # остановить (данные сохраняются в томах)
```

- Настройки берутся из `.env` (в образ он не попадает). Контейнер работает с `NODE_ENV=production`, поэтому `ADMIN_PASSWORD` должен быть не короче 12 символов.
- База и курсы валют лежат в томе `app-data`, фото — в томе `app-uploads`. Пересборка и обновление образа их не трогают.
- Порт на хосте меняется через `HOST_PORT=8080 docker compose up -d`.
- В production cookie админки помечен `Secure`. Админка работает на `http://localhost` и за HTTPS, но не по голому `http://IP-сервера`. На сервере ставьте перед контейнером nginx/Caddy с HTTPS и задайте `TRUST_PROXY=1` в `.env`.

Перенести текущую локальную базу и фото в контейнер (один раз; локальный `npm start` при этом остановлен):

```bash
docker compose stop
docker compose run --rm -v "${PWD}:/import" app node db/importLocal.js
docker compose start
```

Скрипт копирует базу через backup API SQLite, поэтому записи из `app.db-wal` не теряются, а файлы в томах принадлежат пользователю `node`.

### База данных (SQLite)

Все серверные данные хранятся в `data/app.db`:
- каталог услуг/товаров (`services`)
- заказы и позиции (`orders`, `order_items`)
- сессии админки (`admin_sessions`)

При первом запуске существующие `data/services.json` и `data/orders.json`
автоматически импортируются в SQLite и архивируются как `*.migrated.*`.

Фото остаются в `public/uploads/` (в БД хранится путь).

Пароль админки берётся из `.env` (`ADMIN_PASSWORD`) — **обязателен**.  
В `production` слабые значения вроде `admin` / `password` запрещены (сервер не стартует).

```bash
# Windows PowerShell
$env:ADMIN_PASSWORD="свой_пароль"
npm start
```

Или пропишите в файле `.env`:

```
ADMIN_PASSWORD=свой_пароль
```

В админке можно добавлять, редактировать и удалять услуги — они сразу появляются на сайте. Заявки клиентов — во вкладках «Заказы» и «Клиенты».

**Остатки:** пустое «Количество» = безлимит (удобно для услуг). Число `0` = нет в наличии. Списание остатка — атомарно внутри SQLite-транзакции (`BEGIN IMMEDIATE` + `quantity >= qty`). Отмена/удаление заказа возвращает остаток.

**Масштабирование (текущий контур):**
- WAL + `busy_timeout` + `synchronous=NORMAL`
- идемпотентность заказов (`Idempotency-Key`)
- индексы по заказам/позициям/сессиям
- `GET /api/health` для мониторинга
- один процесс Node + один writer SQLite (типичный вертикальный scale до заметной нагрузки)

Фото остаются в `public/uploads/` (в БД — путь; при замене/удалении позиции файл чистится, кроме seed-картинок).

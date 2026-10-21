# I-MAX Web Push — контракт разделения контуров и план production-выпуска

Статус: **проект для подтверждения разработчиком 1С. Не применять до письменного согласования.**

## 1. Доверенный контекст регистрации

### Принцип

Клиент не передаёт и не выбирает среду. При вызовах `/notifications/push/subscribe` и
`/notifications/push/unsubscribe` серверный прокси I-MAX добавляет служебный заголовок:

```text
X-ITUS-Push-Context: production | test
```

Значение задаётся только переменной окружения конкретной службы:

| Контур | Значение на сервере | Публичный адрес |
| --- | --- | --- |
| test | `test` | `https://max-test.ea-itus.ru/` |
| production | `production` | `https://ea-itus.ru/p/max-service/` |

Прокси удаляет одноимённый входящий заголовок клиента и устанавливает своё значение. 1С
доверяет только этому заголовку на server-to-server запросе, а не полю JSON.

Реализация кандидата назначает заголовок только для Web-регистраций в
`/notifications/push/subscribe` и `/notifications/push/unsubscribe`. Если Web-регистрация
пришла на службу без `WEB_PUSH_CONTEXT=test|production`, прокси отвечает
`503 WEB_PUSH_CONTEXT_NOT_CONFIGURED` и не обращается к 1С. Android-регистрации не получают
этот заголовок.

Android не меняется: его `platform: "android"`, FCM-токен, `/api/push/dispatch` и текущая
регистрация продолжают работать по прежнему контракту.

### Требования к 1С

Для Web Push 1С сохраняет вместе с регистрацией:

- `userId`;
- `clientInstanceId`;
- subscription endpoint и ключи;
- `platform = web`;
- `pushContext = test | production` — только из `X-ITUS-Push-Context`.

`subscribe` создаёт или обновляет только запись с тем же `pushContext`.
`unsubscribe` удаляет только запись с тем же `pushContext` и точным endpoint/ключами.

Все существующие Web-регистрации без `pushContext` получают статус `legacy` и:

- не считаются production-регистрациями;
- не выбираются ни для test-, ни для production-рассылки;
- заменяются только после явного повторного подключения уведомлений пользователем на нужном сайте.

### Выбор получателей и отправка

1С выбирает только Web-регистрации с контекстом текущего события:

- test → только `pushContext=test`, отправка на `https://max-test.ea-itus.ru/api/push/web/dispatch`;
- production → только `pushContext=production`, отправка на
  `https://ea-itus.ru/p/max-service/api/push/web/dispatch`.

Android FCM выбирается отдельно и отправляется только на существующий `/api/push/dispatch`.
Один пользователь может иметь Android- и Web-регистрации, но Web-регистрации test и production
не смешиваются. 1С не должна отправлять тестовые subscriptions на рабочий адрес или наоборот.

### Критерии согласования с 1С

Разработчик 1С подтверждает письменно:

1. проверку доверенного `X-ITUS-Push-Context`;
2. схему хранения `pushContext` и миграцию legacy-записей;
3. фильтрацию получателей перед каждым из двух событий: новое сообщение и назначение исполнителя;
4. разные адреса dispatch для test/production;
5. сохранность Android FCM без изменения его схемы.

До подтверждения production Web Push не выпускать в общую базу 1С.

## 2. Состав release-кандидата

Кандидат: `31c5dcad` плюс последующий коммит с исправлением поиска ЗН.

- Web Push: `web-push.mjs`, `server.mjs`, Service Worker, manifest, web-клиент и тесты.
- `LISTEN_HOST`: безопасная настройка привязки только через env.
- Исправление поиска ЗН: поле не пересоздаётся на каждом символе, поэтому Android не сбрасывает
  цифровую раскладку виртуальной клавиатуры.
- Android/FCM исходники не меняются.

## 3. Подготовка deployment до переключения

Production deployment-script должен получить одну строку после копирования `server.mjs`:

```bash
cp -f "$APP/web-push.mjs" "$PROD/web-push.mjs"
```

До переключения выполнить в staging-каталоге:

```bash
test -f "$APP/server.mjs"
test -f "$APP/web-push.mjs"
test -f "$APP/package.json"
test -f "$APP/package-lock.json"
npm ci --omit=dev --ignore-scripts
node -e "import('./web-push.mjs').then(() => console.log('web-push module OK'))"
```

Production VAPID подключается отдельным systemd drop-in, без копирования или вывода секретов:

```ini
# /etc/systemd/system/itus-max.service.d/web-push.conf
[Service]
EnvironmentFile=/etc/itus-max-web-push.env
```

Перед restart: `systemctl daemon-reload`. Существующие `/etc/itus-max.env`, Firebase credentials,
`PUSH_INTERNAL_TOKEN`, FCM-маршрут и параметры слушателя не изменяются.

## 4. Резервирование и откат

Создать отдельный каталог, например `/opt/itus-max-release-backup-<UTC>`:

```text
application/       # полная копия текущего /opt/itus-max, включая node_modules
deployment-script/ # копия /usr/local/bin/deploy-max.sh
unit-dropins/      # копия каталога /etc/systemd/system/itus-max.service.d либо маркер ABSENT
nginx/             # копия itus.conf и itus-max.conf только для аудита
metadata.txt       # владелец, режимы, текущий commit/hash и время
```

Секретные env-файлы не копируются: сохраняются на исходных путях с правами `600 root:root`.
Перед переключением собрать новый каталог полностью, проверить модули и назначить `itus:itus`.
Не удалять действующий `/opt/itus-max` через `rm -rf`: переключать каталоги переименованием в
пределах `/opt`:

```bash
mv /opt/itus-max /opt/itus-max-failed-<UTC>
mv /opt/itus-max-new-<UTC> /opt/itus-max
```

При ошибке сохранить неуспешный каталог для диагностики и выполнить обратные `mv`; только после
успешного health-check старые каталоги можно удалять отдельным согласованным действием.

Автоматический GitHub deployment после `push` в `main` вызывает `/usr/local/bin/deploy-max.sh`.
После ручного отката нельзя делать новый `push` в `main`: workflow повторно применит содержимое
main. Варианты восстановления: отдельный согласованный revert-коммит в `main` с новым deployment
либо отключение workflow на время ручного восстановления.

## 5. После согласованной выкладки

Проверить с одним согласованным пользователем и его устройствами:

1. `health`, Web Push config (`enabled=true`, без private key), manifest и Service Worker scope;
2. новую регистрацию на production-сайте — не переносить регистрации max-test;
3. Яндекс Windows и iPhone PWA с рабочего адреса;
4. переход в чат и заказ-наряд после холодного запуска и входа;
5. новое сообщение и назначение исполнителя из 1С;
6. отсутствие дубля Web Push/poll;
7. Android FCM тестовым событием через существующий маршрут.

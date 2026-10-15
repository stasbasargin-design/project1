# Push-уведомления I-MAX: настройка сервера и 1С

## Что реализовано в клиенте

Веб-клиент регистрирует Service Worker, по явному действию пользователя запрашивает разрешение, создаёт Web Push-подписку с публичным VAPID-ключом и передаёт её в 1С через обычный защищённый прокси `/api/1c`. Токены MAX, закрытый VAPID-ключ и ключи Firebase не передаются и не сохраняются в браузерном коде.

Клиент поддерживает события `new_messages`, `executor_assigned`, `executor_changed`, `task_assigned` и `quality_control_requested`. Дубликаты исключаются по `eventId`.

## Переменная окружения Timeweb

Сгенерируйте пару VAPID вне репозитория. Закрытый ключ храните только в защищённом окружении сервиса Push. В `config/itus.config.js` при сборке должен попадать только публичный ключ `WEB_PUSH_VAPID_PUBLIC_KEY`; в репозитории он оставлен пустым.

## Обязательные методы 1С

Все методы — `POST` с существующей авторизацией 1С и `X-ITUS-Token` от серверного прокси.

### `/notifications/push/subscribe`

1С определяет пользователя из авторизованного контекста, а не доверяет `userId` из тела. Хранить несколько активных подписок на одного пользователя; уникальный ключ — `endpoint` или `clientInstanceId`. При повторе обновлять запись.

```json
{
  "subscription": {
    "endpoint": "https://push.example/...",
    "keys": { "p256dh": "...", "auth": "..." }
  },
  "clientInstanceId": "UUID",
  "platform": "web",
  "userId": "MAX_ID"
}
```

Ответ: `{ "success": true, "data": { "registered": true } }`.

### `/notifications/push/unsubscribe`

Тело такое же. Удалять только подписку текущего авторизованного пользователя. Ответ: `{ "success": true, "data": { "removed": true } }`.

## Доставка

При событиях из 1С создавайте запись с неизменяемым `eventId`, определяйте адресата по бизнес-правилам и передавайте её в сервис Web Push/FCM. Повторная доставка того же `eventId` не должна создавать второе уведомление. Недействительные подписки (410/404 от Push-сервиса) удаляйте. Не включайте в Push токены, закрытые ссылки, Base64 или служебный JSON.

Пример полезной нагрузки:

```json
{
  "title": "I-MAX",
  "body": "Вам назначен заказ-наряд",
  "tag": "executor_assigned:EVENT_GUID",
  "data": { "url": "./?notification=EVENT_GUID" }
}
```

`/notifications/poll` остаётся резервным каналом синхронизации пропущенных событий. Он не является Push-доставкой.

## Android APK

Android-проект Capacitor расположен в `android/`, его applicationId — `ru.eazia.imax`. `google-services.json` размещён в `android/app/`; официальный плагин Capacitor запрашивает `POST_NOTIFICATIONS` на Android 13+, получает/обновляет FCM-токен, создаёт канал `i-max-events`, передаёт токен в `/notifications/push/subscribe`, удаляет его при logout и обрабатывает нажатие на уведомление.

Не используйте Web Push внутри Android WebView как замену FCM.

## Firebase Admin SDK для отправки FCM

1. Firebase Console → **Project settings** → **Service accounts**.
2. Нажать **Generate new private key** и сохранить JSON только в защищённом хранилище секретов Timeweb/CI.
3. Не помещать этот JSON в Git, APK, `google-services.json` или браузерный код.
4. Сервис доставки на сервере/в 1С использует Admin SDK, чтобы посылать сообщение на зарегистрированный FCM-токен. При ответах `UNREGISTERED` и `INVALID_ARGUMENT` соответствующий токен удаляется.
5. Полезная нагрузка должна содержать только короткий заголовок, текст и `data.orderRef`, `data.type` либо `data.topicRef`; по ним APK открывает нужный заказ-наряд или чат.

## Node.js: FCM-доставка для Timeweb

Node-сервер содержит два **внутренних** маршрута: `POST /api/push/test` и
`POST /api/push/dispatch`. Они не предназначены для браузера, не проксируются
в 1С и требуют заголовок `Authorization: Bearer <PUSH_INTERNAL_TOKEN>`.
Без переменной `PUSH_INTERNAL_TOKEN` оба маршрута возвращают `401`.

В окружении процесса I-MAX на Timeweb задайте только абсолютный путь к
закрытому ключу Firebase и отдельный случайный секрет для 1С:

```dotenv
GOOGLE_APPLICATION_CREDENTIALS=/etc/itus-max/firebase-service-account.json
PUSH_INTERNAL_TOKEN=длинная_случайная_строка_не_из_репозитория
```

1. В Firebase Console: **Project settings → Service accounts → Generate new private key**.
2. Передайте JSON на сервер по защищённому каналу в `/etc/itus-max/firebase-service-account.json`.
3. Ограничьте права: владелец пользователя сервиса, режим `600`; файл не должен быть в каталоге приложения, Git, backup-архиве или APK.
4. Добавьте две переменные в окружение systemd/панели Timeweb и перезапустите только Node-процесс.
5. Выполните тест от имени серверного процесса 1С. Токен устройства берётся из записи, созданной `/notifications/push/subscribe`, и не попадает в пользовательский интерфейс или логи:

```http
POST https://ea-itus.ru/p/max-service/api/push/test
Authorization: Bearer <PUSH_INTERNAL_TOKEN>
Content-Type: application/json

{"tokens":["FCM_TOKEN_из_защищённого_регистра_1С"],"body":"Проверка I-MAX"}
```

Ответ содержит только `sent`, `failed` и индексы недействительных токенов.
При `invalidTokenIndexes` 1С удаляет соответствующие токены из своего регистра.
Для рабочего события 1С вызывает `/api/push/dispatch` тем же внутренним
заголовком, максимум 500 токенов за запрос:

```json
{
  "tokens": ["..."],
  "title": "I-MAX",
  "body": "Вам назначен заказ-наряд",
  "data": {"type":"executor_assigned","orderRef":"GUID","eventId":"GUID"}
}
```

Для нового сообщения используйте `data: {"type":"new_messages","topicRef":"GUID","eventId":"GUID"}`.
APK по `orderRef` открывает карточку/раздел исполнителя, а по `topicRef` —
конкретную переписку. 1С остаётся владельцем регистра подписок и определяет
получателей по своим правам: Node.js не принимает `userId` от браузера и не
хранит токены на диске.

## Сборка APK

Локально требуется JDK 17+ и Android SDK. После этого:

```powershell
cd app-max
npm ci
npm run build
npx cap sync android
cd android
.\gradlew.bat assembleDebug
```

Результат: `android/app/build/outputs/apk/debug/app-debug.apk`.

В GitHub Actions добавлен workflow **Build I-MAX Android APK**. После запуска через Actions → Run workflow его артефакт `i-max-debug-apk` можно скачать со страницы запуска. Для production APK нужен отдельный upload keystore и secrets CI; их нельзя коммитить.

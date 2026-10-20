# Проверки локальной реализации — 20.10.2026

Основа: origin/main a076c44. Рабочая копия: imax-webpush. Ни production, ни GitHub не изменялись; реальные VAPID-секреты не создавались.

Выполнены npm test, npm run build и node --check для server.mjs, assets/web-push-client.js, notification-sw.js.

Новый тест web-push.test.mjs проверяет:

- настоящую генерацию тестовых VAPID/браузерных ключей и шифрование aes128gcm библиотекой web-push без сетевой отправки;
- отклонение HTTP, localhost/IP, поддельного hostname, нестандартного порта, credentials в endpoint и некорректных ключей;
- пакет без повторяющихся endpoint, ограничение размера payload;
- классификацию 410,429,503,401 и отсутствие приватного тела ошибки в результате;
- реальный HTTP-сервер: public config без private key, 401 закрытого маршрута, 400 недопустимого endpoint, прежний ответ Android при отсутствии Firebase credentials;
- manifest для установки веб-приложения;
- исполнение Service Worker: видимое уведомление, eventId-tag, холодный переход в нужный topicRef, запрет перехода на внешний origin;
- исполнение браузерного модуля: requestPermission вызывается синхронно из клика до await/subscribe; подсказка iPhone из вкладки и обработка denied;
- guards, исключающие включение Web Push вместо нативного Android-плагина.

Все прежние тесты прошли: нормализаторы, формат Push, Android-контракт, нативная регистрация FCM, переходы, приёмка, мессенджер, выбор медиа, соответствие вложений сообщениям, пути, контракт, подпуть публикации, рабочее время и прокси.

Не проверены: физическая доставка в iPhone/Яндекс Windows/Android; реальная 1С; реальные VAPID на Timeweb; поведение всех корпоративных политик и режимов ОС. Эти проверки требуют тестового окружения и устройств. Offline-тест не считается сквозной приёмкой.

Установка зависимостей сообщила 17 уязвимостей дерева (10 moderate, 7 high). Автоматическое обновление всего дерева/force не выполнялось: это отдельная проверка зависимостей, чтобы не менять рабочий Capacitor/Firebase вслепую.

## Передача Cursor

imax-webpush-2026-10-20.patch содержит только изменения исходников/контракта относительно a076c44. Применять в отдельной ветке актуального checkout после проверки `git apply --check`; при новых изменениях main выполнить осмысленное объединение. Затем npm ci, npm test, npm run build. Если репозиторий хранит dist и OPEN_REVIEW.html, включить результаты сборки в проверяемый diff согласно его правилам. Не заменять весь рабочий проект архивом и не выкладывать автоматически.

Новые файлы: app-max/web-push.mjs, assets/web-push-client.js, manifest.webmanifest, scripts/generate-vapid.mjs, tests/web-push.test.mjs и документы Web Push. Изменения существующих файлов: server.mjs, assets/app.js, notification-sw.js, index.html, scripts/build-static.mjs, package.json/package-lock.json. Android native-push.js, Android-проект и существующий FCM-обработчик не изменены.

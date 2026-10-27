# Команда для второго Cursor: проверка и выпуск I-MAX

Автор изменения заполняет поля в угловых скобках и передаёт текст целиком второму Cursor.

```text
Подготовь выпуск I-MAX, но не начинай production до явного подтверждения владельца.

Репозиторий: https://github.com/stasbasargin-design/project1.git
Ветка: <FEATURE_BRANCH>
Коммит кода: <FEATURE_SHA>
Базовый коммит: <BASE_SHA>
Новая версия: <VERSION>
Предыдущая подтверждённая production-версия и SHA: <PRODUCTION_VERSION_AND_SHA>
Заявленная область: <SCOPE>

1. Выполни `git fetch --prune origin`, затем проверь, что `<FEATURE_SHA>` доступен в `origin/<FEATURE_BRANCH>` и построен от `<BASE_SHA>`.
2. Сверь `<PRODUCTION_VERSION_AND_SHA>` с фактически работающей версией на Timeweb. Если SHA, версия или `origin/main` не совпадают с заявкой, остановись: перечисли расхождения и не меняй код, версии, PR или production.
3. Покажи точный diff `<BASE_SHA>..<FEATURE_SHA>` и список файлов. Не включай другие коммиты или уже существующие изменения production.
4. Проверь, что runtime-версия, package/package-lock, Android versionName/versionCode и release-заявка согласованы с `<VERSION>`. Версия должна быть новой; Android versionCode — больше предыдущего. При расхождении остановись и запроси исправление у автора.
5. В чистом клоне выполни `npm ci`, `npm test`, `npm run build`; покажи результаты и непроверенные устройства/интеграции.
6. Создай или обнови PR только из `<FEATURE_BRANCH>` в `main`. Не делай merge, push в `main`, `workflow_dispatch` или ручной deploy.
7. Передай владельцу точный состав выпуска, version/SHA, результаты проверок, план Timeweb-отката и ссылку на PR.

Начинай release только после отдельного сообщения владельца в точной форме:
`ПОДТВЕРЖДАЮ PRODUCTION: <VERSION> <FEATURE_SHA>`.

После такого подтверждения:
8. Используй штатный merge PR в `main`; не делай force-push. Убедись, что merged commit соответствует проверенному коду.
9. Дождись GitHub Actions для release SHA: `Deploy MAX Service` (Timeweb) и `Build I-MAX Android APK`. Не запускай workflow для другого SHA.
10. Проверь health-check Timeweb и требуемые сценарии; APK скачивай только из workflow run release SHA.
11. При сбое остановись, сохрани логи workflow без секретов, выполни только согласованный rollback и сообщи владельцу фактический результат.
```

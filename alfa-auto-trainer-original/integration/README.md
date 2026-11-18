# Подключение к 1С через JSON

WEB-приложение полностью выполняет интерфейс, ввод данных прямо в объектах, локальные проверки, расчёты, печатные формы, учебные сценарии, очередь запросов, повторы и автономный режим. Для рабочего контура разработчику 1С требуется опубликовать один HTTP endpoint и сопоставить JSON с прикладными объектами конкретной базы Альфа‑Авто 6.1.

## Единственная настройка клиента

В `config.js` измените:

```js
mode: 'http',
endpoint: '/hs/alfa_auto_web/v1/exchange'
```

Пароли и токены в `config.js` не хранить. Предпочтителен same-origin: приложение и HTTP-сервис публикуются через один HTTPS-домен, а аутентификацию выполняет веб-сервер или сессия 1С.

## Протокол

- Метод: `POST`.
- `Content-Type: application/json; charset=utf-8`.
- Запросы и ответы: схемы `request.schema.json`, `response.schema.json`, `state.schema.json`.
- Каждый запрос имеет уникальный `requestId`. 1С должна хранить результат уже исполненной изменяющей команды и при повторе возвращать тот же результат, не создавая второй документ.
- Клиент повторяет только сетевые ошибки, тайм-аут и HTTP 5xx. Неотправленные запросы сохраняются в локальной очереди.
- При конфликте ревизий вернуть `REVISION_CONFLICT`, `retryable: false`; клиент перечитает состояние командой `session.bootstrap`.

## Действия верхнего уровня

| action | Назначение | Ответ `data` |
|---|---|---|
| `session.bootstrap` | Контекст пользователя, начальное состояние справочников и документов | `revision`, `userContext`, `state` |
| `state.save` | Отложенное сохранение введённых реквизитов и строк | `revision`, при необходимости `state` |
| `workflow.execute` | Проведение, создание на основании, резерв, РСО/ПСО, отправка | `revision`, актуальный `state` |
| `events.pull` | Изменения 1С после курсора | `events`, `nextCursor` |

## Команды `workflow.execute`

Приложение отправляет имя нажатого действия. Основные изменяющие команды:

- `directory.save` — создать или изменить автоработу, номенклатуру, контрагента либо автомобиль;
- `quick-transfer` — перенести быстрый подбор в товары ЗН;
- `customer-order-fill`, `customer-order-post`, `customer-order-create-reserve`, `customer-order-create-supplier`;
- `reservation-fill`, `reservation-post`, `reservation-unreserve`, `reservation-create-supplier`;
- `supplier-fill-orders`, `supplier-order-post`, `supplier-receive`;
- `production-fill`, `production-post`, `production-return`;
- `warehouse-post-pso`, `warehouse-post-rso`;
- `event-conduct`, `zn-conduct`, `email-send`, `max-send`.

Вместе с командой передаётся полный снимок `payload.state`. Поэтому первая интеграция может быть реализована без дополнительного REST API: обработчик получает команду и актуальное состояние формы, выполняет действие в 1С и возвращает обновлённый снимок.

## Сопоставление объектов

| JSON | Объект 1С |
|---|---|
| `directories.works` | Справочник авторабот |
| `directories.parts` | Номенклатура / запасные части |
| `directories.counterparties` | Контрагенты |
| `directories.cars` | Автомобили |
| `documents.event` | Событие CRM |
| `documents.zn` | Заказ-наряд, автоработы и товары |
| `documents.kp`, `documents.kpData` | Калькуляция / КП |
| `documents.customerOrder` | Заказ покупателя |
| `documents.reservation` | Резервирование под заказ покупателя |
| `documents.supplierOrder` | Заказ поставщику |
| `documents.production` | Перемещение/списание товаров в производство |
| `documents.warehouseOrders` | ПСО и РСО |
| `documents.max`, `documents.email` | Исходящие сообщения и вложения |

Для устойчивой связи добавьте в возвращаемые элементы поле `ref` со строковым UUID ссылки 1С. Вводимые пользователем `id` сохраняйте как клиентский идентификатор до получения `ref`.

## События 1С

Минимальная реализация `events.pull` всегда может возвращать пустой массив. Для фоновой синхронизации используйте события:

```json
{
  "id": "event-00042",
  "type": "state.replace",
  "occurredAt": "2026-07-20T10:30:00Z",
  "payload": { "state": { "schemaVersion": "1.0", "revision": 27 } }
}
```

## Проверка готовности

1. `session.bootstrap` возвращает JSON с тем же `requestId`.
2. Изменение поля в форме приводит к `state.save` и увеличению ревизии.
3. Повтор одного `workflow.execute` с тем же `requestId` не создаёт дубль.
4. Ошибка возвращается JSON-объектом, а не HTML-страницей 1С.
5. После временного отключения 1С запрос остаётся в очереди и уходит после восстановления.
6. Русский текст и символы передаются в UTF‑8 без BOM.

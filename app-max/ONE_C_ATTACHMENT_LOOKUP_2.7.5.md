# I-MAX 2.7.5 — получение вложения сообщения

## Метод

Отдельный маршрут для открытия фото не нужен. Используются существующие методы:

- `/clients/messages/list` — внешний чат;
- `/internal-chat/messages/list` — внутренний чат.

Обычная загрузка истории передаёт `includeAttachmentContent: false`. При открытии или скачивании конкретного вложения приложение передаёт оба идентификатора:

```json
{
  "topicRef": "TOPIC_GUID",
  "topicId": "TOPIC_GUID",
  "includeAttachmentContent": true,
  "messageRef": "MESSAGE_GUID",
  "attachmentRef": "FILE_GUID"
}
```

Для внутреннего чата вместо `topicRef` и `topicId` передаются `groupRef` и `groupId`.

## Обязательная обработка в 1С

1. Проверить права текущего сотрудника на тему или группу.
2. Найти сообщение строго по `messageRef` внутри указанного чата.
3. Найти вложение строго внутри этого сообщения по `attachmentRef`.
4. Не возвращать вложение другого сообщения даже при совпадении идентификатора файла.
5. Если сообщение или вложение не найдено, вернуть понятную прикладную ошибку (`success: false`).

При успехе вернуть сообщение с тем же `messageRef` и вложение с тем же `fileRef`:

```json
{
  "success": true,
  "data": {
    "messages": [{
      "messageRef": "MESSAGE_GUID",
      "attachments": [{
        "fileRef": "FILE_GUID",
        "fileName": "photo.jpg",
        "mimeType": "image/jpeg",
        "sizeBytes": 523000,
        "contentBase64": "BASE64_WITHOUT_DATA_URL_PREFIX"
      }]
    }]
  }
}
```

`messageRef` и `attachmentRef` берутся только из ответа 1С на историю чата. Приложение не создаёт их самостоятельно.

# ITUS 2.6.0: website and Android

## Changes in 2.6.0

- The authenticated header now shows the employee name returned by 1C and no longer shows the MAX ID as the visible name or role fallback.
- If a selected order already has a defect document, the `Создана` status in the order card is now an action that opens the full defect history.
- Defect history accepts media returned by 1C as `file`, `attachment`, `media`, `attachments` or `files`, including multiple photos/videos in one record.
- Notifications are checked every 3 seconds through a lightweight `/notifications/poll` request. The request asks 1C for new events and counters only; chat history and media are never loaded by the timer.
- Attachments in chats are metadata-only until the user presses «Открыть фото», «Смотреть видео» or «Открыть файл». The full attachment payload is requested on demand.
- Outgoing messages show «Отправлено», «Получено» or «Прочитано» when 1C returns the corresponding delivery status. Client chats also support approval polls with «Согласовано» and «Не согласовано».
- `/auth/max` accepts the Альфа‑Авто response shape where `data` is an array of blocks (`user` and `availableTabs`). `roleName: "admin"` or `role: "Администратор"` opens all application tabs; other users receive only the tabs from `availableTabs`.

## What is fixed in these files

- The notification service worker is syntactically valid. The Android APK has a notification channel and requests the Android 13+ permission. Foreground notifications from the existing `/notifications/poll` appear in the system tray after permission is granted.
- Opening "Добавить дефект" refreshes the full existing defect history for the selected repair order, including media. Adding a new entry does not create a second document.
- All in-app speech controls were removed. Text is entered with the normal phone/keyboard input, including the keyboard's own dictation button.
- The camera chooser returns a full photo to the web form through a scoped Android content provider. Gallery/file selection remains available.
- The header accepts the employee name from `name`, `fullName`, `displayName`, `userName`, `employeeName` or nested employee/profile data in `/auth/max`.
- Opening a client or internal conversation sends `POST /clients/messages/read` or `POST /internal-chat/messages/read` with the incoming message identifiers; unread counts clear only after a successful response.
- Internal chats use the same interface as external ones. Contacts are loaded only from 1C and filtered to `authorized: true`. The `Передача смены` group is pinned if returned by 1C; otherwise an explicit error is shown. Opening a contact invokes `/internal-chat/direct/open` if it has no existing `conversationRef`.

## Required 1C work before full acceptance

The deployed 1C service returns HTTP 404 for `/acceptance/entries/add`. The phone now returns the camera photo correctly, but **it cannot store the attachment** until the HTTP handler is implemented in 1C. The exact JSON request/response is in `1C_HTTP_METHODS_RELEASE.json`.

The 1C team must also implement and authorize these routes from that contract:

| Route | Expected behavior |
| --- | --- |
| `/clients/messages/read` | Idempotently mark the listed incoming messages as read for the current user/topic. |
| `/internal-chat/messages/read` | Same for group or private conversation; unread count is per employee. |
| `/internal-chat/contacts/list` | Return only successfully authorized employees, excluding the current user. Each record has `employeeRef`, `name`, `authorized: true`, and optional `conversationRef`. |
| `/internal-chat/direct/open` | Find or create exactly one private conversation with the authorized `employeeRef`, returning `groupRef`. Reject unauthorized contacts. |
| `/internal-chat/groups/list` | Include one permanent group titled `Передача смены` for all internal users, plus permitted private conversations. The group must have a persistent `groupRef`; 1C owns membership, messages and history. |
| `/acceptance/entries/add` | Save the Base64 media file to the selected acceptance document, de-duplicate by `clientEntryId`, and return the saved `entry` with `fileRef`. |
| `/clients/polls/send` and `/clients/polls/vote` | Create an approval poll in a client conversation and save the selected answer. |

No fictitious group or local chat history is created on the phone. Before those 1C routes are deployed, those parts remain blocked with an error rather than pretending to save or read messages.

## Notifications when app is closed

This release supports polling and device notifications **while the app is running**. Android cannot guarantee delivery when the app is closed from the current polling endpoint. For reliable background notifications, connect FCM (server token registration, 1C event-to-push delivery and Firebase Android configuration) or send them through MAX. No Firebase credentials or push endpoint were supplied, so background delivery is not claimed.

## Deployment

Upload `itus-site-v2.6.0.zip` to `/root` via WinSCP. In the VPS terminal run each line, not the prompt or output text:

```bash
RELEASE_DIR=$(mktemp -d /tmp/itus-release.XXXXXX)
unzip -q /root/itus-site-v2.6.0.zip -d "$RELEASE_DIR"
cd "$RELEASE_DIR"
bash UPDATE_ON_SERVER.sh
bash UPDATE_NGINX.sh
curl -i --max-time 20 https://ea-itus.ru/p/max-service/health
```

The update script backs up `/opt/itus-max` and keeps `/etc/itus-max.env`. Test the new web UI at `https://ea-itus.ru/p/max-service/`. Install `itus-max-android-v1.3.1.apk` directly on the phone over the previous signed app. In the app, open Settings > Notifications > Allow notifications. Grant the Android permission; no uninstall is needed.

## Verification

`npm run build`, `npm test`, `npm run test:review`, `node --check notification-sw.js`, and `bash android_native/build-apk.sh`. The APK signature uses the same certificate as v1.1. Browser automation could not be run in this environment because Chromium is not installed; the chat logic is covered by `tests/messenger.test.mjs` with a mocked 1C response. Test camera capture and real 1C routes on the actual phone after server deployment.

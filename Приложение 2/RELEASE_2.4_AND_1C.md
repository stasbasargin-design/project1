# ITUS 2.4: website and Android

## What is fixed in these files

- The notification service worker is syntactically valid. The Android APK has a notification channel and requests the Android 13+ permission. Foreground notifications from the existing `/notifications/poll` appear in the system tray after permission is granted.
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

No fictitious group or local chat history is created on the phone. Before those 1C routes are deployed, those parts remain blocked with an error rather than pretending to save or read messages.

## Notifications when app is closed

This release supports polling and device notifications **while the app is running**. Android cannot guarantee delivery when the app is closed from the current polling endpoint. For reliable background notifications, connect FCM (server token registration, 1C event-to-push delivery and Firebase Android configuration) or send them through MAX. No Firebase credentials or push endpoint were supplied, so background delivery is not claimed.

## Deployment

Upload `itus-site-v2.4.0.zip` to `/root` via WinSCP. In the VPS terminal run each line, not the prompt or output text:

```bash
RELEASE_DIR=$(mktemp -d /tmp/itus-release.XXXXXX)
unzip -q /root/itus-site-v2.4.0.zip -d "$RELEASE_DIR"
cd "$RELEASE_DIR"
bash UPDATE_ON_SERVER.sh
bash UPDATE_NGINX.sh
curl -i --max-time 20 https://ea-itus.ru/p/max-service/health
```

The update script backs up `/opt/itus-max` and keeps `/etc/itus-max.env`. Test the new web UI at `https://ea-itus.ru/p/max-service/`. Install `itus-max-android-v1.2.0.apk` directly on the phone over the previous signed app. In the app, open Settings > Notifications > Allow notifications. Grant the Android permission; no uninstall is needed.

## Verification

`npm run build`, `npm test`, `npm run test:review`, `node --check notification-sw.js`, and `bash android_native/build-apk.sh`. The APK signature uses the same certificate as v1.1. Browser automation could not be run in this environment because Chromium is not installed; the chat logic is covered by `tests/messenger.test.mjs` with a mocked 1C response. Test camera capture and real 1C routes on the actual phone after server deployment.

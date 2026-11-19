# I-MAX 2.9.7 — test candidate

## Source and scope

Production/main base: `5269f8c5d6a993729c0eff230d1a582e809206e0` (2.9.3).
Preserved complete test base: `108c7d53239442951bf05b0a637a0f1e5474f7bc` (2.9.6).
Branch: `feature/ui-settings-holiday-297`. Android: 2.9.7 / 2907.

This is a test-only update. No production merge, production deploy, API address,
signing-key replacement, dependency upgrades or database migration is included.

## User-visible changes

- Shared light, dark and device theme for existing cards, fields, settings,
  documents, chats and action dialogs. Preferences stay on the device.
- Settings are grouped into Appearance, Application, Connection, and Help.
  Existing environment selector, display size, notification preferences, queue,
  large-file connection, reload, update and logout remain available.
- New Year logo decoration, static garland and greeting:
  **10 December 2026 00:00:00 through 12 January 2027 23:59:59.999**,
  Asia/Yekaterinburg (UTC+05). The end boundary is 13 January 2027 00:00, exclusive.
  The event does not recur automatically in another year. Turning it off hides
  decoration and prevents opening the greeting. Motion respects reduced motion.
- Before the event, the test host/localhost offers an explicit greeting preview.
  Preview does not enable the real event or alter its dates.
- Familiar chat appearance; existing reply, reaction, swipe, hold and forwarding
  logic is preserved. A visible message menu makes actions discoverable.
  Client chats still have **no replies or reactions**, even if 1C advertises them.
  A small order context is shown only when existing client-topic metadata supplies
  an order number or vehicle plate; no additional request is generated for it.
- Four summary blocks: Post, Executor, URV Package, Defect Sheet. Information and
  existing interactive blocks are visually distinct. Lower MP, Executor and Tech
  action buttons and their original availability rules are preserved.
- The selected order is read again on entering MP/Executor/Tech and returning to
  a visible application, with a 10-second throttle and one in-flight read per
  user/session/environment/order. Editors/overlays and focused input prevent a
  repaint. Existing unsaved process objects are preserved by the order merge.

## 1C developer

**No new method or write contract is required for this update.**

The existing `POST /orders/get` must return the current reason in `reason`
(supported legacy alternatives: `appealText`, `description`). Existing
`POST /orders/list` remains the manual list-refresh path. A read response must
represent the actual current order and contour. The client cannot correct a
stale `reason` returned by the service itself.

Replies/reactions continue to use the already agreed 2.9.6 internal-chat contract
and capability flags; this update neither enables unsupported capabilities nor
changes the MAX/Telegram integration.

## Verification

Run `npm ci`, `npm test`, `npm run test:review`, `npm run build`, `git diff --check`.
The full existing suite includes queue/IndexedDB leases, immutable upload IDs,
loss of response, document completion ordering, cross-user/environment isolation,
native Back, Push, diagnostics, update channel, chats and document media viewers.

Additional regressions cover holiday start/end/year boundaries, theme persistence,
the off switch, one concurrent read, throttling, old-session responses, foreground
refresh without recreating documents, unsaved acceptance values, retained role
actions, message menus and dark settings at 320/393/1200 px.

On max-test, compare public assets and build identity against the CI manifest,
verify auth and read-only order/chat routes, verify protected diagnostics/Push,
and retain existing queues, env, update channel and server state directories.
Preview uses synthetic data and performs no real 1C writes.

Physical Android/iPhone keyboard and gesture behavior must be distinguished from
headless browser checks in the final report. A production release is separate.

## Rollback

Before test installation, keep the entire current test application directory.
Rollback stops only `itus-max-webpush-test.service`, moves the failed test
application aside, restores that backup directory, starts the same service and
checks `/health` plus public `build-info.json`. Never clear browser IndexedDB or
server media state. Production service/env and installed user data are untouched.

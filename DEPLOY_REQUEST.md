# I-MAX production release 2.7.11

- Repository: https://github.com/stasbasargin-design/project1
- Branch: feature/qr-order-media-limits
- GitHub base: 43924a1ffaa796723a25b4a63d7575a7fec9a584
- Release commit: to be filled by the metadata commit itself.
- Versions: runtime i-max-2.7.11; npm 2.7.11; Android 2.7.11 / 2711.
- APK build is a CI verification artifact only; do not distribute a randomly debug-signed APK as an update.

## Scope
Preserve attachment identity and IndexedDB lease; stop implicit retries after 422; safe diagnostics; action-button states; Back navigation; chat viewport; acceptance complete after confirmed uploads; no spinner on terminal error.
Add the built-in five-character order QR scanner, native photo/video/gallery modes, separate media limits and the `/worktime/production` grade table. Video remains limited to 15 MiB until the 1C transport is measured and approved. Android package, Firebase, Push, signing configuration, message authors and photo compression remain unchanged.

## Production baseline
Observed 2026-10-28: production reports i-max-2.7.5 while origin/main is 2.7.9. The server checkout had only generated `app-max/dist` and `OPEN_REVIEW.html` modifications, which previously blocked `git pull --ff-only`; those exact generated paths were restored before this release. Test reports i-max-2.7.9.

## Checks and limits
`npm ci`, `npm test` (including real browser IndexedDB), `npm run test:review`, `npm run build`, `git diff --check`, local Android compile and GitHub Android CI passed. QR completeness outside a limited 1C result set and real-device camera behavior remain external acceptance gates; they do not change existing flows. The 20 MiB/unlimited-video branch is explicitly excluded.

## Release
Use the repository PR process and the standard Deploy MAX Service workflow for the approved SHA. No manual production file replacement. Existing deploy script backs up the application and deploy script, builds the stage, switches directories and rolls back on failed health checks.
Preserve all server env/secrets and client IndexedDB. Do not change test service. Verify production health, app/queue hashes, manifest, service worker, public Web Push configuration and service state. No business writes/push sends without agreed test recipients.

## Signing
Use existing certificate 906BA322884FCA8C92C2D884CDEBB8EC8F4EB3D527BAF7D06929970BA77BCB47, matching I-MAX-2.7.7-production.apk. No new signing key. USB inspection was declined: compatibility with the current phone certificate is unverified. Never uninstall or clear app data to work around a signing mismatch.
No store upload or AAB is requested.

# I-MAX production release 2.7.10

- Repository: https://github.com/stasbasargin-design/project1
- Branch: fix/production-2.7.10
- GitHub base: 43924a1ffaa796723a25b4a63d7575a7fec9a584
- Tested code: 2edda96fef6b2167159dd65ec33650352da35d4c
- Versions: runtime i-max-2.7.10; npm 2.7.10; Android 2.7.10 / 2710.
- APK: I-MAX-2.7.10.apk

## Scope
Preserve attachment identity and IndexedDB lease; stop implicit retries after 422; safe diagnostics; action-button states; Back navigation; chat viewport; acceptance complete after confirmed uploads; no spinner on terminal error.
Only version metadata changes on top of the tested code. Dependency versions, Firebase, 1C routes, roles, image quality and Android package remain unchanged.

## Production baseline
Observed 2026-10-28: public app.js matches 9927b727 after line-ending normalization; queue matches inherited 5ae40de; server.mjs matches current main. This is file-level evidence, not a claim of a clean deployed checkout. Commit 9927b727 is an ancestor of main and its changes are retained.

## Checks and limits
Run npm ci, npm test (including real browser IndexedDB), npm run build, git diff --check. User accepted the main three-photo test on max-test. Browser-restart/network-loss cases are not fully accepted; not every server-side 422 has been diagnosed.

## Release
Use the repository PR process and the standard Deploy MAX Service workflow for the approved SHA. No manual production file replacement. Existing deploy script backs up the application and deploy script, builds the stage, switches directories and rolls back on failed health checks.
Preserve all server env/secrets and client IndexedDB. Do not change test service. Verify production health, app/queue hashes, manifest, service worker, public Web Push configuration and service state. No business writes/push sends without agreed test recipients.

## Signing
Use existing certificate 906BA322884FCA8C92C2D884CDEBB8EC8F4EB3D527BAF7D06929970BA77BCB47, matching I-MAX-2.7.7-production.apk. No new signing key. USB inspection was declined: compatibility with the current phone certificate is unverified. Never uninstall or clear app data to work around a signing mismatch.
No store upload or AAB is requested.

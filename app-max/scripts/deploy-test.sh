#!/usr/bin/env bash
set -Eeuo pipefail
# Test-only counterpart of deploy-max.sh. All application files come from one
# immutable GitHub commit; persistent media state and secret env stay outside.
SHA="${1:-}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || exit 2
REPO=/opt/itus/project1-git
PROD=/opt/itus-max-webpush-test
SERVICE=itus-max-webpush-test.service
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BUILD="/opt/itus-max-test-build-${SHA:0:8}-${STAMP}"
STAGE="/opt/itus-max-test-next-${STAMP}"
PREVIOUS="/opt/itus-max-webpush-test-backup-${STAMP}"
FAILED="/opt/itus-max-test-failed-${STAMP}"
[[ "$PROD" == /opt/itus-max-webpush-test && "$SERVICE" == itus-max-webpush-test.service ]]
exec 9>/run/lock/itus-max-test-deploy.lock
flock -n 9 || exit 2
git -C "$REPO" cat-file -e "$SHA^{commit}"
test ! -e "$BUILD" && test ! -e "$STAGE" && test ! -e "$PREVIOUS"
git -C "$REPO" worktree add --detach "$BUILD" "$SHA"
cleanup(){ git -C "$REPO" worktree remove --force "$BUILD" >/dev/null 2>&1 || true; }
trap cleanup EXIT
APP="$BUILD/app-max"
cd "$APP"
npm ci --ignore-scripts --no-audit
IMAX_BUILD_SHA="$SHA" npm run build
node --check server.mjs
node --check assets/app.js
node --check media-service.mjs
node --check media-jobs.mjs
install -d -m 0750 "$STAGE"
cp -a dist assets "$STAGE/"
cp -f server.mjs static-path.mjs web-push.mjs media-proxy.mjs media-store.mjs media-s3.mjs media-jobs.mjs media-service.mjs media-downloads.mjs media-metadata.mjs write-ledger.mjs package.json package-lock.json "$STAGE/"
install -d "$STAGE/scripts"
cp -f scripts/media-device-code.mjs "$STAGE/scripts/"
printf '%s\n' "$SHA" > "$STAGE/RELEASE_COMMIT"
cd "$STAGE"
npm ci --omit=dev --ignore-scripts --no-audit
chown -R itus:itus "$STAGE"
rollback(){
  trap - ERR HUP INT TERM
  set +e
  systemctl stop "$SERVICE"
  if test -d "$PREVIOUS"; then
    if test -d "$PROD"; then mv -T "$PROD" "$FAILED" || exit 1; fi
    mv -T "$PREVIOUS" "$PROD" || exit 1
  fi
  systemctl start "$SERVICE"
  echo "TEST DEPLOY FAILED; restored=$PREVIOUS failed=$FAILED" >&2
  exit 1
}
trap rollback ERR HUP INT TERM
systemctl stop "$SERVICE"
mv -T "$PROD" "$PREVIOUS"
mv -T "$STAGE" "$PROD"
systemctl start "$SERVICE"
for attempt in {1..20}; do
  if curl --connect-timeout 2 --max-time 4 -fsS http://127.0.0.1:8081/health >/dev/null; then break; fi
  sleep 1
done
curl --connect-timeout 5 --max-time 20 -fsS https://max-test.ea-itus.ru/health | IMAX_EXPECTED_SHA="$SHA" node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const h=JSON.parse(s);if(!h.success||h.commit!==process.env.IMAX_EXPECTED_SHA)throw Error("Public test SHA mismatch");console.log(`Verified test ${h.version} ${h.commit}`);'
curl --connect-timeout 5 --max-time 20 -fsS https://max-test.ea-itus.ru/api/media/config | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const h=JSON.parse(s);if(!h.success||!h.data?.enabled||h.data.thresholdBytes!==10485760)throw Error("Media buffer is unavailable");'
systemctl is-active --quiet "$SERVICE"
systemctl is-active --quiet itus-max.service
trap - ERR HUP INT TERM
echo "TEST DEPLOY SUCCESS commit=$SHA previous=$PREVIOUS"

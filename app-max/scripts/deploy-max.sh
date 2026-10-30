#!/usr/bin/env bash
# Invoked only by the verified main workflow with its immutable commit SHA.
set -Eeuo pipefail
SHA="${1:-}"
[[ "$SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'An exact 40-character release SHA is required' >&2; exit 2; }
REPO=/opt/itus/project1-git
PROD=/opt/itus-max
SERVICE=itus-max
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BUILD="/opt/itus-max-build-${SHA:0:8}-${STAMP}"
STAGE="/opt/itus-max-next-${STAMP}"
BACKUP="/opt/itus-max-release-backup-${STAMP}"
PREVIOUS="/opt/itus-max-previous-${STAMP}"
FAILED="/opt/itus-max-failed-${STAMP}"
exec 9>/run/lock/itus-max-deploy.lock
flock -n 9 || { echo 'Another I-MAX deployment is active' >&2; exit 2; }
git -C "$REPO" fetch origin main
test "$(git -C "$REPO" rev-parse origin/main)" = "$SHA" || { echo 'Release was superseded; refusing an unrelated main revision' >&2; exit 2; }
test ! -e "$BUILD" && test ! -e "$STAGE" && test ! -e "$PREVIOUS"
git -C "$REPO" worktree add --detach "$BUILD" "$SHA"
cleanup() { git -C "$REPO" worktree remove --force "$BUILD" >/dev/null 2>&1 || true; }
trap cleanup EXIT
APP="$BUILD/app-max"
cd "$APP"
npm ci --ignore-scripts
IMAX_BUILD_SHA="$SHA" npm run build
node --check server.mjs
node --check assets/app.js
node --check assets/operation-queue.js
node --check assets/messenger.js
test -f dist/build-info.json && test -f dist/notification-sw.js && test -f assets/worktime.js
install -d -m 0750 "$STAGE"
cp -a dist assets "$STAGE/"
cp -f server.mjs static-path.mjs web-push.mjs media-proxy.mjs media-store.mjs media-s3.mjs media-jobs.mjs media-service.mjs media-downloads.mjs package.json package-lock.json "$STAGE/"
install -d "$STAGE/scripts"
cp -f scripts/media-device-code.mjs "$STAGE/scripts/"
printf '%s\n' "$SHA" > "$STAGE/RELEASE_COMMIT"
cd "$STAGE"
npm ci --omit=dev --ignore-scripts
IMAX_EXPECTED_SHA="$SHA" node --input-type=module -e 'import fs from "node:fs"; const i=JSON.parse(fs.readFileSync("dist/build-info.json")); if(i.commit!==process.env.IMAX_EXPECTED_SHA)throw Error("Staged SHA mismatch");'
chown -R itus:itus "$STAGE"
# Leave secrets in the existing systemd EnvironmentFiles; no env is copied.
install -d -m 0750 -o root -g root "$BACKUP"
cp -a "$PROD" "$BACKUP/application"
cp -a /usr/local/bin/deploy-max.sh "$BACKUP/deploy-max.sh"
cp -a /etc/nginx/snippets/itus-max.conf "$BACKUP/itus-max.conf"
git -C "$REPO" fetch origin main
test "$(git -C "$REPO" rev-parse origin/main)" = "$SHA" || { echo 'Main advanced during preparation; production unchanged' >&2; exit 2; }
rollback() {
  trap - ERR HUP INT TERM
  set +e
  if test -f "$BACKUP/itus-max.conf"; then
    cp -a "$BACKUP/itus-max.conf" /etc/nginx/snippets/itus-max.conf
    nginx -t && systemctl reload nginx
  fi
  systemctl stop "$SERVICE"
  if test -d "$PREVIOUS"; then
    if test -d "$PROD" && ! mv -T "$PROD" "$FAILED"; then
      echo "ROLLBACK FAILED: cannot preserve current directory; previous=$PREVIOUS" >&2
      systemctl start "$SERVICE" || true
      exit 1
    fi
    if ! mv -T "$PREVIOUS" "$PROD"; then
      echo "ROLLBACK FAILED: cannot restore previous=$PREVIOUS; failed=$FAILED" >&2
      exit 1
    fi
  fi
  if ! systemctl start "$SERVICE"; then
    echo "ROLLBACK FAILED: service start failed; backup=$BACKUP" >&2
    exit 1
  fi
  if ! curl --retry 5 --retry-delay 1 --retry-connrefused --connect-timeout 2 --max-time 4 -fsS http://127.0.0.1:8080/health >/dev/null; then
    echo "ROLLBACK FAILED: restored service health check failed; backup=$BACKUP" >&2
    exit 1
  fi
  echo "DEPLOY FAILED; previous application restored. backup=$BACKUP failed=$FAILED" >&2
  exit 1
}
trap rollback ERR HUP INT TERM
bash "$APP/scripts/configure-media-nginx.sh"
systemctl stop "$SERVICE"
mv -T "$PROD" "$PREVIOUS"
mv -T "$STAGE" "$PROD"
systemctl start "$SERVICE"
for attempt in {1..20}; do
  if curl --connect-timeout 2 --max-time 4 -fsS http://127.0.0.1:8080/health >/dev/null; then break; fi
  sleep 1
done
curl --connect-timeout 5 --max-time 20 -fsS https://ea-itus.ru/p/max-service/health | IMAX_EXPECTED_SHA="$SHA" node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const h=JSON.parse(s);if(!h.success||h.commit!==process.env.IMAX_EXPECTED_SHA)throw Error("Public health SHA mismatch");console.log(`Verified production ${h.version} ${h.commit}`);'
curl --connect-timeout 5 --max-time 20 -fsS https://ea-itus.ru/p/max-service/manifest.webmanifest >/dev/null
curl --connect-timeout 5 --max-time 20 -fsS https://ea-itus.ru/p/max-service/notification-sw.js >/dev/null
curl --connect-timeout 5 --max-time 20 -fsS https://ea-itus.ru/p/max-service/api/push/web/config | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const h=JSON.parse(s);if(!h.success||!h.data?.enabled||!h.data?.publicKey||h.data?.privateKey)throw Error("Web Push config failed");'
systemctl is-active --quiet "$SERVICE"
trap - ERR HUP INT TERM
echo "DEPLOY SUCCESS commit=$SHA backup=$BACKUP previous=$PREVIOUS"

#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Запустите от root'; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET=/opt/itus-max
[[ -f "$TARGET/server.mjs" && -f /etc/itus-max.env ]] || { echo 'Установленное приложение не найдено. Используйте INSTALL_ON_SERVER.sh для новой установки.'; exit 1; }
node --check "$SOURCE_DIR/server.mjs"
node --check "$SOURCE_DIR/dist/assets/app.js"
node --check "$SOURCE_DIR/dist/assets/messenger.js"
BACKUP="$(mktemp -d /opt/itus-max-backup-XXXXXX)"
cp -a "$TARGET" "$BACKUP/app"
cp -a /etc/itus-max.env "$BACKUP/itus-max.env"
echo "Резервная копия: $BACKUP"
rollback() {
  echo 'Обновление не прошло проверку. Возвращаем файлы приложения.' >&2
  cp -a "$BACKUP/app/." "$TARGET/"
  systemctl restart itus-max || true
}
trap rollback ERR
cp -a "$SOURCE_DIR/dist/." "$TARGET/dist/"
cp "$SOURCE_DIR/server.mjs" "$SOURCE_DIR/static-path.mjs" "$SOURCE_DIR/package.json" "$TARGET/"
chown -R --reference="$BACKUP/app" "$TARGET/dist"
chmod -R a+rX "$TARGET/dist"
systemctl restart itus-max
for attempt in 1 2 3 4 5; do
  if curl -fsS --max-time 5 http://127.0.0.1:8080/health | node -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{process.exit(JSON.parse(s).service==="ITUS"?0:1)}catch{process.exit(1)}})'; then
    trap - ERR
    echo 'Приложение обновлено. Настройки подключения к 1С сохранены.'
    echo 'Проверьте https://ea-itus.ru/p/max-service/health и откройте приложение.'
    exit 0
  fi
  sleep 1
done
false

#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Запустите от root: sudo bash INSTALL_ON_SERVER.sh" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="/opt/itus-max"
ENV_FILE="/etc/itus-max.env"
SERVICE_FILE="/etc/systemd/system/itus-max.service"

command -v node >/dev/null || { echo "Требуется Node.js 20 или новее" >&2; exit 1; }
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
[[ "$NODE_MAJOR" -ge 20 ]] || { echo "Установлен Node.js $NODE_MAJOR, требуется 20+" >&2; exit 1; }
command -v nginx >/dev/null || { echo "Nginx не найден" >&2; exit 1; }

if ! id -u itus >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin itus
fi

install -d -o itus -g itus -m 0755 "$INSTALL_DIR"
install -o itus -g itus -m 0644 "$SOURCE_DIR/server.mjs" "$SOURCE_DIR/static-path.mjs" "$INSTALL_DIR/"
install -o itus -g itus -m 0644 "$SOURCE_DIR/package.json" "$INSTALL_DIR/package.json"
install -d -o itus -g itus -m 0755 "$INSTALL_DIR/dist" "$INSTALL_DIR/dist/assets" "$INSTALL_DIR/dist/config"
install -o itus -g itus -m 0644 "$SOURCE_DIR/dist/index.html" "$INSTALL_DIR/dist/index.html"
install -o itus -g itus -m 0644 "$SOURCE_DIR/dist/notification-sw.js" "$INSTALL_DIR/dist/notification-sw.js"
install -o itus -g itus -m 0644 "$SOURCE_DIR/dist/assets/"* "$INSTALL_DIR/dist/assets/"
install -o itus -g itus -m 0644 "$SOURCE_DIR/dist/config/itus.config.js" "$INSTALL_DIR/dist/config/itus.config.js"

if [[ ! -f "$ENV_FILE" ]]; then
  install -o root -g root -m 0600 "$SOURCE_DIR/deploy/itus-max.env.example" "$ENV_FILE"
  echo "Создан $ENV_FILE. Проверьте ONE_C_TARGET и при необходимости заполните секреты."
else
  echo "Существующий $ENV_FILE сохранён без изменений."
fi

install -o root -g root -m 0644 "$SOURCE_DIR/deploy/itus-max.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable --now itus-max
systemctl restart itus-max

echo
echo "Приложение установлено. Теперь добавьте deploy/ea-itus-location.conf"
echo "в HTTPS server-блок ea-itus.ru, затем выполните:"
echo "  nginx -t && systemctl reload nginx"
echo "После этого: bash deploy/CHECK_AFTER_UPLOAD.sh"

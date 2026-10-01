#!/usr/bin/env bash
set -euo pipefail
[[ "$EUID" -eq 0 ]] || { echo 'Запустите от root'; exit 1; }
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNIPPET=/etc/nginx/snippets/itus-max.conf
[[ -f "$SNIPPET" ]] || { echo 'Существующий snippets/itus-max.conf не найден. Пришлите вывод nginx -T для настройки маршрута.'; exit 1; }
grep -Fq '/etc/nginx/snippets/itus-max.conf' /etc/nginx/sites-available/itus.conf || { echo 'В itus.conf отсутствует подключение snippets/itus-max.conf. Нужна проверка маршрута.'; exit 1; }
BACKUP="$(mktemp /etc/nginx/itus-max-snippet-backup-XXXXXX)"
cp -a "$SNIPPET" "$BACKUP"
cp "$SOURCE_DIR/deploy/ea-itus-location.conf" "$SNIPPET"
if nginx -t && systemctl reload nginx; then
  echo "Маршрут обновлён. Копия: $BACKUP"
else
  cp -a "$BACKUP" "$SNIPPET"
  echo 'Возвращён предыдущий snippet. Пришлите ошибку проверки Nginx.' >&2
  exit 1
fi
if ! grep -Fq '/etc/nginx/snippets/itus-max.conf' /opt/itus/app/deploy/nginx/itus.conf; then
  echo 'Внимание: в шаблоне портала нет include /etc/nginx/snippets/itus-max.conf; обновление портала может убрать маршрут.'
fi

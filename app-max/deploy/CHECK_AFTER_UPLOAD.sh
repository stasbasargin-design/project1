#!/usr/bin/env bash
set -euo pipefail

PUBLIC_URL="${1:-https://ea-itus.ru/p/max-service}"
LOCAL_URL="${2:-http://127.0.0.1:8080}"
TEST_BODY='{"userId":"1","maxUserId":"1","authId":"1","authMode":"manual","source":"ITUS_MAX","checkOnly":true}'

echo "[1/4] Локальный сервер приложения"
curl --fail-with-body --silent --show-error "$LOCAL_URL/health"
echo

echo "[2/4] Интерфейс через домен"
curl --fail-with-body --silent --show-error --head "$PUBLIC_URL/"

echo "[3/4] API через локальный Node.js"
curl --silent --show-error --include --request POST \
  "$LOCAL_URL/api/1c/auth/max" \
  --header 'Content-Type: application/json' \
  --header 'X-ITUS-Request-Id: upload-check-local' \
  --data "$TEST_BODY"
echo

echo "[4/4] API через домен и Nginx"
curl --silent --show-error --include --request POST \
  "$PUBLIC_URL/api/1c/auth/max" \
  --header 'Content-Type: application/json' \
  --header 'X-ITUS-Request-Id: upload-check-domain' \
  --data "$TEST_BODY"
echo

echo "Проверка завершена. Ответ 1С может быть отказом для тестового userId=1,"
echo "но оба API-запроса должны попасть в журнал: journalctl -u itus-max -n 100"

# ИТУС — управление сервисом (2.0.1)

## Хостинг без командной строки
1. Распакуйте архив в корень сайта (index.html в корне).
2. При необходимости впишите токен в api/1c/config.php.
3. Готово: /api/1c/* проксирует api/1c/index.php (Apache + PHP curl).

## Node.js (альтернатива)
npm start; переменные: PORT, ONE_C_TARGET, ONE_C_TOKEN.

## Проверки
npm test; ITUS_USER_ID=… npm run check:api.

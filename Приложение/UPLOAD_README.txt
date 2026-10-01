ГОТОВЫЙ КОМПЛЕКТ ДЛЯ https://ea-itus.ru/p/max-service/

Что не менялось:
- интерфейс, вкладки, формы и кнопки;
- бизнес-логика приложения;
- JSON и названия методов 1С;
- файлы assets/app.js, CSS, изображения и config/itus.config.js.

Что исправлено только в серверной публикации:
- единый маршрут /p/max-service/api/1c/* через Nginx и Node.js;
- передача X-ITUS-Request-Id в 1С так же, как при локальном запуске;
- поддержка серверной Basic-аутентификации 1С через переменные окружения;
- предпочтение рабочего IPv4 при проблемной IPv6-записи DNS;
- журнал каждого запроса Node.js -> 1С и ответа 1С;
- готовая проверка локального и доменного маршрута.

ЗАГРУЗКА
1. Скопируйте архив на сервер и распакуйте его в отдельную папку.
2. В распакованной папке выполните:
   sudo bash INSTALL_ON_SERVER.sh
3. Проверьте /etc/itus-max.env. Адрес 1С уже указан:
   https://1c.eazia.ru/aa6_ea_test9/ru/hs/max-service
4. В HTTPS server-блок ea-itus.ru добавьте содержимое:
   deploy/ea-itus-location.conf
   Блок должен стоять до общих location /login, /auth и location /.
5. Выполните:
   sudo nginx -t && sudo systemctl reload nginx
6. Проверьте:
   sudo bash deploy/CHECK_AFTER_UPLOAD.sh

ЖУРНАЛ
sudo journalctl -u itus-max -n 100 --no-pager

В журнале должны появляться строки:
[ИТУС -> 1С] POST /auth/max ...
[1С -> ИТУС] <HTTP-статус> POST /auth/max ...

Если первая строка есть, но второй нет — сервер ea-itus.ru не может связаться с 1С.
Если обе строки есть — Nginx, Node.js и маршрут до 1С работают.

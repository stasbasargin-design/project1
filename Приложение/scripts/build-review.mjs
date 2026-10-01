import {readFileSync,writeFileSync} from 'node:fs';
const root=new URL('../',import.meta.url);
let html=readFileSync(new URL('index.html',root),'utf8');
html=html.replace('</body>','<script src="./assets/worktime-review-console.js"></script>\n</body>');
html=html.replace('<script src="./config/itus.config.js">','<script src="./assets/preview-fixtures.js"></script>\n  <script src="./config/itus.config.js">');
html=html.replace('<body>','<body><div class="review-banner">Проверочный режим · тестовые данные · записи в 1С нет. Роль: <a href="?role=master">МП</a> / <a href="?role=executor">Исполнитель</a> / <a href="?role=tech">Технолог</a></div>');
html=html.replace('Связь с 1С ещё не проверена','Тестовый источник данных');
html=html.replace('ИТУС · данные, анкеты, документы и сообщения синхронизируются с 1С Альфа-Авто 6.1.','ИТУС · проверочные данные в памяти браузера; соединения с 1С нет.');
writeFileSync(new URL('dist/preview.html',root),html);
// A portable review file: no install and no connection to the service required.
let portable=html.replace(/<link rel="stylesheet" href="\.\/(.*?)">/g,(_,path)=>'<style>'+readFileSync(new URL(path,root),'utf8')+'</style>');
portable=portable.replace(/<script src="\.\/(.*?)"><\/script>/g,(_,path)=>'<script>'+readFileSync(new URL(path,root),'utf8').replaceAll('</script','<\\/script')+'</script>');
portable=portable.replaceAll('./assets/itus-logo.png','data:image/png;base64,'+readFileSync(new URL('assets/itus-logo.png',root)).toString('base64'));
writeFileSync(new URL('OPEN_REVIEW.html',root),portable);

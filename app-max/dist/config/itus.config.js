/*
  ИТУС — конфигурация локального подключения к тестовой базе 1С.

  При запуске через `npm run dev` приложение обращается к `/api/1c`,
  а Vite автоматически перенаправляет запросы на:
  https://1c.eazia.ru/aa6_ea_test9/ru/hs/max-service/

  ID ботов MAX заполните ниже. Токены ботов и webhook secret должны
  храниться только в 1С.
*/
const runtimeApiBase = (() => {
  if (typeof window === 'undefined') return '/api/1c';
  const explicit = window.__ITUS_API_BASE__ || window.ITUS_API_BASE_URL || '';
  if (explicit) return explicit.replace(/\/$/, '');
  const nativeAndroid = window.Capacitor?.isNativePlatform?.()
    || window.Capacitor?.getPlatform?.() === 'android'
    || (Boolean(window.Capacitor) && window.location.hostname === 'localhost');
  if (window.location.protocol === 'file:' || nativeAndroid) {
    // Capacitor Android uses capacitor://localhost (or https://localhost),
    // not the public site origin. A relative /api/1c URL would therefore
    // target the local WebView server and never reach 1C.
    return 'https://ea-itus.ru/p/max-service/api/1c';
  }
  const baseUrl = new URL(document.baseURI);
  const normalizedPath = baseUrl.pathname.endsWith('/') ? baseUrl.pathname : `${baseUrl.pathname}/`;
  return new URL('./api/1c', `${baseUrl.origin}${normalizedPath}`).pathname.replace(/\/$/, '');
})();

window.ITUS_CONFIG = {
  // Единый адрес для локального и production-запуска.
  // Vite (npm run dev) и server.mjs (npm start) проксируют его в 1С.
  // Для Android APK используйте HTTPS-домен, а не file:// или localhost.
  ONE_C_API_BASE_URL: runtimeApiBase,

  // Фактический адрес опубликованного HTTP-сервиса 1С — для отображения и диагностики.
  ONE_C_PUBLIC_BASE_URL: "https://1c.eazia.ru/aa6_ea_test9/ru/hs/max-service",

  MAX_SERVICE_BOT_ID: "PASTE_MAX_SERVICE_BOT_ID",
  MAX_CLIENT_BOT_ID: "PASTE_MAX_CLIENT_BOT_ID",
  MAX_MINI_APP_ID: "PASTE_MAX_MINI_APP_ID",

  // В браузерной конфигурации оставлять пустым. Сервер добавляет секрет из ONE_C_TOKEN.
  ONE_C_TOKEN: "",
  REQUEST_TIMEOUT_MS: 35000,

  // Проверка уведомлений о назначении исполнителя и запросе выходного контроля.
  // Лёгкий опрос счётчиков и событий. История чатов и вложения здесь не запрашиваются.
  // Notifications are polled once per minute; the first poll runs immediately after sign-in.
  POLL_INTERVAL_MS: 60000,

  // Public VAPID key for Web Push. Leave empty until it is generated and set
  // by the deployment configuration; a private key must never be placed here.
  WEB_PUSH_VAPID_PUBLIC_KEY: "",

  // Подготовленные файлы больше 10 МиБ идут через приватный S3-буфер;
  // прежнего фиксированного лимита 15/20 МиБ для новых отправок нет.
  MAX_PHOTO_UPLOAD_BYTES: 0,
  MAX_VIDEO_UPLOAD_BYTES: 0,
  MAX_DOCUMENT_UPLOAD_BYTES: 0,
  // Compatibility for older clients; new code uses the type-specific values above.
  MAX_UPLOAD_BYTES: 15728640,

  // Пока 1С возвращает только ["orders"], приложение сохраняет все рабочие
  // вкладки. Включите true после настройки ролевой модели в 1С.
  ENFORCE_SERVER_TABS: true,

  // /ping в текущей публикации 1С отсутствует. Проверка связи автоматически
  // использует /auth/max как резервный метод.
  PING_FALLBACK_TO_AUTH: true
};

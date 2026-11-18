/*
 * Единственная точка настройки подключения к 1С.
 * Для тестового запуска оставьте mode: 'demo'.
 * Для рабочего контура установите mode: 'http' и endpoint опубликованного HTTP-сервиса 1С.
 * Секреты и пароль пользователя в этот файл не помещаются: используйте same-origin,
 * веб-сервер/прокси или защищённую серверную сессию.
 */
window.ALFA_AUTO_CONFIG = Object.freeze({
  schemaVersion: '1.0',
  applicationId: 'alfa-auto-service-workplace',
  applicationVersion: '13.1.0',
  mode: 'demo',
  endpoint: '/hs/alfa_auto_web/v1/exchange',
  credentials: 'same-origin',
  authToken: '',
  timeoutMs: 15000,
  retryCount: 2,
  retryDelayMs: 900,
  autosaveDelayMs: 700,
  pollIntervalMs: 15000,
  maxOutboxItems: 100,
  sendFullSnapshot: true,
  locale: 'ru-RU'
});

import './assets/worktime.js';
import { resolvePublicPath } from './static-path.mjs';
import http from 'node:http';
import dns from 'node:dns';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFragment } from 'parse5';

const root = fileURLToPath(new URL('.', import.meta.url));
const distRoot = resolve(root, 'dist');
const staticRoot = existsSync(join(distRoot, 'config', 'itus.config.js')) ? distRoot : root;
const port = Number(process.env.PORT || 8080);
const configuredBasePath = process.env.APP_BASE_PATH && String(process.env.APP_BASE_PATH).trim();
const normalizedConfiguredBasePath = configuredBasePath ? '/' + configuredBasePath.replace(/^\/+|\/+$/g, '') : null;

function detectBasePath(host = '', pathname = '/') {
  if (normalizedConfiguredBasePath) return normalizedConfiguredBasePath;
  const hostHeader = String(host || '').toLowerCase();
  const previewHost = hostHeader.includes('app.github.dev')
    || hostHeader.includes('github.dev')
    || hostHeader.includes('githubpreview.dev')
    || hostHeader.includes('localhost')
    || hostHeader.includes('127.0.0.1')
    || hostHeader.includes('0.0.0.0');
  if (previewHost) return '/';
  // A subpath deployment is identifiable from the incoming URL. Otherwise
  // serve the application at the domain root; APP_BASE_PATH can override it.
  return String(pathname || '/').startsWith('/p/max-service') ? '/p/max-service' : '/';
}

const oneCTarget = String(
  process.env.ONE_C_TARGET || 'https://1c.eazia.ru/aa6_ea_test9/ru/hs/max-service'
).replace(/\/+$/, '');
const oneCToken = String(process.env.ONE_C_TOKEN || '').trim();
const proxyTimeoutMs = Number(process.env.PROXY_TIMEOUT_MS || 35000);
const maxRequestBytes = Number(process.env.MAX_REQUEST_BYTES || 30 * 1024 * 1024);
const logProxyRequests = String(process.env.LOG_PROXY_REQUESTS || 'true').toLowerCase() !== 'false';
const oneCBasicUser = String(process.env.ONE_C_BASIC_USER || '').trim();
const oneCBasicPassword = String(process.env.ONE_C_BASIC_PASSWORD || '');
const pushInternalToken = String(process.env.PUSH_INTERNAL_TOKEN || '').trim();
const capacitorOrigins = new Set(['https://localhost', 'capacitor://localhost']);

// Some VPS resolvers publish an unreachable IPv6 address before the working IPv4
// address. Prefer IPv4 without disabling IPv6 for installations where it works.
dns.setDefaultResultOrder('ipv4first');

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.webp': 'image/webp'
};

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload)
  });
  res.end(payload);
}

function allowCapacitorApiOrigin(req, res) {
  const origin = String(req.headers.origin || '').replace(/\/+$/, '');
  if (!capacitorOrigins.has(origin)) return;
  // Capacitor Android serves the bundle from localhost. Its requests to the
  // public HTTPS API are cross-origin and therefore require an explicit,
  // narrow CORS response; do not reflect arbitrary browser origins.
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-ITUS-Request-Id, X-ITUS-Token');
  res.setHeader('Vary', 'Origin');
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxRequestBytes) throw new Error(`Тело запроса превышает лимит ${Math.round(maxRequestBytes / 1024 / 1024)} МБ`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function requestBearer(req) {
  const value = String(req.headers.authorization || '');
  return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
}

function internalPushAuthorized(req) {
  const supplied = requestBearer(req);
  if (!pushInternalToken || !supplied) return false;
  const expected = Buffer.from(pushInternalToken);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function asText(value, maxLength = 512) { return String(value ?? '').trim().slice(0, maxLength); }

// The runtime deployment script copies server.mjs directly. Keep this small
// formatter here so an update can never start with a missing local module.
const FCM_SAFE_PAYLOAD_BYTES = 3800;
function truncateUtf8(value, maxBytes) {
  const source = String(value ?? '').trim();
  if (maxBytes <= 0 || !source) return '';
  let result = '', used = 0;
  for (const character of source) {
    const size = Buffer.byteLength(character, 'utf8');
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}
function addNotificationLine(output) { if (output.length && output[output.length - 1] !== '\n') output.push('\n'); }
function readableNotificationText(value, maxBytes = 2500) {
  const fragment = parseFragment(String(value ?? ''));
  const output = [];
  const blockTags = new Set(['address', 'article', 'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'p', 'section', 'tr']);
  const ignoredTags = new Set(['script', 'style', 'template', 'noscript']);
  const visit = node => {
    if (node.nodeName === '#text') { output.push(node.value || ''); return; }
    const tag = String(node.tagName || '').toLowerCase();
    if (ignoredTags.has(tag)) return;
    if (tag === 'br') { addNotificationLine(output); return; }
    if (blockTags.has(tag)) addNotificationLine(output);
    if (tag === 'li') output.push('• ');
    for (const child of node.childNodes || []) visit(child);
    if (blockTags.has(tag)) addNotificationLine(output);
  };
  for (const node of fragment.childNodes || []) visit(node);
  return truncateUtf8(output.join('').replace(/[\t \f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n'), maxBytes);
}
function normalizePushData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && item != null)
    .slice(0, 20)
    .map(([key, item]) => [key, truncateUtf8(item, 256)]));
}
function fitPushPayload({ title, body, data }) {
  const safeData = normalizePushData(data);
  let safeTitle = readableNotificationText(title || 'I-MAX', 256) || 'I-MAX';
  let safeBody = readableNotificationText(body, 2500);
  const size = () => Buffer.byteLength(JSON.stringify({ notification: { title: safeTitle, body: safeBody }, data: safeData }), 'utf8');
  const required = new Set(['type', 'eventId', 'topicRef', 'topicId', 'orderRef', 'orderId']);
  for (const key of Object.keys(safeData).filter(key => !required.has(key))) {
    if (size() <= FCM_SAFE_PAYLOAD_BYTES) break;
    delete safeData[key];
  }
  if (size() > FCM_SAFE_PAYLOAD_BYTES) safeBody = truncateUtf8(safeBody, Math.max(0, Buffer.byteLength(safeBody, 'utf8') - (size() - FCM_SAFE_PAYLOAD_BYTES)));
  if (size() > FCM_SAFE_PAYLOAD_BYTES) safeTitle = truncateUtf8(safeTitle, Math.max(1, Buffer.byteLength(safeTitle, 'utf8') - (size() - FCM_SAFE_PAYLOAD_BYTES))) || 'I-MAX';
  return { title: safeTitle, body: safeBody, data: safeData };
}

async function firebaseMessaging() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw Object.assign(new Error('Firebase service account is not configured'), { code: 'FIREBASE_NOT_CONFIGURED' });
  }
  const [{ applicationDefault, getApps, initializeApp }, { getMessaging }] = await Promise.all([
    import('firebase-admin/app'), import('firebase-admin/messaging')
  ]);
  const app = getApps()[0] || initializeApp({ credential: applicationDefault() });
  return getMessaging(app);
}

async function sendInternalPush(req, res, testOnly = false) {
  if (req.method !== 'POST') {
    json(res, 405, { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST' } });
    return;
  }
  if (!internalPushAuthorized(req)) {
    json(res, 401, { success: false, error: { code: 'UNAUTHORIZED', message: 'Internal push authorization is required' } });
    return;
  }
  let payload;
  try { payload = JSON.parse((await readBody(req)).toString('utf8')); }
  catch { json(res, 400, { success: false, error: { code: 'BAD_JSON', message: 'Invalid JSON' } }); return; }
  const tokens = [...new Set((Array.isArray(payload.tokens) ? payload.tokens : [payload.token])
    .map(value => asText(value, 4096)).filter(Boolean))].slice(0, 500);
  const { title, body, data } = fitPushPayload({
    title: payload.title || 'I-MAX',
    body: payload.body || (testOnly ? 'Тестовое уведомление I-MAX' : ''),
    data: { ...(payload.data || {}), ...(testOnly ? { type: 'push_test' } : {}) }
  });
  if (!tokens.length || !body) {
    json(res, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: 'tokens and body are required' } });
    return;
  }
  try {
    const result = await (await firebaseMessaging()).sendEachForMulticast({
      tokens,
      notification: { title, body },
      data,
      android: { priority: 'high', notification: { channelId: 'i-max-events', icon: 'ic_stat_imax', color: '#1565C0', sound: 'default' } }
    });
    const invalidTokenIndexes = [];
    result.responses.forEach((item, index) => {
      const code = item.error?.code || '';
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') invalidTokenIndexes.push(index);
    });
    // Do not log device tokens or request payloads. 1C owns the registry and
    // removes invalid tokens using only these response indexes/counts.
    console.log(`[push] ${testOnly ? 'test' : 'event'} sent=${result.successCount} failed=${result.failureCount}`);
    json(res, 200, { success: true, data: { sent: result.successCount, failed: result.failureCount, invalidTokenIndexes } });
  } catch (error) {
    const status = error?.code === 'FIREBASE_NOT_CONFIGURED' ? 503 : 502;
    console.error(`[push] delivery failed code=${asText(error?.code || 'FIREBASE_ERROR', 80)}`);
    json(res, status, { success: false, error: { code: error?.code || 'FIREBASE_ERROR', message: 'Push delivery failed' } });
  }
}

async function proxy1C(req, res, pathname) {
  allowCapacitorApiOrigin(req, res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'POST, OPTIONS' });
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    json(res, 405, { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Используйте POST' } });
    return;
  }

  const suffix = pathname.slice('/api/1c'.length);
  if (!suffix || !suffix.startsWith('/')) {
    json(res, 400, { success: false, error: { code: 'BAD_API_PATH', message: 'Не указан метод 1С' } });
    return;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), proxyTimeoutMs);
  const startedAt = Date.now();
  const requestId = String(req.headers['x-itus-request-id'] || '').trim();
  try {
    const body = await readBody(req);
    try {
      if (Object.values(globalThis.ITUS_WORKTIME.methods).includes(suffix)) {
        globalThis.ITUS_WORKTIME.validateRequest(suffix, JSON.parse(body.toString('utf8')));
      }
    } catch (error) {
      json(res, 400, { success: false, error: { code: 'VALIDATION_ERROR', message: error.message } });
      return;
    }
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Accept': req.headers.accept || 'application/json'
    };
    // Keep the same integration contract in local Vite and on the production
    // domain. These headers are generated by the existing client application.
    // The published 1C HTTP service treats header names as case-sensitive and
    // expects this exact lower-case spelling.
    if (requestId) headers['x-itus-request-id'] = requestId;
    const requestToken = req.headers['x-itus-token'];
    if (oneCToken || requestToken) headers['X-ITUS-Token'] = oneCToken || requestToken;
    if (oneCBasicUser) {
      headers.Authorization = `Basic ${Buffer.from(`${oneCBasicUser}:${oneCBasicPassword}`).toString('base64')}`;
    }

    if (logProxyRequests) {
      console.log(`[ИТУС -> 1С] POST ${suffix}${requestId ? ` requestId=${requestId}` : ''}`);
    }

    const upstream = await fetch(oneCTarget + suffix, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    if (logProxyRequests) {
      console.log(`[1С -> ИТУС] ${upstream.status} POST ${suffix} ${Date.now() - startedAt}ms${requestId ? ` requestId=${requestId}` : ''}`);
    }
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(responseBody);
  } catch (error) {
    const timeout = error?.name === 'AbortError';
    console.error(`[Ошибка proxy 1С] POST ${suffix} ${Date.now() - startedAt}ms: ${String(error?.message || error)}${requestId ? ` requestId=${requestId}` : ''}`);
    json(res, timeout ? 504 : 502, {
      success: false,
      error: {
        code: timeout ? 'ONE_C_TIMEOUT' : 'ONE_C_PROXY_ERROR',
        message: timeout ? 'Истекло время ожидания ответа 1С' : String(error?.message || error)
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function serveStatic(req, res, pathname) {
  const filePath = resolvePublicPath(staticRoot, pathname);
  if (!filePath) {
    json(res, 403, { success: false, error: { code: 'FORBIDDEN', message: 'Недопустимый путь' } });
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    json(res, 404, { success: false, error: { code: 'NOT_FOUND', message: 'Файл не найден' } });
    return;
  }
  const type = mime[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self)'
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const basePath = detectBasePath(req.headers.host, url.pathname);
  if (basePath !== '/' && url.pathname === basePath) {
    res.writeHead(308, { Location: basePath + '/' + url.search });
    res.end(); return;
  }
  const pathname = basePath !== '/' && url.pathname.startsWith(basePath + '/')
    ? url.pathname.slice(basePath.length) : url.pathname;
  if (pathname === '/health') {
    json(res, 200, { success: true, service: 'ITUS', oneCTargetConfigured: Boolean(oneCTarget) });
    return;
  }
  // These routes are for trusted server-to-server calls from 1C only. They
  // never accept an end-user browser session and are disabled until both the
  // Firebase credentials and PUSH_INTERNAL_TOKEN are configured.
  if (pathname === '/api/push/test') {
    await sendInternalPush(req, res, true);
    return;
  }
  if (pathname === '/api/push/dispatch') {
    await sendInternalPush(req, res, false);
    return;
  }
  if (pathname.startsWith('/api/1c/')) {
    await proxy1C(req, res, pathname);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Метод не поддерживается' } });
    return;
  }
  try { serveStatic(req, res, pathname); }
  catch { json(res, 400, {success: false, error: {code: 'BAD_PATH', message: 'Некорректный путь'}}); }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`ИТУС запущен: http://localhost:${port}`);
  console.log(`Прокси 1С: /api/1c/* -> ${oneCTarget}/*`);
  console.log(`Публичный путь: ${normalizedConfiguredBasePath || 'автоопределение'}`);
});

import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const distRoot = resolve(root, 'dist');
const staticRoot = existsSync(join(distRoot, 'config', 'itus.config.js')) ? distRoot : root;
const port = Number(process.env.PORT || 8080);
const oneCTarget = String(
  process.env.ONE_C_TARGET || 'https://1c.eazia.ru/aa6_ea_test9/ru/hs/max-service'
).replace(/\/+$/, '');
const oneCToken = String(process.env.ONE_C_TOKEN || '').trim();
const proxyTimeoutMs = Number(process.env.PROXY_TIMEOUT_MS || 35000);
const maxRequestBytes = Number(process.env.MAX_REQUEST_BYTES || 30 * 1024 * 1024);

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

async function proxy1C(req, res, pathname) {
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
  try {
    const body = await readBody(req);
    const headers = { 'Content-Type': req.headers['content-type'] || 'application/json' };
    const requestToken = req.headers['x-itus-token'];
    if (oneCToken || requestToken) headers['X-ITUS-Token'] = oneCToken || requestToken;

    const upstream = await fetch(oneCTarget + suffix, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal
    });
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, {
      'Content-Type': upstream.headers.get('content-type') || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(responseBody);
  } catch (error) {
    const timeout = error?.name === 'AbortError';
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
  const requested = pathname === '/' ? '/index.html' : pathname;
  const cleanPath = normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, '');
  let filePath = resolve(staticRoot, '.' + cleanPath);
  if (!filePath.startsWith(staticRoot)) {
    json(res, 403, { success: false, error: { code: 'FORBIDDEN', message: 'Недопустимый путь' } });
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) filePath = join(staticRoot, 'index.html');
  const type = mime[extname(filePath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': filePath.endsWith('index.html') || filePath.endsWith('itus.config.js')
      ? 'no-cache'
      : 'public, max-age=86400',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(self), microphone=(self)'
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/health') {
    json(res, 200, { success: true, service: 'ITUS', oneCTargetConfigured: Boolean(oneCTarget) });
    return;
  }
  if (url.pathname.startsWith('/api/1c/')) {
    await proxy1C(req, res, url.pathname);
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    json(res, 405, { success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Метод не поддерживается' } });
    return;
  }
  serveStatic(req, res, url.pathname);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`ИТУС запущен: http://localhost:${port}`);
  console.log(`Прокси 1С: /api/1c/* -> ${oneCTarget}/*`);
});

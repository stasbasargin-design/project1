import { resolvePublicPath } from './static-path.mjs';
import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const distRoot = resolve(root, 'dist');
const staticRoot = existsSync(join(distRoot, 'config', 'itus.config.js')) ? distRoot : root;
const port = Number(process.env.PORT || 8080);
const configuredBasePath = process.env.APP_BASE_PATH && String(process.env.APP_BASE_PATH).trim();
const normalizedConfiguredBasePath = configuredBasePath ? '/' + configuredBasePath.replace(/^\/+|\/+$/g, '') : null;

function detectBasePath(host = '') {
  if (normalizedConfiguredBasePath) return normalizedConfiguredBasePath;
  const hostHeader = String(host || '').toLowerCase();
  const previewHost = hostHeader.includes('app.github.dev')
    || hostHeader.includes('github.dev')
    || hostHeader.includes('githubpreview.dev')
    || hostHeader.includes('localhost')
    || hostHeader.includes('127.0.0.1')
    || hostHeader.includes('0.0.0.0');
  return previewHost ? '/' : '/p/max-service';
}

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
  const basePath = detectBasePath(req.headers.host);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
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
});

import path from 'node:path';

// Use the target platform's path rules, not a hard-coded '/' filesystem separator.
export function resolvePublicPath(root, pathname, paths = path) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (!decoded.startsWith('/') || /[\\\u0000:]/.test(decoded)) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) return null;
  if (parts.length === 0) parts.push('index.html');
  if (/^(?:data|server\.mjs|static-path\.mjs)$/i.test(parts[0])) return null;
  const file = paths.resolve(root, ...parts);
  const relative = paths.relative(paths.resolve(root), file);
  if (paths.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + paths.sep)) return null;
  return file;
}

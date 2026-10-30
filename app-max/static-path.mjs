import path from 'node:path';

// Use the target platform's path rules, not a hard-coded '/' filesystem separator.
export function resolvePublicPath(root, pathname, paths = path) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (!decoded.startsWith('/') || /[\\\u0000:]/.test(decoded)) return null;
  const parts = decoded.split('/').filter(Boolean);
  if (parts.some(part => part === '.' || part === '..')) return null;
  if (parts.length === 0) parts.push('index.html');
  if(parts.some(part=>part.startsWith('.')))return null;
  if(!['assets','config'].includes(parts[0])&&!['index.html','preview.html','OPEN_REVIEW.html','manifest.webmanifest','notification-sw.js','build-info.json','favicon.ico'].includes(parts[0]))return null;
  const file = paths.resolve(root, ...parts);
  const relative = paths.relative(paths.resolve(root), file);
  if (paths.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + paths.sep)) return null;
  return file;
}

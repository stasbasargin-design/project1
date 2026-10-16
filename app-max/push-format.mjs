import { parseFragment } from 'parse5';

export const FCM_SAFE_PAYLOAD_BYTES = 3800;

export function truncateUtf8(value, maxBytes) {
  const source = String(value ?? '').trim();
  if (maxBytes <= 0 || !source) return '';
  let result = '';
  let used = 0;
  for (const character of source) {
    const size = Buffer.byteLength(character, 'utf8');
    if (used + size > maxBytes) break;
    result += character;
    used += size;
  }
  return result;
}

function addLine(output) {
  if (output.length && output[output.length - 1] !== '\n') output.push('\n');
}

export function readableNotificationText(value, maxBytes = 2500) {
  const fragment = parseFragment(String(value ?? ''));
  const output = [];
  const blockTags = new Set(['address', 'article', 'blockquote', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'p', 'section', 'tr']);
  const ignoredTags = new Set(['script', 'style', 'template', 'noscript']);
  const visit = node => {
    if (node.nodeName === '#text') {
      output.push(node.value || '');
      return;
    }
    const tag = String(node.tagName || '').toLowerCase();
    if (ignoredTags.has(tag)) return;
    if (tag === 'br') { addLine(output); return; }
    if (blockTags.has(tag)) addLine(output);
    if (tag === 'li') output.push('• ');
    for (const child of node.childNodes || []) visit(child);
    if (blockTags.has(tag)) addLine(output);
  };
  for (const node of fragment.childNodes || []) visit(node);
  return truncateUtf8(output.join('').replace(/[\t \f\v]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n'), maxBytes);
}

export function normalizePushData(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, item]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) && item != null)
    .slice(0, 20)
    .map(([key, item]) => [key, truncateUtf8(item, 256)]));
}

export function fitPushPayload({ title, body, data }) {
  const safeData = normalizePushData(data);
  let safeTitle = readableNotificationText(title || 'I-MAX', 256) || 'I-MAX';
  let safeBody = readableNotificationText(body, 2500);
  const size = () => Buffer.byteLength(JSON.stringify({ notification: { title: safeTitle, body: safeBody }, data: safeData }), 'utf8');
  const required = new Set(['type', 'eventId', 'topicRef', 'topicId', 'orderRef', 'orderId']);
  for (const key of Object.keys(safeData).filter(key => !required.has(key))) {
    if (size() <= FCM_SAFE_PAYLOAD_BYTES) break;
    delete safeData[key];
  }
  if (size() > FCM_SAFE_PAYLOAD_BYTES) {
    const excess = size() - FCM_SAFE_PAYLOAD_BYTES;
    safeBody = truncateUtf8(safeBody, Math.max(0, Buffer.byteLength(safeBody, 'utf8') - excess));
  }
  if (size() > FCM_SAFE_PAYLOAD_BYTES) {
    const excess = size() - FCM_SAFE_PAYLOAD_BYTES;
    safeTitle = truncateUtf8(safeTitle, Math.max(1, Buffer.byteLength(safeTitle, 'utf8') - excess)) || 'I-MAX';
  }
  return { title: safeTitle, body: safeBody, data: safeData };
}

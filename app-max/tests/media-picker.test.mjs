import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let input;
let lastSheet = '';
let lastTitle = '';
const makeElement = tag => ({
  tagName: tag, dataset: {}, files: [], value: '', attributes: {},
  addEventListener(type, listener) { this.listeners ||= {}; this.listeners[type] = listener; },
  setAttribute(name, value) { this.attributes[name] = value; },
  removeAttribute(name) { delete this.attributes[name]; },
  click() { this.clicked = true; }
});
const document = {
  createElement(tag) { const element = makeElement(tag); if (tag === 'input') input = element; return element; },
  body: { append(element) { this.last = element; } }
};
const context = { window: {}, document, URL: { createObjectURL: file => `blob:${file.name}`, revokeObjectURL() {} } };
context.window = context;
vm.runInNewContext(fs.readFileSync(new URL('../assets/media-picker.js', import.meta.url), 'utf8'), context);

const sent = [];
const picker = context.ITUS_MEDIA_PICKER.create({
  showSheet(title, _hint, html) { lastTitle = title; lastSheet = html; },
  closeSheet() {}, toast() {}, maxBytes: 1024
});
picker.open({ hint: 'test', onSend: async (file, kind) => sent.push([file.name, kind]) });

assert.equal(lastTitle, 'Фото и видео');
assert.match(lastSheet, /Галерея/);
picker.handle('media-gallery');
assert.equal(input.multiple, true, 'gallery must support multiple files');
assert.equal(input.accept, 'image/*,video/*');
input.files = [
  { name: 'photo.jpg', type: 'image/jpeg', size: 100, lastModified: 1 },
  { name: 'video.mp4', type: 'video/mp4', size: 200, lastModified: 2 }
];
input.listeners.change();
assert.match(lastSheet, /Выбрано: 2/);

picker.handle('media-remove', { dataset: { index: '0' } });
assert.match(lastSheet, /Выбрано: 1/);
picker.handle('media-send');
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(sent, [['video.mp4', 'video']]);

const attempts = [];
let failOnce = true;
picker.open({ hint: 'retry', onSend: async (file, _kind, uploadId) => {
  attempts.push([file.name, uploadId]);
  if (file.name === 'broken.jpg' && failOnce) { failOnce = false; throw new Error('temporary failure'); }
} });
input.files = [
  { name: 'first.jpg', type: 'image/jpeg', size: 100, lastModified: 3 },
  { name: 'broken.jpg', type: 'image/jpeg', size: 100, lastModified: 4 },
  { name: 'last.mp4', type: 'video/mp4', size: 100, lastModified: 5 }
];
input.listeners.change();
picker.handle('media-send');
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(attempts.map(item => item[0]), ['first.jpg', 'broken.jpg', 'last.mp4'], 'a failed file must not stop the queue');
assert.match(lastSheet, /ошибки: 1/);
picker.handle('media-send');
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(attempts.map(item => item[0]), ['first.jpg', 'broken.jpg', 'last.mp4', 'broken.jpg'], 'only the failed file is retried');
assert.equal(attempts[1][1], attempts[3][1], 'retry keeps the idempotency key');

console.log('media picker tests passed');

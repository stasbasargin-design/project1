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
  closeSheet() {}, toast() {}, limits: { photo: 1024, video: 2048 }
});
picker.open({ hint: 'test', onSend: async (file, kind) => sent.push([file.name, kind]) });

assert.equal(lastTitle, 'Фото и видео');
assert.match(lastSheet, /Галерея/);
picker.handle('media-gallery');
assert.equal(input.multiple, true, 'gallery must support multiple files');
assert.equal(input.accept, 'image/*,video/*');
picker.handle('media-camera-photo');
assert.equal(input.accept, 'image/*');
assert.equal(input.attributes.capture, 'environment');
assert.equal(input.multiple, false);
picker.handle('media-camera-video');
assert.equal(input.accept, 'video/*');
assert.equal(input.attributes.capture, 'environment');
assert.equal(input.multiple, false);
picker.handle('media-gallery');
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

let releaseCommit;
let closeCount = 0;
let committed = [];
const batchPicker = context.ITUS_MEDIA_PICKER.create({
  showSheet(title, _hint, html) { lastTitle = title; lastSheet = html; },
  closeSheet() { closeCount++; }, toast() {}, limits: { photo: 1024, video: 2048 }
});
batchPicker.open({hint:'queue', onCommit: async files => {
  committed = files.map(item => [item.file.name, item.uploadId]);
  await new Promise(resolve => { releaseCommit = resolve; });
}});
input.files = [
  {name:'one.jpg',type:'image/jpeg',size:100,lastModified:11},
  {name:'two.jpg',type:'image/jpeg',size:100,lastModified:12},
  {name:'three.jpg',type:'image/jpeg',size:100,lastModified:13}
];
input.listeners.change();
batchPicker.handle('media-send');
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(batchPicker.dismiss(), false, 'manual close is blocked until the complete batch is locally committed');
assert.match(lastSheet, /spinner/, 'local queue save has a visible in-progress state');
assert.deepEqual(Array.from(committed, item => item[0]), ['one.jpg','two.jpg','three.jpg']);
assert.equal(new Set(committed.map(item => item[1])).size, 3);
releaseCommit();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(closeCount, 1, 'picker closes automatically after local commit, without waiting for transport');

let limitMessage = '';
const limitPicker = context.ITUS_MEDIA_PICKER.create({
  showSheet(_title, _hint, html) { lastSheet = html; },
  closeSheet() {}, toast(message) { limitMessage = message; }, limits: { photo: 100, video: 200 }
});
limitPicker.open({hint:'limits', onSend:async()=>{}});
input.files = [
  {name:'photo-ok.jpg',type:'image/jpeg',size:100,lastModified:21},
  {name:'video-ok.mp4',type:'video/mp4',size:200,lastModified:22},
  {name:'video-too-large.mp4',type:'video/mp4',size:201,lastModified:23}
];
input.listeners.change();
assert.match(lastSheet, /Выбрано: 2/);
assert.match(limitMessage, /video-too-large\.mp4: 0\.0 МБ, предел 0 МБ/);

let unrestrictedMessage = '';
const unrestrictedVideoPicker = context.ITUS_MEDIA_PICKER.create({
  showSheet(_title, _hint, html) { lastSheet = html; },
  closeSheet() {}, toast(message) { unrestrictedMessage = message; }, limits: { photo: 100, video: 0 }
});
unrestrictedVideoPicker.open({hint:'unrestricted video', onSend:async()=>{}});
input.files = [{name:'long-video.mp4',type:'video/mp4',size:200 * 1024 * 1024,lastModified:24}];
input.listeners.change();
assert.match(lastSheet, /Выбрано: 1/, 'a zero video limit must disable the client-side size rejection');
assert.equal(unrestrictedMessage, '', 'unrestricted video selection must not show a size-limit error');

let releaseSlowSend;
const slowPicker = context.ITUS_MEDIA_PICKER.create({
  showSheet(_title, _hint, html) { lastSheet = html; },
  closeSheet() {}, toast() {}, limits: { photo: 1024, video: 2048 }
});
slowPicker.open({hint:'slow network', onSend: async () => new Promise(resolve => { releaseSlowSend = resolve; })});
input.files = [{name:'slow.mp4',type:'video/mp4',size:200,lastModified:31}];
input.listeners.change();
slowPicker.handle('media-send');
await new Promise(resolve => setTimeout(resolve, 0));
assert.match(lastSheet, /Отправка 1\/1/, 'slow transfer keeps visible progress');
assert.equal(slowPicker.dismiss(), false, 'slow transfer keeps the editor and selected file');
releaseSlowSend();
await new Promise(resolve => setTimeout(resolve, 0));

console.log('media picker tests passed');

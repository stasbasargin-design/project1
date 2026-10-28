import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let stopped = 0;
let result = '';
const track = { stop() { stopped++; } };
const stream = { getTracks() { return [track]; } };
const video = { readyState: 2, videoWidth: 100, videoHeight: 100, play: async () => {} };
const context = {
  window: {},
  navigator: { mediaDevices: { getUserMedia: async constraints => {
    assert.equal(constraints.video.facingMode.ideal, 'environment');
    return stream;
  } } },
  document: { createElement() { throw new Error('canvas fallback must not be used when BarcodeDetector is available'); } },
  requestAnimationFrame(callback) { return setTimeout(callback, 0); },
  cancelAnimationFrame(handle) { clearTimeout(handle); },
  BarcodeDetector: class { async detect() { return [{ rawValue: '00A7Z' }]; } },
  setTimeout,
  clearTimeout
};
context.window = context;
vm.runInNewContext(fs.readFileSync(new URL('../assets/order-qr.js', import.meta.url), 'utf8'), context);

const qr = context.ITUS_ORDER_QR;
assert.equal(qr.normalize(' \n00123\r '), '00123', 'outer whitespace is removed and leading zeroes are preserved');
assert.equal(qr.normalize('00A7Z'), '00A7Z', 'letters are allowed');
assert.throws(() => qr.normalize('1234'), /ровно 5/);
assert.throws(() => qr.normalize('123456'), /ровно 5/);
assert.equal(qr.exactSuffix('ЗН-2026-00A7Z', '00A7Z'), true);
assert.equal(qr.exactSuffix('ЗН-00A7Z-1', '00A7Z'), false);
const available = [
  {id:'one',num:'ЗН-2026-00A7Z'},
  {id:'two',num:'ЗН-2025-00A7Z'},
  {id:'other',num:'ЗН-2026-12345'}
];
assert.equal(qr.filterMatches(available, 'ABCDE').length, 0, 'zero-result QR is preserved');
assert.deepEqual(Array.from(qr.filterMatches(available, '12345'), item => item.id), ['other'], 'one exact suffix is selected');
assert.deepEqual(Array.from(qr.filterMatches(available, '00A7Z'), item => item.id), ['one','two'], 'multiple exact suffixes remain available for user choice');

const scanner = qr.createScanner({ onResult(value) { result = value; }, onFailure(error) { throw error; } });
await scanner.start(video);
await new Promise(resolve => setTimeout(resolve, 20));
assert.equal(result, '00A7Z');
assert.equal(stopped, 1, 'camera track is released immediately after recognition');
scanner.stop();
assert.equal(stopped, 1, 'closing an already stopped scanner is safe');

const appSource = fs.readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const androidManifest = fs.readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const qrHandler = appSource.slice(appSource.indexOf('function showOrderQrManual'), appSource.indexOf('function downloadFile'));
assert.doesNotMatch(qrHandler, /setAuth\s*\(/, 'order QR must not change employee authentication');
assert.match(qrHandler, /call1C\('\/orders\/search'/, 'QR search must query 1C rather than only local state');
assert.match(qrHandler, /activeOrderQrSearch\?\.suffix === suffix/, 'the same in-flight QR search is deduplicated');
assert.match(androidManifest, /android\.permission\.CAMERA/, 'Android APK must be able to request camera permission on first use');

console.log('Order QR: exact five-character suffix, leading zeroes, letters, rear camera, release and auth isolation OK.');

import assert from 'node:assert/strict';

const MiB = 1024 * 1024;
const base64Length = bytes => 4 * Math.ceil(bytes / 3);
const envelopeFor = bytes => ({
  requestId: 'size-check-request',
  timestamp: '2026-10-28T00:00:00.000Z',
  userId: '13970179', maxUserId: '13970179', authId: '13970179', authMode: 'max', source: 'ITUS_MAX',
  orderRef: 'test-order-ref', orderId: 'test-order-ref', orderNumber: 'ЗН-TEST-00001',
  vehicleRef: 'test-vehicle', vehiclePlate: 'A000AA', documentRef: 'test-document-ref',
  clientEntryId: 'size-check-entry',
  entry: {
    type: 'video', clientEntryId: 'size-check-entry',
    file: { fileName:'limit-test.mp4', mimeType:'video/mp4', sizeBytes:bytes, contentBase64:'A'.repeat(base64Length(bytes)), clientFileId:'size-check-file' }
  },
  max: { webAppData:'', platform:'web', serviceBotId:'', clientBotId:'', miniAppId:'', userId:'13970179', maxUserId:'13970179', authMode:'max' },
  miniApp:'ITUS', version:'i-max-2.7.11'
});
const serializedBytes = bytes => Buffer.byteLength(JSON.stringify(envelopeFor(bytes)), 'utf8');

const size15 = serializedBytes(15 * MiB);
const size20 = serializedBytes(20 * MiB);
assert.ok(size15 > 20 * MiB && size15 < 21 * MiB);
assert.ok(size20 > 26 * MiB && size20 < 27 * MiB);
assert.ok(size20 < 30 * MiB, '20 MiB raw video fits the current Node body limit only with a narrow envelope margin');
console.log(`Upload envelope: 15 MiB raw -> ${size15} bytes; 20 MiB raw -> ${size20} bytes (JSON UTF-8).`);

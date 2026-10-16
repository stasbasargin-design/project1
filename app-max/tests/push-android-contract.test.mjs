import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
const icon = readFileSync(new URL('../android/app/src/main/res/drawable/ic_stat_imax.xml', import.meta.url), 'utf8');
assert.match(server, /sendEachForMulticast\s*\(/);
assert.match(server, /channelId:\s*'i-max-events'/);
assert.match(server, /icon:\s*'ic_stat_imax'/);
assert.match(manifest, /default_notification_icon/);
assert.match(manifest, /@drawable\/ic_stat_imax/);
assert.match(manifest, /default_notification_channel_id/);
assert.match(manifest, /POST_NOTIFICATIONS/);
assert.match(icon, /#FFFFFFFF/);
console.log('Android Push contract: multicast, channel and monochrome small icon OK.');

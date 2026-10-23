import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const app = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const bridge = readFileSync(new URL('../assets/native-push.js', import.meta.url), 'utf8');
const messenger = readFileSync(new URL('../assets/messenger.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../notification-sw.js', import.meta.url), 'utf8');

assert.match(app, /type === 'internal_chat_message'/);
assert.match(app, /messenger\?\.openThread\?\.\('staff', target\.topicRef\)/);
assert.match(app, /type === 'quality_control_requested'/);
assert.match(app, /state\.view = 'tech'/);
assert.match(app, /pendingPushTarget = target/);
assert.match(app, /await applyPendingPushTarget\(\)/);
assert.match(app, /handledPushTargets\.has\(key\)/);
assert.match(app, /window\.ITUS_NATIVE_PUSH\?\.listen\?\./);
assert.match(bridge, /function listen\(/);
assert.match(bridge, /pushNotificationActionPerformed/);
assert.match(messenger, /await loadMessages\(source,id,\{refresh:true\}\)/);
assert.match(messenger, /function refreshInternalThreadFromPush\(ref\)/);
assert.match(messenger, /refreshPending\[k\]=true/);
assert.match(app, /refreshOpenInternalChatFromPush/);
assert.match(app, /refreshVisibleInternalThread/);
assert.match(app, /event\.data\?\.type === 'itus-push'/);
assert.match(worker, /client\.postMessage\(\{type:'itus-push',data\}\)/);
console.log('Push navigation: internal chat, quality control, deferred auth and deduplication contracts OK.');

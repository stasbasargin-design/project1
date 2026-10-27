import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../assets/app.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../assets/app.css', import.meta.url), 'utf8');

for (const action of ['complete-acceptance', 'send-client-message', 'send-chat-message', 'msg-send', 'msg-poll-send']) {
  assert.match(app, new RegExp(`'${action}'`), `${action} must use the pending-action guard`);
}
assert.match(app, /const pendingActionButtons = new WeakSet\(\)/, 'pending state must be tied to the clicked button');
assert.match(app, /button\.disabled = true/, 'pending action must block a repeated click');
assert.match(app, /button\.setAttribute\('aria-busy', 'true'\)/, 'pending action must expose its busy state');
assert.match(app, /button\.classList\.remove\('is-pending'\)/, 'pending state must clear after completion or error');
assert.match(css, /\.is-pending::after\{[^}]*position:absolute/, 'indicator must not change button dimensions');

console.log('Button pending-state contract: OK');

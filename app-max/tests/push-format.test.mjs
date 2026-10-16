import assert from 'node:assert/strict';
import { FCM_SAFE_PAYLOAD_BYTES, fitPushPayload, readableNotificationText } from '../push-format.mjs';

const plain = readableNotificationText('<p>Здравствуйте, <b>Иван</b>!</p><ul><li>Первый пункт</li><li>Второй &amp; важный</li></ul><script>alert(1)</script>');
assert.equal(plain, 'Здравствуйте, Иван!\n• Первый пункт\n• Второй & важный');
assert.doesNotMatch(plain, /<\/?(?:p|b|li|script)>|alert/);

const formatted = fitPushPayload({
  title: '<b>Новое сообщение</b>',
  body: '<p>Текст<br>со строкой</p>',
  data: { type: 'new_messages', eventId: 'event-1', topicRef: 'topic-1', diagnostic: 'x'.repeat(6000) }
});
assert.equal(formatted.title, 'Новое сообщение');
assert.equal(formatted.body, 'Текст\nсо строкой');
assert.equal(formatted.data.type, 'new_messages');
assert.equal(formatted.data.eventId, 'event-1');
assert.ok(Buffer.byteLength(JSON.stringify({notification:{title:formatted.title,body:formatted.body},data:formatted.data}), 'utf8') <= FCM_SAFE_PAYLOAD_BYTES);

const unicode = fitPushPayload({title:'I-MAX',body:'🙂'.repeat(3000),data:{type:'new_messages',eventId:'unicode'}});
assert.ok(Buffer.byteLength(JSON.stringify({notification:{title:unicode.title,body:unicode.body},data:unicode.data}), 'utf8') <= FCM_SAFE_PAYLOAD_BYTES);
assert.equal(/[\uD800-\uDBFF]$/.test(unicode.body), false);
console.log('Push formatting: HTML-to-text, entity decoding and FCM size guard OK.');

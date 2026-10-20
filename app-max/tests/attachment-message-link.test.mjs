import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../assets/messenger.js', import.meta.url), 'utf8');
const contract = JSON.parse(fs.readFileSync(new URL('../1C_HTTP_METHODS_RELEASE.json', import.meta.url), 'utf8'));

// Bind the regression cases to the actual client request, rather than a
// separately invented API: opening media must send both 1C identifiers.
assert.match(source, /includeAttachmentContent:true,messageRef:message\.messageRef,attachmentRef:file\.fileRef/);
assert.match(source, /find\(item=>item\.messageRef===message\.messageRef\)\?\.attachments\?\.find\(item=>item\.fileRef===file\.fileRef\)/);

for (const method of ['/clients/messages/list', '/internal-chat/messages/list']) {
  assert.ok(contract.methods[method].request.messageRef);
  assert.ok(contract.methods[method].request.attachmentRef);
}

const messages = [
  { messageRef: 'message-a', attachments: [{ fileRef: 'file-a' }] },
  { messageRef: 'message-b', attachments: [{ fileRef: 'file-b' }] }
];
const findAttachment = (messageRef, attachmentRef) => messages
  .find(message => message.messageRef === messageRef)?.attachments
  ?.find(file => file.fileRef === attachmentRef);

assert.deepEqual(findAttachment('message-a', 'file-a'), { fileRef: 'file-a' });
assert.equal(findAttachment('missing-message', 'file-a'), undefined, 'missing message must not resolve an attachment');
assert.equal(findAttachment('message-a', 'file-b'), undefined, 'attachment belonging to another message must not resolve');
assert.equal(findAttachment('message-b', 'invalid-file'), undefined, 'invalid attachment id must not resolve');

console.log('Attachment message link: exact messageRef + attachmentRef matching OK');

import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
await import('../assets/api-normalizers.js');const api=globalThis.ITUS_API;
assert.equal(Object.keys(api.reactionCodes).length,8);
for(const [code,emoji] of Object.entries(api.reactionCodes)){
  assert.match(code,/^[a-z_]+$/);assert.equal(api.reactionCode(emoji),code);assert.equal(api.reactionEmoji(code),emoji);
  const normalized=api.normalizeMessage({messageRef:'m',text:'plain thumbs_up 👍',myReactionCode:code,reactions:[{emojiCode:code,count:2}]});
  assert.equal(normalized.myReaction,emoji);assert.deepEqual(normalized.reactions,[{emoji,count:2}]);assert.equal(normalized.text,'plain thumbs_up 👍');
  assert.equal(api.reactionResponseValid({messageRef:'m',myReactionCode:code,reactions:[{emojiCode:code,count:2}]},'m',code),true);
}
assert.equal(api.reactionCode('❤'),'heart');assert.equal(api.reactionEmoji('__proto__'),'');assert.equal(api.reactionCode('unrecognized'),'');
assert.equal(api.normalizeMessage({myReactionCode:'unknown',myReaction:'👍'}).myReaction,'','unknown code must not revive a stale legacy value');
assert.equal(api.normalizeMessage({myReaction:'👍'}).myReaction,'👍','legacy cached reactions remain readable');
assert.deepEqual(api.normalizeReactions([{emojiCode:'thumbs_up',count:2},{emoji:'👍',count:3},{emojiCode:'unknown',count:1},{emojiCode:'heart',count:'1'},{emojiCode:'sad',count:-1}]),[{emoji:'👍',count:2}]);
for(const bad of [
 {messageRef:'other',myReactionCode:'thumbs_up',reactions:[{emojiCode:'thumbs_up',count:1}]},
 {messageRef:'m',myReaction:'👍',reactions:[{emoji:'👍',count:1}]},
 {messageRef:'m',myReactionCode:'thumbs_up',reactions:[]},
 {messageRef:'m',myReactionCode:'thumbs_up',reactions:[{emojiCode:'unknown',count:1}]},
 {messageRef:'m',myReactionCode:'thumbs_up',reactions:[{emojiCode:'thumbs_up',count:1},{emojiCode:'thumbs_up',count:1}]}
])assert.equal(api.reactionResponseValid(bad,'m','thumbs_up'),false);
assert.equal(api.reactionResponseValid({messageRef:'m',myReactionCode:'',reactions:[{emojiCode:'heart',count:1}]},'m',''),true);
assert.equal(api.reactionCodesSupported({reactions:true}),false);assert.equal(api.reactionCodesSupported({reactions:'true',reactionEncoding:'code-v1'}),false);
assert.equal(api.reactionCodesSupported({reactions:true,reactionEncoding:'code-v1'}),true);

// Execute the real messenger. The transport rejects Unicode and keeps delayed
// acknowledgements pending so duplicate clicks and unconfirmed state are tested.
const calls=[],toasts=[];let acknowledge,capabilities={replies:true,reactions:true},id=0;
const app={innerHTML:'',querySelector:()=>null,querySelectorAll:()=>[]};
const document={baseURI:'https://synthetic.invalid/',hidden:false,body:{classList:{toggle(){},remove(){}}},getElementById:key=>key==='app'?app:null,querySelector:()=>null,addEventListener(){}};
const scope={console,URL,document,location:{origin:'https://synthetic.invalid'},crypto:{randomUUID:()=>`request-${++id}`},addEventListener(){},ITUS_FEATURES:{dateTime:()=>''}};scope.window=scope;vm.createContext(scope);
for(const name of ['api-normalizers','messenger'])vm.runInContext(readFileSync(new URL('../assets/'+name+'.js',import.meta.url),'utf8'),scope);
const messenger=scope.ITUS_MESSENGER.create({api:scope.ITUS_API,user:()=>({id:'111'}),allowed:()=>['staff','clients'],chatCapabilities:()=>capabilities,toast:(...args)=>toasts.push(args),closeSheet(){},call:async(method,body)=>{
 if(method.endsWith('/groups/list'))return {data:{groups:[{groupRef:'g',title:'Передача смены'}]}};
 if(method.endsWith('/topics/list'))return {data:{topics:[{topicRef:'c',title:'Client'}]}};
 if(method.endsWith('/messages/list'))return {data:{messages:[{messageRef:'m',text:'Original',reactions:[],myReactionCode:''}]}};
 if(method.endsWith('/messages/read'))return {success:true};
 if(method.endsWith('/messages/react')){assert.match(JSON.stringify(body),/^[\x00-\x7f]*$/);assert.equal(Object.hasOwn(body,'emoji'),false);calls.push({method,body:JSON.parse(JSON.stringify(body))});return new Promise(resolve=>acknowledge=resolve);}
 return {success:true};
}});
await messenger.enter('staff');await messenger.handle('msg-open',{dataset:{ref:'g'}});
await messenger.handle('msg-react',{dataset:{ref:'m',emoji:'👍'}});assert.equal(calls.length,0,'legacy capability cannot send a Unicode fallback');
capabilities={replies:true,reactions:true,reactionEncoding:'code-v1'};
const pending=messenger.handle('msg-react',{dataset:{ref:'m',emoji:'👍'}});await messenger.handle('msg-react',{dataset:{ref:'m',emoji:'👍'}});assert.equal(calls.length,1);assert.equal(calls[0].body.emojiCode,'thumbs_up');
assert.equal(toasts.some(item=>item[0]==='Реакция сохранена'),false);
acknowledge({data:{messageRef:'m',myReactionCode:'thumbs_up',reactions:[{emojiCode:'thumbs_up',count:1}]}});await pending;
assert.equal(toasts.at(-1)[0],'Реакция сохранена');
const remove=messenger.handle('msg-react',{dataset:{ref:'m',emoji:'👍'}});assert.equal(calls[1].body.emojiCode,'');acknowledge({data:{messageRef:'m',myReactionCode:'',reactions:[]}});await remove;
const failed=messenger.handle('msg-react',{dataset:{ref:'m',emoji:'❤️'}});const originalId=calls.at(-1).body.requestId;acknowledge({data:{messageRef:'m',myReaction:'❤️',reactions:[{emoji:'❤️',count:1}]}});await failed;
assert.match(toasts.at(-1)[0],/code-v1/);
const retried=messenger.handle('msg-react',{dataset:{ref:'m',emoji:'❤️'}});assert.equal(calls.at(-1).body.requestId,originalId);assert.equal(calls.at(-1).body.emojiCode,'heart');acknowledge({data:{messageRef:'m',myReactionCode:'heart',reactions:[{emojiCode:'heart',count:1}]}});await retried;
await messenger.enter('clients');await messenger.handle('msg-open',{dataset:{ref:'c'}});const before=calls.length;await messenger.handle('msg-react',{dataset:{ref:'m',emoji:'👍'}});assert.equal(calls.length,before,'client reactions remain disabled');
console.log('Reaction codes: eight mappings, strict ASCII requests/acknowledgements, legacy history, clear/replace, duplicate clicks, stable retry, capability and client guards OK.');

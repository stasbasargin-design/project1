import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const listeners = {}, calls = [];
const nativePlugin = {
  addListener(name, callback) { listeners[name] = callback; },
  async checkPermissions() { return {receive:'granted'}; },
  async requestPermissions() { return {receive:'granted'}; },
  async createChannel(channel) { calls.push(['channel',channel.id]); },
  async register() { calls.push(['register']); },
  async unregister() { calls.push(['unregister']); }
};
const scope = {
  Capacitor: {
    getPlatform: () => 'android',
    registerPlugin(name) { calls.push(['registerPlugin',name]); return name === 'PushNotifications' ? nativePlugin : null; }
  }
};
scope.window = scope;
vm.createContext(scope);
vm.runInContext(readFileSync(new URL('../assets/native-push.js', import.meta.url), 'utf8'), scope);

const received = [];
assert.equal(scope.ITUS_NATIVE_PUSH.supported(), true);
await scope.ITUS_NATIVE_PUSH.start({onToken:value => received.push(value)});
assert.deepEqual(calls.slice(0, 3), [['registerPlugin','PushNotifications'],['channel','i-max-events'],['register']]);
await listeners.registration({value:'fresh-token'});
assert.deepEqual(received, ['fresh-token']);
assert.equal(scope.ITUS_NATIVE_PUSH.isRegistered(), true);

let subscriptionAttempts = 0;
await scope.ITUS_NATIVE_PUSH.unregister();
await scope.ITUS_NATIVE_PUSH.start({onToken:async value => {
  assert.equal(value,'retry-token');
  subscriptionAttempts++;
  if(subscriptionAttempts===1)throw new Error('1C temporarily unreachable');
}});
await listeners.registration({value:'retry-token'});
assert.equal(scope.ITUS_NATIVE_PUSH.isRegistered(),false,'a failed 1C subscription is not registered');
assert.match(scope.ITUS_NATIVE_PUSH.registrationError(),/unreachable/);
const nativeCallsBeforeRetry=calls.filter(item=>item[0]==='register').length;
await scope.ITUS_NATIVE_PUSH.start();
assert.equal(subscriptionAttempts,2,'explicit retry resends the cached token to 1C');
assert.equal(calls.filter(item=>item[0]==='register').length,nativeCallsBeforeRetry,'server retry preserves the native token');
assert.equal(scope.ITUS_NATIVE_PUSH.isRegistered(),true);

let finishSubscription;
await scope.ITUS_NATIVE_PUSH.unregister();
await scope.ITUS_NATIVE_PUSH.start({onToken:()=>new Promise(resolve=>{finishSubscription=resolve;})});
const lateRegistration=listeners.registration({value:'old-account-token'});
await scope.ITUS_NATIVE_PUSH.unregister();
finishSubscription();await lateRegistration;
assert.equal(scope.ITUS_NATIVE_PUSH.isRegistered(),false,'late account registration cannot restore logged-out state');

let releaseOldToken;
const rotated=[];
await scope.ITUS_NATIVE_PUSH.start({onToken:async value=>{
  rotated.push(value);
  if(value==='before-rotation')await new Promise(resolve=>{releaseOldToken=resolve;});
}});
const firstToken=listeners.registration({value:'before-rotation'});
const secondToken=listeners.registration({value:'after-rotation'});
releaseOldToken();await Promise.all([firstToken,secondToken]);
assert.deepEqual(rotated,['before-rotation','after-rotation'],'a token rotated during server registration is also persisted');
assert.equal(scope.ITUS_NATIVE_PUSH.isRegistered(),true);
await scope.ITUS_NATIVE_PUSH.start();
assert.equal(rotated.length,2,'an already confirmed token does not re-register on every foreground event');
console.log('Native Push: Capacitor plugin proxy registration and FCM token listener OK.');

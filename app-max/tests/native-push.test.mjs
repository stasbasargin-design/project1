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
listeners.registration({value:'fresh-token'});
assert.deepEqual(received, ['fresh-token']);
console.log('Native Push: Capacitor plugin proxy registration and FCM token listener OK.');

import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const saved=new Map(),classes=new Map(),element={dataset:{},style:{},classList:{toggle:(key,value)=>classes.set(key,value)}};
let dark=false;
const document={documentElement:element,readyState:'loading',addEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null};
const window={document,localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},location:{hostname:'max-test.ea-itus.ru'},matchMedia:()=>({get matches(){return dark;},addEventListener(){}}),dispatchEvent(){},Event:class{},setTimeout:()=>1,clearTimeout(){}};
vm.runInNewContext(readFileSync(new URL('../assets/appearance.js',import.meta.url),'utf8'),{window,Date,clearTimeout(){}});
const api=window.ITUS_APPEARANCE;
for(const [date,expected]of [
 ['2026-12-09T23:59:59.999+05:00',false],['2026-12-10T00:00:00+05:00',true],
 ['2026-12-31T23:59:59+05:00',true],['2027-01-12T23:59:59.999+05:00',true],
 ['2027-01-13T00:00:00+05:00',false],['2027-12-10T00:00:00+05:00',false]
])assert.equal(api.seasonActive(Date.parse(date)),expected,date);
assert.equal(api.season.timeZone,'Asia/Yekaterinburg');
api.setTheme('dark');assert.equal(element.dataset.appearanceTheme,'dark');
api.setTheme('invalid');assert.equal(api.get().theme,'dark');
api.setTheme('light');assert.equal(element.dataset.appearanceTheme,'light');
dark=true;api.setTheme('system');assert.equal(element.dataset.appearanceTheme,'dark');
api.setHoliday(false);assert.equal(api.get().holiday,false);assert.equal(classes.get('holiday-active'),false);
assert.equal(JSON.parse(saved.get('itus.appearance.v1')).holiday,false);
assert.match(api.settings(),/10\.12\.2026–12\.01\.2027/);
assert.match(api.settings(),/Предпросмотр поздравления/);
assert.equal(api.greeting({preview:true}),false,'disabled holiday cannot open greeting');
assert.match(api.settings(),/data-appearance-action="preview" disabled/,'off switch must visibly disable preview');
assert.equal(api.back(),false,'Back must not consume navigation when greeting is closed');
window.Capacitor={};window.location.hostname='localhost';assert.doesNotMatch(api.settings(),/Предпросмотр поздравления/,'production native localhost must not enable test preview');
window.__ITUS_API_BASE__='https://max-test.ea-itus.ru/api/1c';assert.match(api.settings(),/Предпросмотр поздравления/,'locked TEST native profile may preview');
assert.ok(!readFileSync(new URL('../assets/appearance.js',import.meta.url),'utf8').match(/fetch\s*\(|XMLHttpRequest/),'appearance never calls 1C');
console.log('Appearance: inclusive holiday dates in UTC+05, year limit, device preferences, system/light/dark and off switch OK.');

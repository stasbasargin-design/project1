const fs = require('fs'),vm = require('vm'),assert=require('assert'),path=require('path');
const candidates=[path.resolve(__dirname,'../src/app.js'),path.resolve(__dirname,'../app.js')];
const source=fs.readFileSync(candidates.find(fs.existsSync),'utf8');
const edited=source.replace(/paint\(\);\s*\}\)\(\);\s*$/,'globalThis.__qa={S,v,doAction,saveRecord,setValue,screenVehicle,screenTask,screenEstimate,screenEvent,screenCounterparty,renderScreen,bulkRows,chooseRecord,koMode};paint();\n})();');
assert(edited.includes('globalThis.__qa='),'Instrument export failed');
const elements=new Map();
function el(id){if(!elements.has(id)){elements.set(id,{id,innerHTML:'',textContent:'',value:'',style:{},childNodes:[{textContent:''}],querySelectorAll(){return []},querySelector(){return null},focus(){},getBoundingClientRect(){return {left:0,right:100,bottom:20}}})}return elements.get(id)}
const events={};
const doc={getElementById:el,querySelectorAll(){return []},querySelector(){return null},addEventListener(name,cb){events[name]=cb},createElement(){return {style:{},click(){}}},body:{appendChild(){}},closest(){return null}};
const ls=new Map();
const sandbox={document:doc,window:{innerWidth:1600,innerHeight:900},localStorage:{getItem(k){return ls.get(k)||null},setItem(k,v){ls.set(k,v)}},setInterval(){},setTimeout(){return 1},clearTimeout(){},confirm(){return true},Blob,URL,console,Date};
sandbox.globalThis=sandbox;
vm.runInNewContext(edited,sandbox,{timeout:1500});
const qa=sandbox.__qa;
const tests=[];
function test(k,fn){try{fn();tests.push({test:k,pass:true})}catch(e){tests.push({test:k,pass:false,error:e.stack});process.exitCode=1}}
for(const x of ['desktop','event','task','contacts','counterparty','vehicles','vehicle','estimate','repair','express','max','blocked','email','appointment','progress'])test('Render '+x,()=>{qa.S.screen=x;const html=qa.renderScreen();assert(html.length>50)});
test('event reason transfers to agreement without full script',()=>{
 qa.setValue('event.reason','Диагностика и ремонт');assert.strictEqual(qa.v('event').agreementText,'Диагностика и ремонт')
});
test('vehicle VIN+chassis before brand/model',()=>{
 const h=qa.screenVehicle();assert(h.indexOf('vehicle.vin')<h.indexOf('vehicle.brand'));assert(h.includes('data-action="vehicleLookup"'));
});
test('vehicle wizard rejects missing VIN',()=>{
 qa.v('vehicle').vin='';qa.v('vehicle').chassis='';qa.doAction('vehicleLookup');assert(!el('modalLayer').innerHTML.includes('Подбор автомобиля'));
});
test('vehicle wizard shows manual selector and test match',()=>{
 qa.v('vehicle').vin='XTC651150N1234567';qa.v('vehicle').chassis='123';qa.doAction('vehicleLookup');assert(el('modalLayer').innerHTML.includes('vehicleBrandChoice'));assert(el('modalLayer').innerHTML.includes('vehicleAuto'));
 qa.doAction('closeModal');
});
test('counterparty lookup does not auto-fill before selection',()=>{
 qa.v('counterparty').form='Юридическое лицо';qa.v('counterparty').name='7701000001';qa.doAction('innLookup');assert(el('modalLayer').innerHTML.includes('выбор контрагента'));assert.strictEqual(qa.v('counterparty').name,'7701000001');
 qa.doAction('lookup:p1');qa.doAction('fillInnRecord');assert(qa.v('counterparty').name.includes('Транслогистика'));
});
test('task KO dates contain time',()=>{
 qa.v('task').responsible='КО';qa.v('task').type='Телефонный звонок';qa.v('task').theme='Телефонный звонок клиенту';const html=qa.screenTask();assert(html.includes('type="datetime-local"'));
});
test('task KO dates included in content after valid save',()=>{
 const t=qa.v('task');t.proposedDate='2026-11-20T10:30';t.desiredDate='2026-11-21T09:00';t.endDate='2026-11-25';t.content='Согласовать время прибытия клиента';assert(qa.saveRecord('task')===true);assert(t.content.includes('Дата записи предлагаемая: 2026-11-20 10:30'));
});
test('estimate requires 4 header fields and at least one real work',()=>{
 const e=qa.v('estimate');e.counterparty='ООО Клиент';e.vehicle='КАМАЗ 65115';qa.S.items.works=[{name:'Диагностика',quantity:1}];assert(qa.saveRecord('estimate')===false);
 e.agreement='Договор 1';e.payment='Безналичный расчёт';assert(qa.saveRecord('estimate')===true)
});
test('bulk picker supports multiple items',()=>{
 const h=qa.bulkRows('works',[{id:'1',code:'W1',name:'Работа 1'},{id:'2',code:'W2',name:'Работа 2'}]);assert((h.match(/data-bulk/g)||[]).length===2)
});
console.log(JSON.stringify({total:tests.length,passed:tests.filter(x=>x.pass).length,failed:tests.filter(x=>!x.pass).map(x=>({name:x.test,error:x.error?.split('\n')[0]})),tests},null,2));
fs.writeFileSync(path.join(__dirname,'test-static-results.json'),JSON.stringify({tests},null,2));

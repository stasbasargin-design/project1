const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const E=require('../engine.js');
const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
function boot(seed=E.initialState()){
  const saved={aa6_training_v1:JSON.stringify(seed)};
  const nodes={};
  const listeners={};
  const newNode=id=>nodes[id]||(nodes[id]={id,innerHTML:'',value:'',dataset:{},textContent:'',className:'',classList:{toggle(){}},addEventListener(type,fn){(listeners[id+':'+type]??=[]).push(fn)},focus(){}});
  const fake={
    window:{TrainerEngine:E,addEventListener(type,fn){(listeners['window:'+type]??=[]).push(fn)},clearTimeout(){},setTimeout(){},confirm(){return true}},
    document:{getElementById:newNode},
    localStorage:{getItem(k){return saved[k]||null},setItem(k,v){saved[k]=v}},
    clearTimeout(){},setTimeout(){},confirm(){return true},console,
  };
  vm.runInNewContext(app,fake,{filename:'app.js'});
  const click=(act,data={})=>{
    const node={dataset:{act,...data},classList:{contains(){return false}},closest(){return this}};
    for(const fn of listeners['window:click']||[])fn({target:node,preventDefault(){}});
  };
  const change=(dataset,value='')=>{
    const node={dataset,value,matches(q){return q==='[data-field]'}};
    for(const fn of listeners['window:change']||[])fn({target:node});
  };
  return {nodes,saved,click,change,listeners};
}

test('Реальные разделы 1С и трёхколоночная CRM в разметке',()=>{
  const {nodes}=boot();
  assert.match(nodes.nav.innerHTML,/Рабочий стол первой линии CRM/);
  assert.match(nodes['main-content'].innerHTML,/Не разобранное/);
  assert.match(nodes['main-content'].innerHTML,/Подготовка к визиту/);
  assert.match(nodes['main-content'].innerHTML,/Сделка/);
});
test('Форма «Событие» содержит нужные блоки из регламента',()=>{
  const env=boot();env.click('SHOW',{value:'event'});
  const html=env.nodes['main-content'].innerHTML;
  for(const s of ['Причины обращений','Договорённость с клиентом','Поиск автомобиля','Рекомендации','Контрагенты и контактные лица','Запись на ремонт','Экспресс ЗН'])assert.ok(html.includes(s),s);
});
test('Всплывающая «Задача CRM» имеет поля дат записи и общий вопрос',()=>{
  const env=boot();env.click('OPEN_CRM_TASK');
  const html=env.nodes['modal-root'].innerHTML;
  for(const s of ['Ответственный','Предлагаемая дата записи','Желаемая дата записи','Общий вопрос','Содержание'])assert.ok(html.includes(s),s);
});
test('Визуальная форма КП с табличными частями и флажками согласования',()=>{
  let s=E.initialState();
  for(const a of [
   {type:'EVENT_FIELD',field:'contact',value:'Учебный клиент'},
   {type:'EVENT_FIELD',field:'customer',value:'Учебное ООО'},
   {type:'EVENT_FIELD',field:'vehicle',value:'КАМАЗ 65115'},
   {type:'EVENT_FIELD',field:'reason',value:'Диагностика'},
   {type:'EVENT_FIELD',field:'agreement',value:'Осмотр тормозов'},
   {type:'EVENT_SAVE'}, {type:'CREATE_REQUEST',date:'2026-11-20T10:00'},
   {type:'EVENT_POST'}, {type:'CREATE_ORDER'},
   {type:'SET_ROLE',value:'mechanic'}, {type:'TAKE_TASK',id:'MECH-1'}, {type:'FINISH_DEFECT'},
   {type:'SET_ROLE',value:'master'},{type:'TAKE_TASK',id:'PREP-1'},{type:'ADD_WORK',id:'brake-diag'},
   {type:'ADD_PART',id:'pad-kit'},
  ])s=E.dispatch(s,a);
  s.screen='estimate';
  const env=boot(s);let html=env.nodes['main-content'].innerHTML;
  for(const x of ['Автоработы (1)','Товары (1)','Проценить','Согласовано','Деталь клиента','Норма времени','Итого:'])assert.ok(html.includes(x),x);
  env.click('EST_TAB',{value:'parts'});html=env.nodes['main-content'].innerHTML;
  assert.ok(html.includes('DEMO-PAD-01'));
});
test('Разделение прав на уровне вкладок',()=>{
  const s=E.initialState();s.role='mechanic';s.screen='desktop';
  const env=boot(s);
  assert.doesNotMatch(env.nodes.nav.innerHTML,/Калькуляция/);
  assert.match(env.nodes.nav.innerHTML,/Заказ-наряд/);
});

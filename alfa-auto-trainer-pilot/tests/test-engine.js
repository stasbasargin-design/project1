'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const E=require('../engine');
let n;
const act=(s,type,data={})=>E.dispatch(s,{type,...data});
function basic(){let s=E.initialState();for(const [field,value] of Object.entries({contact:'Петров Алексей',phone:'+7 900 000-00-01',customer:'ООО Транспорт-Альфа',vehicle:'КАМАЗ 65115',reason:'Диагностика',agreement:'Клиент сообщает о шуме при торможении. Предлагаем осмотр и согласование по результатам.'}))s=act(s,'EVENT_FIELD',{field,value});s=act(s,'EVENT_SAVE');s=act(s,'CREATE_REQUEST',{date:'2026-11-19T10:00'});s=act(s,'EVENT_POST');s=act(s,'CREATE_ORDER');return s;}
function afterDefect(){let s=basic();s=act(s,'SET_ROLE',{value:'mechanic'});s=act(s,'TAKE_TASK',{id:'MECH-1'});s=act(s,'FINISH_DEFECT');s=act(s,'SET_ROLE',{value:'master'});s=act(s,'TAKE_TASK',{id:'PREP-1'});return s;}
test('Не допускает проведение пустого события и без связанных документов',()=>{
 let s=E.initialState();assert.throws(()=>act(s,'EVENT_SAVE'),/контактное лицо/);
 for(const [field,value] of Object.entries({contact:'Иванов',reason:'Диагностика',agreement:'Диагностика',customer:'ООО Пример'}))s=act(s,'EVENT_FIELD',{field,value});
 s=act(s,'EVENT_SAVE');assert.throws(()=>act(s,'EVENT_POST'),/документ сделки/);
});
test('Полный маршрут: Событие → Заявка → ЗН → Дефектовка → авто-КП → ОЗЧ → согласование → закрытие',()=>{
 let s=afterDefect();assert.equal(s.kp.status,'Подготовка');
 s=act(s,'ADD_WORK',{id:'brake-diag'});s=act(s,'ADD_WORK',{id:'brake-pads'});s=act(s,'ADD_PART',{id:'pad-kit'});
 s=act(s,'PRICE_REQUEST');assert.equal(s.tasks.find(t=>t.id==='PREP-1').status,'Завершена');
 s=act(s,'SET_ROLE',{value:'parts'});s=act(s,'TAKE_TASK',{id:'PRICE-1'});
 s=act(s,'SET_PRICE',{id:'pad-kit',price:5700,supplier:'Учебный поставщик'});
 s=act(s,'KP_TO_AGREEMENT');assert.equal(s.tasks.find(t=>t.id==='PRICE-1').status,'Завершена');
 assert.equal(s.kp.status,'Согласование');s=act(s,'SET_ROLE',{value:'master'});s=act(s,'TAKE_TASK',{id:'AGREE-1'});
 for(const p of s.kp.works)s=act(s,'ITEM_FLAG',{kind:'works',id:p.id,flag:'Согласован'});
 for(const p of s.kp.parts)s=act(s,'ITEM_FLAG',{kind:'parts',id:p.id,flag:'Рекомендация'});
 s=act(s,'KP_AGREED',{note:'Клиент согласовал работы; деталь — рекомендация.'});
 assert.equal(s.order.works.length,2);assert.equal(s.order.parts.length,0);
 s=act(s,'FINISH_ORDER');assert.equal(s.finished,true);assert.equal(s.order.status,'Закрыт (учебный)');
 assert.equal(E.evaluate(s).percent,100);assert.ok(E.totals(s.kp)>0);
});
test('Исполнитель не может отправлять на проценку и мастер не может завершить дефектовку',()=>{
 const s=basic();assert.throws(()=>act(s,'FINISH_DEFECT'),/только роли/);
 const k=act(s,'SET_ROLE',{value:'mechanic'});assert.throws(()=>act(k,'PRICE_REQUEST'),/только роли/);
});
test('Не допускает проценку без товаров, согласование без авторабот, дублирующее завершение дефектовки',()=>{
 let s=afterDefect();assert.throws(()=>act(s,'PRICE_REQUEST'),/товары/);
 s=act(s,'ADD_PART',{id:'pad-kit'});assert.throws(()=>act(s,'KP_TO_AGREEMENT'),/автоработы/);
 s=act(s,'SET_ROLE',{value:'mechanic'});assert.throws(()=>act(s,'FINISH_DEFECT'),/Сначала примите задачу|уже завершена/);
});
test('Работа с блокировкой и снятием только согласующим',()=>{
 let s=E.initialState();s=act(s,'SET_ROLE',{value:'coordinator'});s=act(s,'BLOCK');s=act(s,'SET_ROLE',{value:'master'});
 for(const [field,value] of Object.entries({contact:'Петров',customer:'ООО Транспорт',reason:'Диагностика',agreement:'Проверка',vehicle:'КАМАЗ'}))s=act(s,'EVENT_FIELD',{field,value});
 s=act(s,'EVENT_SAVE');s=act(s,'CREATE_REQUEST',{date:'2026-11-19T12:00'});
 assert.throws(()=>act(s,'CREATE_ORDER'),/заблокирован/);s=act(s,'UNBLOCK_REQUEST');
 s=act(s,'SET_ROLE',{value:'coordinator'});s=act(s,'TAKE_TASK',{id:'UNBLOCK-1'});s=act(s,'UNBLOCK_APPROVE');
 assert.equal(s.blocked,false);s=act(s,'SET_ROLE',{value:'master'});s=act(s,'CREATE_ORDER');assert.ok(s.order);
});
test('MAX не разрешает общение без согласия на персональные данные',()=>{
 let s=E.initialState();for(const [field,value] of Object.entries({contact:'Алексей',customer:'ООО Пример',phone:'+70000000000'}))s=act(s,'EVENT_FIELD',{field,value});
 s=act(s,'MAX_INVITE');assert.throws(()=>act(s,'MAX_SEND'),/отсутствует согласие/);
 s=act(s,'SET_ROLE',{value:'coordinator'});s=act(s,'MAX_CONSENT',{value:true});s=act(s,'SET_ROLE',{value:'master'});s=act(s,'MAX_SEND');assert.match(s.notifications[0],/имитировано/);
});
test('Навигация ограничена доступами роли и состояние не теряется',()=>{
 let s=E.initialState();s=act(s,'SET_ROLE',{value:'parts'});assert.throws(()=>act(s,'SHOW',{value:'event'}),/недоступен/);s=act(s,'SHOW',{value:'tasks'});assert.equal(s.screen,'tasks');
});
test('Задача КО требует дат записи или флаг общего вопроса, затем закрывается с результатом',()=>{
 let s=E.initialState();
 for(const [field,value] of Object.entries({contact:'Петров',customer:'ООО',reason:'Диагностика',agreement:'Ожидается связь'}))s=act(s,'EVENT_FIELD',{field,value});s=act(s,'EVENT_SAVE');
 assert.throws(()=>act(s,'CREATE_CRM_TASK',{owner:'coordinator',kind:'Телефонный звонок',subject:'Телефонный звонок клиенту',note:'Перенести запись'}),/предлагаемую и желаемую даты/);
 s=act(s,'CREATE_CRM_TASK',{owner:'coordinator',kind:'Телефонный звонок',subject:'Телефонный звонок клиенту',note:'Уточнить реквизиты',general:true});
 assert.equal(s.event.linked,true);s=act(s,'EVENT_POST');s=act(s,'SET_ROLE',{value:'coordinator'});
 const t=s.tasks[0];s=act(s,'TAKE_TASK',{id:t.id});assert.throws(()=>act(s,'COMPLETE_CRM_TASK',{id:t.id,result:''}),/результат/);
 s=act(s,'COMPLETE_CRM_TASK',{id:t.id,result:'Реквизиты уточнены'});assert.equal(s.tasks[0].status,'Завершена');
});
test('Отмена События создаёт контроль у координатора и возврат на дожим мастеру',()=>{
 let s=E.initialState();
 for(const [field,value] of Object.entries({contact:'Петров',customer:'ООО',reason:'Прочее',agreement:'Запрос без ремонта'}))s=act(s,'EVENT_FIELD',{field,value});s=act(s,'EVENT_SAVE');
 s=act(s,'EVENT_CANCEL',{reason:'Нецелевое обращение'});assert.equal(s.event.status,'Отменён');
 s=act(s,'SET_ROLE',{value:'coordinator'});s=act(s,'TAKE_TASK',{id:'CONTROL-CANCEL'});
 assert.throws(()=>act(s,'REVIEW_CANCEL',{decision:'return',note:''}),/комментарий/);
 s=act(s,'REVIEW_CANCEL',{decision:'return',note:'Повторно связаться с клиентом'});
 assert.ok(s.tasks.find(x=>x.type==='followup'&&x.owner==='master'));
 s=act(s,'SET_ROLE',{value:'master'});s=act(s,'TAKE_TASK',{id:'FOLLOWUP-1'});
 s=act(s,'COMPLETE_CRM_TASK',{id:'FOLLOWUP-1',result:'Клиент уведомлён'});
 assert.equal(s.tasks.find(x=>x.type==='followup').status,'Завершена');
});

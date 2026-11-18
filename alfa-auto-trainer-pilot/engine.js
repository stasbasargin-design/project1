/* Альфа-Авто: учебный контур. Исключительно синтетические данные, никаких запросов в 1С. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TrainerEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const ROLE = { master: 'Мастер-приёмщик', parts: 'ОЗЧ', mechanic: 'Исполнитель', coordinator: 'Координатор' };
  const CAUSES = ['Диагностика', 'Текущий ремонт', 'Техническое обслуживание', 'Прочее', 'Согласование дополнительных работ'];
  const WORKS = [
    { id: 'brake-diag', name: 'Тормозная система — диагностика', price: 2400, norm: 1.0 },
    { id: 'brake-pads', name: 'Колодки тормозные — замена', price: 4800, norm: 2.0 },
    { id: 'oil', name: 'Масло двигателя — замена', price: 1600, norm: 0.6 },
    { id: 'pneumo', name: 'Пневмосистема — проверка герметичности', price: 3600, norm: 1.5 }
  ];
  const PARTS = [
    { id: 'pad-kit', name: 'Колодки тормозные, комплект (учебный)', article: 'DEMO-PAD-01', stock: 2, price: 0 },
    { id: 'hose', name: 'Шланг пневматический (учебный)', article: 'DEMO-HOSE-02', stock: 0, price: 0 },
    { id: 'oil', name: 'Масло моторное 10W-40, 1 л (учебное)', article: 'DEMO-OIL-03', stock: 18, price: 680 }
  ];
  const MODES = ['Обучение', 'Практика', 'Экзамен'];
  const ROLE_TABS = {master:['desktop','event','request','order','estimate','tasks','communications','results'], parts:['desktop','estimate','tasks','results'], mechanic:['desktop','order','tasks','results'], coordinator:['desktop','event','tasks','order','results']};
  const clone = x => JSON.parse(JSON.stringify(x));
  function initialState(mode='Обучение') {
    return {
      version: 1, mode, role:'master', screen:'desktop', scenario:'Шум в тормозной системе', now:0, score:100,
      event:{ id:'СОБ-000001', status:'Черновик', type:'Входящий звонок', contact:'', phone:'', customer:'', reason:'', agreement:'', vehicle:'', linked:false, cancelReason:'' },
      request:null, order:null, kp:null, tasks:[], notifications:[], history:[], blocked:false, unblockRequested:false,
      consent:false, maxInvited:false, finished:false, examStarted:false, examCompleted:false
    };
  }
  function fail(message){const e=new Error(message);e.validation=true;throw e;}
  function requireRole(s, role){if (s.role!==role) fail('Операция доступна только роли «'+ROLE[role]+'».');}
  function task(s, id, type, owner, title, target){ if(s.tasks.some(t=>t.id===id)) return; s.tasks.push({id,type,owner,assignee:null,title,target,status:'Новая',note:'',createdAt:s.now}); }
  function finishTasks(s, type) { s.tasks.filter(t=>t.type===type && t.status!=='Завершена').forEach(t=>{t.status='Завершена'; t.finishedAt=s.now;}); }
  function record(s, text){s.history.push({at:s.now,text});s.notifications.unshift(text);s.notifications=s.notifications.slice(0,7);}
  function advance(s){s.now+=1;}
  function totals(kp){ if(!kp) return 0; return kp.works.reduce((n,x)=>n+x.price*x.qty,0)+kp.parts.reduce((n,x)=>n+x.price*x.qty,0); }
  function dispatch(current, action){
    const s=clone(current); if(!action||!action.type) fail('Отсутствует действие');
    advance(s);
    const a=action;
    switch(a.type){
      case 'SET_ROLE': if(!ROLE[a.value]) fail('Неизвестная роль');s.role=a.value;s.screen='desktop';break;
      case 'SET_MODE': if(!MODES.includes(a.value)) fail('Неизвестный режим'); if(s.history.length) fail('Чтобы сменить режим, начните новый учебный сценарий.');s.mode=a.value;break;
      case 'SHOW': if(!ROLE_TABS[s.role].includes(a.value)) fail('Раздел недоступен вашей учебной роли.');s.screen=a.value;break;
      case 'EVENT_FIELD':{
        requireRole(s,'master');if(s.event.status==='Проведён') fail('Проведённое событие не редактируется');
        if(!['contact','phone','customer','reason','agreement','vehicle','type'].includes(a.field)) fail('Неизвестное поле события');
        s.event[a.field]=String(a.value||'');break;
      }
      case 'EVENT_SAVE':
        requireRole(s,'master');
        if(!s.event.contact.trim()) fail('Укажите контактное лицо.');
        if(!s.event.agreement.trim()) fail('Заполните «Договорённость с клиентом».');
        if(!s.event.customer.trim()) fail('Укажите контрагента.');
        if(!s.event.reason) fail('Выберите причину обращения.');
        s.event.status='Записан';record(s,'Событие записано без проведения.');break;
      case 'CREATE_CRM_TASK': {
        requireRole(s,'master');
        if(s.event.status==='Черновик') fail('Сначала запишите Событие.');
        if(s.event.status==='Проведён') fail('Из проведённого учебного события задачу здесь не создаём.');
        const subject=String(a.subject||'').trim();
        const note=String(a.note||'').trim();
        const owner=String(a.owner||'');
        const kind=String(a.kind||'Телефонный звонок');
        if(!['master','coordinator'].includes(owner)) fail('Выберите ответственного или группу КО.');
        if(!['Телефонный звонок','Напоминание'].includes(kind)) fail('Выберите вид задачи.');
        if(!subject||!note) fail('Тема и содержание задачи обязательны.');
        if(owner==='coordinator' && kind==='Телефонный звонок' && subject==='Телефонный звонок клиенту' && !a.general){
          if(!a.proposed||!a.desired) fail('Для группы КО заполните предлагаемую и желаемую даты или отметьте «Общий вопрос».');
          const valid=d=>/^\d{4}-\d{2}-\d{2}$/.test(d);
          if(!valid(a.proposed)||!valid(a.desired)) fail('Дата должна быть указана через календарь.');
          const now=new Date();now.setHours(0,0,0,0);
          const max=new Date(now);max.setDate(max.getDate()+60);
          for(const d of [a.proposed,a.desired]){const date=new Date(d+'T00:00:00');if(date<now || date>max)fail('Дата записи должна быть в интервале от сегодня до 60 календарных дней.');}
        }
        task(s,'CRM-'+(s.tasks.length+1),'manual',owner,subject,'event');
        const t=s.tasks[s.tasks.length-1];t.note=note;t.kind=kind;t.general=!!a.general;t.proposed=a.proposed||'';t.desired=a.desired||'';
        s.event.linked=true;record(s,'Из события создана задача CRM: '+subject+'.');break;
      }
      case 'COMPLETE_CRM_TASK': {
        const t=s.tasks.find(x=>x.id===a.id);if(!t||!['manual','followup'].includes(t.type)) fail('Это не вручную завершаемая задача.');
        if(t.owner!==s.role||t.status!=='В работе') fail('Сначала примите свою задачу.');
        if(!String(a.result||'').trim()) fail('Заполните результат отработки задачи.');
        t.result=String(a.result).trim();t.status='Завершена';t.finishedAt=s.now;record(s,'Задача CRM завершена с указанием результата.');break;
      }
      case 'EVENT_CANCEL': {
        requireRole(s,'master');if(s.event.status!=='Записан') fail('Для отмены сначала запишите событие.');
        const reason=String(a.reason||'').trim();if(!reason)fail('Укажите причину отмены события.');
        s.event.status='Отменён';s.event.cancelReason=reason;
        task(s,'CONTROL-CANCEL','control','coordinator','Контроль отмены события','event');
        record(s,'Событие отменено, координатору поставлена задача контроля.');break;
      }
      case 'REVIEW_CANCEL': {
        requireRole(s,'coordinator');const t=s.tasks.find(x=>x.type==='control');
        if(!t||t.status!=='В работе') fail('Примите задачу контроля отмены.');
        if(!['approve','return'].includes(a.decision)) fail('Выберите решение.');
        t.status='Завершена';t.result=String(a.note||'');t.finishedAt=s.now;
        if(a.decision==='return'){
          if(!t.result.trim())fail('При возврате укажите комментарий координатора.');
          task(s,'FOLLOWUP-1','followup','master','Дожим клиента','event');
        }
        record(s,a.decision==='approve'?'Координатор подтвердил отмену события.':'Отмена возвращена на доработку, мастеру создана задача «Дожим клиента».');break;
      }
      case 'EVENT_POST':
        requireRole(s,'master');
        if(s.event.status!=='Записан') fail('Сначала запишите документ «Событие».');
        if(!s.event.linked) fail('Для проведения создайте документ сделки или задачу CRM.');
        s.event.status='Проведён';record(s,'Событие проведено: документ сделки связан.');break;
      case 'CREATE_REQUEST':
        requireRole(s,'master');
        if(s.event.status==='Черновик') fail('Сначала заполните и запишите Событие.');
        if(!s.event.vehicle) fail('Выберите автомобиль.');
        if(s.request) fail('Заявка уже существует.');
        s.request={id:'ЗР-000001',status:'Записана',date:String(a.date||''),vehicle:s.event.vehicle};
        if(!s.request.date) fail('Укажите дату записи на ремонт.');
        s.event.linked=true;record(s,'Создана заявка на ремонт '+s.request.id+'.');break;
      case 'CREATE_ORDER':
        requireRole(s,'master');
        if(!s.request) fail('Сначала создайте заявку на ремонт.');
        if(s.order) fail('Заказ-наряд уже существует.');
        if(s.blocked) fail('Контрагент заблокирован — требуется согласование разблокировки.');
        s.order={id:'ЗН-000001',status:'Открыт',defectFinished:false,works:[],parts:[]};
        task(s,'MECH-1','defect','mechanic','Провести дефектовку '+s.order.id,'order');
        record(s,'Создан заказ-наряд и задача исполнителю на дефектовку.');break;
      case 'TAKE_TASK':{
        const t=s.tasks.find(x=>x.id===a.id);if(!t) fail('Задача не найдена.');
        if(t.owner!==s.role) fail('Задача назначена другой роли.');
        if(t.status==='Завершена') fail('Задача уже завершена.');
        if(t.assignee && t.assignee!==s.role) fail('Задача уже принята.');
        t.assignee=s.role;t.status='В работе';record(s,'Задача «'+t.title+'» принята к исполнению.');break;
      }
      case 'FINISH_DEFECT':
        requireRole(s,'mechanic');
        if(!s.order) fail('Нет заказ-наряда.');
        if(!s.tasks.some(t=>t.type==='defect'&&t.status==='В работе')) fail('Сначала примите задачу дефектовки.');
        if(s.order.defectFinished) fail('Дефектовка уже завершена.');
        s.order.defectFinished=true;finishTasks(s,'defect');
        if(!s.kp) s.kp={id:'КП-000001',status:'Подготовка',createdBy:'Автоматическая КП',works:[],parts:[],approvalNote:'',agreed:false};
        task(s,'PREP-1','prepare','master','Подготовить КП клиенту по дефектовке', 'estimate');
        record(s,'Системное уведомление: дефектовка завершена. Создана автоматическая КП и задача мастеру.');break;
      case 'ADD_WORK':{
        requireRole(s,'master');
        if(!s.kp || s.kp.status!=='Подготовка') fail('Автоработы можно добавлять на этапе подготовки КП.');
        if(!s.tasks.some(t=>t.type==='prepare'&&t.status==='В работе')) fail('Примите задачу подготовки КП.');
        const w=WORKS.find(x=>x.id===a.id); if(!w) fail('Работа не найдена.');
        const v=s.kp.works.find(x=>x.id===w.id);if(v) v.qty++;else s.kp.works.push({...w,qty:1,flag:'нет'});
        record(s,'В КП добавлена работа: '+w.name+'.');break;
      }
      case 'ADD_PART':{
        if(!['master','parts'].includes(s.role)) fail('Недостаточно прав на подбор товара.');
        if(!s.kp || !['Подготовка','Проценка ОЗЧ'].includes(s.kp.status)) fail('Подбор товаров недоступен на этом этапе.');
        if(s.role==='master'&&!s.tasks.some(t=>t.type==='prepare'&&t.status==='В работе')) fail('Примите задачу подготовки КП.');
        if(s.role==='parts'&&!s.tasks.some(t=>t.type==='price'&&t.status==='В работе')) fail('Примите задачу проценки.');
        const p=PARTS.find(x=>x.id===a.id);if(!p) fail('Товар не найден.');
        const v=s.kp.parts.find(x=>x.id===p.id);if(v) v.qty++;else s.kp.parts.push({...p,qty:1,flag:'нет',supplier:p.stock? 'Склад БЕ': ''});
        record(s,'В КП добавлен товар: '+p.name+'.');break;
      }
      case 'PRICE_REQUEST':
        requireRole(s,'master');
        if(!s.kp || s.kp.status!=='Подготовка') fail('Передача на проценку доступна только при подготовке КП.');
        if(!s.tasks.some(t=>t.type==='prepare'&&t.status==='В работе')) fail('Примите задачу подготовки КП.');
        if(!s.kp.parts.length) fail('Укажите товары для проценки.');
        finishTasks(s,'prepare');s.kp.status='Проценка ОЗЧ';
        task(s,'PRICE-1','price','parts','Проценить товары по '+s.kp.id,'estimate');
        record(s,'Подготовка КП завершена, задача на проценку направлена в ОЗЧ.');break;
      case 'SET_PRICE':{
        requireRole(s,'parts');
        if(!s.kp || s.kp.status!=='Проценка ОЗЧ') fail('Сейчас нет КП на проценке.');
        if(!s.tasks.some(t=>t.type==='price'&&t.status==='В работе')) fail('Примите задачу на проценку.');
        const p=s.kp.parts.find(x=>x.id===a.id);if(!p) fail('Товар не найден в КП.');
        const cost=Number(a.price);if(!Number.isFinite(cost)||cost<=0) fail('Укажите положительную стоимость товара.');
        p.price=cost;p.supplier=(String(a.supplier||'Склад БЕ')).trim();
        record(s,'ОЗЧ установил стоимость товара '+p.article+'.');break;
      }
      case 'KP_TO_AGREEMENT':
        if(!s.kp||!['Подготовка','Проценка ОЗЧ'].includes(s.kp.status)) fail('Недопустимая смена статуса калькуляции.');
        if(s.role==='master'&&s.kp.status==='Подготовка'){
          if(!s.tasks.some(t=>t.type==='prepare'&&t.status==='В работе')) fail('Сначала примите задачу подготовки КП.');
        } else if(s.role==='parts'&&s.kp.status==='Проценка ОЗЧ'){
          if(!s.tasks.some(t=>t.type==='price'&&t.status==='В работе')) fail('Сначала примите задачу ОЗЧ.');
        } else fail('Переход может выполнить ответственный текущего этапа.');
        if(!s.kp.works.length) fail('В КП отсутствуют автоработы.');
        if(s.kp.parts.some(p=>!p.price)) fail('Не все товары имеют стоимость. Передайте их на проценку.');
        if(s.kp.status==='Подготовка')finishTasks(s,'prepare'); else finishTasks(s,'price');
        s.kp.status='Согласование';task(s,'AGREE-1','agree','master','Согласовать КП клиенту по дефектовке','estimate');
        record(s,'КП переведена в статус «Согласование». Создана задача мастеру.');break;
      case 'ITEM_FLAG':{
        requireRole(s,'master');
        if(!s.kp||s.kp.status!=='Согласование') fail('Отметки согласования доступны в статусе «Согласование».');
        if(!['Согласован','Рекомендация','Деталь клиента','Не согласован'].includes(a.flag)) fail('Неверная отметка.');
        const items=a.kind==='works'?s.kp.works:s.kp.parts;
        const item=items.find(x=>x.id===a.id);if(!item)fail('Позиция не найдена.');
        item.flag=a.flag;break;
      }
      case 'KP_AGREED':
        requireRole(s,'master');
        if(!s.kp || s.kp.status!=='Согласование') fail('КП должна находиться в статусе «Согласование».');
        if(!s.tasks.some(t=>t.type==='agree'&&t.status==='В работе')) fail('Примите задачу на согласование с клиентом.');
        if(!String(a.note||'').trim()) fail('Заполните результат согласования в комментарии задачи.');
        if([...s.kp.works,...s.kp.parts].some(x=>x.flag==='нет')) fail('Укажите решение клиента по каждой позиции КП.');
        s.kp.approvalNote=String(a.note).trim();
        s.kp.agreed=[...s.kp.works,...s.kp.parts].some(x=>x.flag==='Согласован');
        s.kp.status=s.kp.agreed?'Частично / полностью согласована':'Не согласована';
        finishTasks(s,'agree');
        if(s.order){s.order.works=s.kp.works.filter(x=>x.flag==='Согласован');s.order.parts=s.kp.parts.filter(x=>x.flag==='Согласован');}
        record(s,'Согласование КП завершено; результат и решения по позициям зафиксированы.');break;
      case 'FINISH_ORDER':
        requireRole(s,'master');
        if(!s.order) fail('Заказ-наряд не создан.');
        if(s.event.status!=='Проведён') fail('Проведите исходное событие.');
        if(s.blocked) fail('Операции запрещены: контрагент заблокирован.');
        if(!s.order.defectFinished || !s.kp || !s.kp.agreed) fail('Для учебного сценария сначала завершите дефектовку и согласуйте работы в КП.');
        if(!s.order.works.length) fail('Нет согласованных авторабот в ЗН.');
        s.order.status='Закрыт (учебный)';s.finished=true;record(s,'Заказ-наряд закрыт. Учебный сценарий завершён.');break;
      case 'BLOCK': requireRole(s,'coordinator');s.blocked=true;record(s,'Учебная финансовая блокировка включена.');break;
      case 'UNBLOCK_REQUEST':
        requireRole(s,'master');if(!s.blocked)fail('Контрагент не заблокирован.');
        s.unblockRequested=true;task(s,'UNBLOCK-1','unblock','coordinator','Согласовать разблокировку контрагента','order');record(s,'Запрос на разблокировку отправлен согласующему.');break;
      case 'UNBLOCK_APPROVE':
        requireRole(s,'coordinator');if(!s.unblockRequested)fail('Запрос не поступал.');
        if(!s.tasks.some(t=>t.type==='unblock'&&t.status==='В работе')) fail('Сначала примите задачу на разблокировку.');
        s.blocked=false;finishTasks(s,'unblock');record(s,'Контрагент разблокирован согласующим.');break;
      case 'MAX_INVITE':
        requireRole(s,'master');if(!s.event.contact||!s.event.customer||!s.event.phone) fail('Сначала заполните контактное лицо, контрагента и телефон.');
        s.maxInvited=true;record(s,'Учебное приглашение MAX сформировано. Реальное SMS не отправляется.');break;
      case 'MAX_CONSENT': requireRole(s,'coordinator');s.consent=Boolean(a.value);record(s,'Учебный статус согласия MAX обновлён.');break;
      case 'MAX_SEND':
        requireRole(s,'master');if(!s.maxInvited) fail('Сначала пригласите клиента в MAX.');
        if(!s.consent) fail('Отправка заблокирована: отсутствует согласие на обработку персональных данных.');
        record(s,'Сообщение в MAX имитировано, внешний сервис не вызывался.');break;
      case 'RESET':return initialState(a.mode||current.mode);
      default: fail('Неизвестное действие: '+a.type);
    }
    return s;
  }
  function evaluate(s){
    const checks=[
      {title:'Событие создано и проведено',ok:s.event.status==='Проведён'},
      {title:'Заявка на ремонт',ok:!!s.request},
      {title:'Заказ-наряд',ok:!!s.order},
      {title:'Дефектовка и автоматическая КП',ok:!!s.order?.defectFinished && !!s.kp},
      {title:'Проценка запасных частей ОЗЧ',ok:s.tasks.some(t=>t.type==='price'&&t.status==='Завершена')},
      {title:'Согласование КП с клиентом',ok:!!s.kp?.approvalNote},
      {title:'Закрытие заказ-наряда',ok:s.finished},
      {title:'Нет незавершённых задач',ok:s.tasks.every(t=>t.status==='Завершена')}
    ];
    return {checks,passed:checks.filter(x=>x.ok).length,total:checks.length,percent:Math.round(checks.filter(x=>x.ok).length/checks.length*100)};
  }
  return {initialState,dispatch,evaluate,totals,ROLE,ROLE_TABS,CAUSES,WORKS,PARTS,MODES};
});

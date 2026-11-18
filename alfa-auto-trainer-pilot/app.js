/* Интерактивное отображение учебного движка: без внешних библиотек и запросов к серверу. */
(function(){
'use strict';
const E=window.TrainerEngine;
const STORE='aa6_training_v1';
let state;try {const saved=JSON.parse(localStorage.getItem(STORE)||'null');state=saved?.version===1?saved:E.initialState();}catch{state=E.initialState();}
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
const fmt=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₽';
const badge=(t,css='')=>`<span class="tag ${css}">${esc(t)}</span>`;
const btn=(label,act,css='',extra='')=>`<button type="button" class="btn ${css}" data-act="${esc(act)}" ${extra}>${esc(label)}</button>`;
const field=(label,name,value,required=false,kind='text')=>`<div class="form-field ${required?'required':''}"><label for="event-${name}">${esc(label)}</label><input type="${kind}" id="event-${name}" data-field="${name}" autocomplete="off" value="${esc(value)}"></div>`;
const options=(arr,selected,blank='Выберите')=>`<option value="">${esc(blank)}</option>`+arr.map(x=>`<option value="${esc(x)}" ${selected===x?'selected':''}>${esc(x)}</option>`).join('');
const h=(title,subtitle='')=>`<h1 class="page-title">${esc(title)}</h1>${subtitle?`<div class="page-subtitle">${esc(subtitle)}</div>`:''}`;
const bar=html=>`<div class="toolbar">${html}</div>`;
const table=(headers,rows)=>`<div class="table-wrap"><table><thead><tr>${headers.map(x=>`<th>${esc(x)}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.join(''):`<tr><td class="table-empty" colspan="${headers.length}">Строк пока нет — добавьте нужные позиции</td></tr>`}</tbody></table></div>`;
const navLabels={desktop:'Рабочий стол',event:'Событие',request:'Заявка на ремонт',order:'Заказ-наряд',estimate:'Калькуляция',tasks:'Задачи CRM',communications:'MAX',results:'Результаты'};
const getNext=()=>{
  if(state.event.status==='Черновик')return 'Заполните и запишите документ «Событие». Поле «Договорённость с клиентом» не должно оставаться пустым.';
  if(!state.request)return 'Создайте заявку на ремонт из записанного события.';
  if(state.event.status!=='Проведён')return 'Проведите документ «Событие» после создания документа сделки.';
  if(!state.order)return 'Создайте заказ-наряд по заявке. При блокировке контрагента запросите согласование.';
  if(!state.order.defectFinished)return 'Переключитесь на роль «Исполнитель», примите задачу и завершите дефектовку.';
  if(state.kp?.status==='Подготовка')return 'Мастеру: примите задачу подготовки КП, добавьте автоработы и товары и передайте на проценку ОЗЧ.';
  if(state.kp?.status==='Проценка ОЗЧ')return 'Сотруднику ОЗЧ: примите задачу, установите стоимость товаров, затем переведите КП в «Согласование».';
  if(state.kp?.status==='Согласование')return 'Мастеру: примите задачу согласования, отметьте все позиции, укажите результат переговоров.';
  if(!state.finished)return 'Мастеру: после согласования закройте заказ-наряд.';
  return 'Сценарий завершён. Откройте «Результаты» и изучите критерии проверки.';
};
function toast(message,error=false){const t=$('toast');t.textContent=message;t.className='toast show'+(error?' error':'');window.clearTimeout(toast.timer);toast.timer=window.setTimeout(()=>t.className='toast',4100);}
function save(){localStorage.setItem(STORE,JSON.stringify(state));}
function perform(action){try{state=E.dispatch(state,action);save();render();const a=state.notifications[0];if(a)toast(a);return true;}catch(e){if(state.mode==='Экзамен'){state.score=Math.max(0,state.score-3);save();}toast(e.message,true);renderSide();return false;}}
function renderNav(){const nav=E.ROLE_TABS[state.role];$('nav').innerHTML=nav.map(id=>`<button class="nav-button ${state.screen===id?'active':''}" data-act="SHOW" data-value="${id}">${navLabels[id]}</button>`).join('');
$('role-picker').innerHTML=Object.entries(E.ROLE).map(([key,value])=>`<option value="${key}" ${key===state.role?'selected':''}>${value}</option>`).join('');
$('mode-picker').innerHTML=E.MODES.map(v=>`<option value="${v}" ${v===state.mode?'selected':''}>${v}</option>`).join('');}
function renderSide(){
  const open=state.tasks.filter(t=>t.owner===state.role&&t.status!=='Завершена');
  $('sidebar-content').innerHTML=`${Object.entries({desktop:'Мои задачи',tasks:'Все задачи CRM',event:'Документ «Событие»',estimate:'Калькуляция'}).filter(([key])=>E.ROLE_TABS[state.role].includes(key)).map(([key,label])=>`<button class="side-nav" data-act="SHOW" data-value="${key}">${esc(label)}</button>`).join('')}<div class="side-meta">В очереди: <strong>${open.length}</strong></div><div class="side-meta">Роль: ${E.ROLE[state.role]}</div>`;
  $('next-step').innerHTML=`<div class="hint"><strong>Следующий шаг</strong><div>${esc(getNext())}</div></div>`;
  $('help-content').innerHTML=state.mode==='Обучение'?`<div class="hint muted"><strong>Подсказка режима обучения</strong><div>${esc(helpByScreen())}</div></div>`:`<div class="hint muted">Режим «${esc(state.mode)}»: пошаговые подсказки отключены. Проверяется результат действий в учебном контуре.</div>`;
}
function helpByScreen(){const x={desktop:'Начните с вкладки «Событие». После отработки события переходите к документам сделки.',event:'Контактное лицо и договорённость обязательны. Причина выбирается из списка, а подробный сценарий пишется в договорённость. Для проведения нужен документ продолжения.',request:'Заявку создавайте из записанного события; дата визита обязательна.',order:'ЗН создаётся после заявки. После дефектовки исполнителя появится автоматическая калькуляция.',estimate:'«Проценить» закрывает задачу подготовки и ставит задачу ОЗЧ. Статус «Согласование» закрывает текущий этап.',tasks:'Задача, назначенная группе/роли, должна быть принята перед выполнением. Завершение части задач происходит автоматически.',communications:'Без согласия на обработку персональных данных отправка из учебного MAX блокируется.',results:'Отчёт показывает итоговое состояние документов, а не только нажатия на кнопки.'};return x[state.screen]||'';}
function dashboard(){const active=state.tasks.filter(t=>t.owner===state.role&&t.status!=='Завершена');return h('Рабочий стол первой линии CRM','Организация: ЕвроАзия-Трак · Демонстрационная БЕ')+
`<div class="dashboard-grid"><div class="dashboard-card"><h3>Не разобранное</h3><strong>${active.length}</strong><small>Задачи текущей роли</small></div><div class="dashboard-card"><h3>Подготовка к визиту</h3><strong>${state.request?'1':'0'}</strong><small>${state.request?'Заявка '+state.request.id:'Заявок пока нет'}</small></div><div class="dashboard-card"><h3>Сделка</h3><strong>${state.order?'1':'0'}</strong><small>${state.order?'ЗН '+state.order.status:'ЗН не создан'}</small></div></div>`+
`<div class="tabs"><span class="active">Текущие задачи</span><span>Сделки</span><span>Обращения</span></div>`+
bar(btn('Открыть мои задачи','SHOW','primary','data-value="tasks"')+ (E.ROLE_TABS[state.role].includes('event')?btn('Создать событие','SHOW','','data-value="event"'):'') )+
 table(['Задача','Ответственный','Состояние','Открыть'],active.map(t=>`<tr><td>${esc(t.title)}</td><td>${esc(E.ROLE[t.owner])}</td><td>${badge(t.status)}</td><td>${btn('Открыть','SHOW','','data-value="tasks"')}</td></tr>`))+
`<div class="notification warning">Упражнение построено на синтетических данных. Не вводите сведения реальных клиентов и не используйте этот экран для проведения фактических операций.</div>`;
}
function eventView(){const e=state.event;return h('Событие '+e.id+' от учебной даты',e.type)+bar(btn('Записать','EVENT_SAVE','primary')+btn('Провести и закрыть','EVENT_POST')+btn('Создать заявку на ремонт','SHOW','','data-value="request"'))+
`<div class="doc-header">Состояние: ${badge(e.status,e.status==='Проведён'?'done':'warning')} · Ответственный: Мастер-приёмщик · БЕ: ЕАТ</div>`+
`<div class="form-grid">${field('Контактное лицо','contact',e.contact,true)}${field('Телефон','phone',e.phone)}${field('Контрагент','customer',e.customer,true)}${field('Автомобиль','vehicle',e.vehicle)}
<div class="form-field required"><label for="event-reason">Причина обращения</label><select id="event-reason" data-field="reason">${options(E.CAUSES,e.reason)}</select></div>
<div class="form-field"><label for="event-type">Вид обращения</label><select id="event-type" data-field="type">${E.CAUSES.filter(Boolean).slice(0,0).join('')}<option ${e.type==='Входящий звонок'?'selected':''}>Входящий звонок</option><option ${e.type==='Встреча'?'selected':''}>Встреча</option><option ${e.type==='Исходящий звонок'?'selected':''}>Исходящий звонок</option><option ${e.type==='Электронное обращение'?'selected':''}>Электронное обращение</option></select></div>
<div class="form-field required full"><label for="event-agreement">Договорённость с клиентом</label><textarea id="event-agreement" data-field="agreement" placeholder="Укажите жалобу клиента, договорённости, сроки и следующий шаг">${esc(e.agreement)}</textarea></div></div>`+
`<div class="tabs"><span class="active">Основное</span><span>Дерево документов</span><span>Контактные лица</span><span>История обращений</span></div>`+
`<div class="callout">Поле «Причина обращения» содержит только краткую классификацию. Развернутое описание обращения введите самостоятельно в поле «Договорённость с клиентом»; эти сведения переносятся в последующие документы.</div>`+
`<h3>Создание задачи CRM на основании события</h3><div class="form-grid">
<div class="form-field"><label>Ответственный</label><select id="crm-owner"><option value="coordinator">Группа КО</option><option value="master">Мастер-приёмщик</option></select></div>
<div class="form-field"><label>Вид задачи</label><select id="crm-kind"><option>Телефонный звонок</option><option>Напоминание</option></select></div>
<div class="form-field"><label>Тема</label><input id="crm-subject" value="Телефонный звонок клиенту"></div>
<div class="form-field"><label><input id="crm-general" type="checkbox"> Общий вопрос (без согласования даты записи)</label></div>
<div class="form-field"><label>Дата записи предлагаемая</label><input id="crm-proposed" type="date"></div>
<div class="form-field"><label>Дата записи желаемая</label><input id="crm-desired" type="date"></div>
<div class="form-field full"><label>Содержание задачи</label><textarea id="crm-note" placeholder="Опишите, что необходимо сделать ответственному сотруднику"></textarea></div></div>`+
bar(btn('Создать задачу CRM','CREATE_CRM_TASK','primary'))+
`<h3>Отмена нецелевого обращения</h3><div class="form-field"><label>Причина отмены</label><input id="cancel-reason" placeholder="Укажите причину отмены обращения"></div><div style="margin-top:10px">${btn('Отменить событие','EVENT_CANCEL','danger')}</div>`+
 table(['Документ сделки','Номер','Статус'],[
 ...(state.request?[`<tr><td>Заявка на ремонт</td><td>${state.request.id}</td><td>${state.request.status}</td></tr>`]:[]),
 ...(state.order?[`<tr><td>Заказ-наряд</td><td>${state.order.id}</td><td>${state.order.status}</td></tr>`]:[]),
 ...(state.kp?[`<tr><td>Калькуляция</td><td>${state.kp.id}</td><td>${state.kp.status}</td></tr>`]:[])
 ]);
}
function requestView(){return h('Заявка на ремонт',state.request?'Документ '+state.request.id:'Новый документ на основании события')+
bar(!state.request?btn('Записать заявку','CREATE_REQUEST','primary'):badge('Заявка записана','done'))+
`<div class="doc-header">Основание: ${state.event.id} · Контрагент: ${esc(state.event.customer||'не заполнен')} · Автомобиль: ${esc(state.event.vehicle||'не выбран')}</div>`+
`<div class="form-grid"><div class="form-field required"><label for="request-date">Дата и время записи</label><input type="datetime-local" id="request-date" value="${esc(state.request?.date||'')}"></div><div class="form-field"><label>Ответственный</label><input disabled value="Группа приёмки ЕАТ"></div></div>`+
`<div class="callout">В вашей 1С создание и проведение заявки также может запускать уведомление MAX. Здесь связь с внешними сервисами намеренно отключена.</div>`+
(state.request?bar(btn('Открыть заказ-наряд','SHOW','primary','data-value="order"')):'');}
function orderView(){const o=state.order;return h('Заказ-наряд',o?'Документ '+o.id:'Новый документ')+
bar(!o?btn('Создать заказ-наряд','CREATE_ORDER','primary'):(state.role==='mechanic'?btn('Завершить дефектовку','FINISH_DEFECT','primary'):state.role==='master'?btn('Закрыть ЗН','FINISH_ORDER','primary'):''))+
`<div class="doc-header">Контрагент: ${esc(state.event.customer||'не заполнен')} · Автомобиль: ${esc(state.event.vehicle||'не выбран')} · Состояние: ${badge(o?.status||'Не создан',o?.status?.startsWith('Закрыт')?'done':'warning')}</div>`+
(state.blocked?`<div class="notification warning">Финансовая блокировка контрагента. Запросите согласование из вкладки «Разблокировка».</div>`:'')+
`<div class="tabs"><span class="active">Основное</span><span>Автоработы</span><span>Товары</span><span>Разблокировка</span><span>Дерево документов</span></div>`+
bar(btn('Отправить запрос на разблокировку','UNBLOCK_REQUEST'))+
`<div class="pills"><span class="pill">Дефектовка: ${o?.defectFinished?'завершена':'ожидается'}</span><span class="pill">КП: ${esc(state.kp?.status||'отсутствует')}</span><span class="pill">Блокировка: ${state.blocked?'есть':'нет'}</span></div>`+
 table(['Авторабота','Количество','Цена','Сумма'],(o?.works||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${fmt(x.price)}</td><td>${fmt(x.price*x.qty)}</td></tr>`))+
 table(['Товар','Количество','Цена','Сумма'],(o?.parts||[]).map(x=>`<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${fmt(x.price)}</td><td>${fmt(x.price*x.qty)}</td></tr>`));}
function taskList(){return h('Задачи CRM','Все задачи учебной сделки по ролям')+
(state.role==='coordinator'?bar(btn('Включить блокировку','BLOCK','danger')+btn('Согласовать разблокировку','UNBLOCK_APPROVE','primary')+btn('Согласие MAX: да','MAX_CONSENT','','data-value="true"')+btn('Согласие MAX: нет','MAX_CONSENT','','data-value="false"')):'')+
`<div class="pills"><span class="pill">Новые: ${state.tasks.filter(x=>x.status==='Новая').length}</span><span class="pill">В работе: ${state.tasks.filter(x=>x.status==='В работе').length}</span><span class="pill">Завершены: ${state.tasks.filter(x=>x.status==='Завершена').length}</span></div>`+
`<div class="tasks">${state.tasks.length?state.tasks.map(t=>`<article class="task-card ${t.status==='Завершена'?'complete':''}"><h4>${esc(t.title)}</h4><div>Ответственный: ${esc(E.ROLE[t.owner])} · ${badge(t.status,t.status==='Завершена'?'done':'new')}</div><p>Предмет: ${esc(t.target==='estimate'?state.kp?.id:t.target==='order'?state.order?.id:'Документ')}</p>${t.owner===state.role&&t.status==='Новая'?btn('Принять к исполнению','TAKE_TASK','primary',`data-id="${t.id}"`):''}${t.status==='В работе'&&t.owner===state.role&&['manual','followup'].includes(t.type)?`<div class="form-field"><label>Результат выполнения</label><textarea id="task-result-${esc(t.id)}" placeholder="Укажите фактический результат и договорённости"></textarea></div>${btn('Завершить с результатом','COMPLETE_CRM_TASK','primary',`data-id="${esc(t.id)}"`)}`:''}
${t.status==='В работе'&&t.owner===state.role&&t.type==='control'?`<div class="form-field"><label>Комментарий координатора</label><textarea id="control-note" placeholder="Причина возврата на доработку"></textarea></div>${btn('Подтвердить отмену','REVIEW_CANCEL','',`data-decision="approve"`)}${btn('Вернуть в работу','REVIEW_CANCEL','primary',`data-decision="return"`)}`:''}
${t.status==='В работе'&&!['manual','followup','control'].includes(t.type)?`<span class="mini">Задача выполняется ответственным сотрудником; закроется при переходе документа в следующий статус.</span>`:''}</article>`).join(''):`<div class="callout">Задач ещё нет. По сценарию они появятся при создании ЗН и завершении дефектовки.</div>`}</div>`;
}
function selectAdd(items,kind){return `<div class="toolbar"><select id="new-${kind}" class="inline-control"><option value="">${kind==='work'?'Выберите автоработу':'Выберите товар'}</option>${items.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select>${btn('Добавить','ADD_'+(kind==='work'?'WORK':'PART'),'primary',`data-select="new-${kind}"`)}</div>`;}
function flagSelect(x,kind){const enabled=state.kp?.status==='Согласование'&&state.role==='master';return `<select class="flag-select" data-kind="${kind}" data-id="${esc(x.id)}" ${enabled?'':'disabled'}>${['нет','Согласован','Рекомендация','Деталь клиента','Не согласован'].map(v=>`<option ${x.flag===v?'selected':''} value="${esc(v)}">${esc(v==='нет'?'—':v)}</option>`).join('')}</select>`;}
function estimateView(){const kp=state.kp;if(!kp)return h('Калькуляция','Автоматическая КП появится после дефектовки')+`<div class="callout">Откройте заказ-наряд исполнителем и завершите задачу дефектовки.</div>`;
const canAdd=(state.role==='master'&&kp.status==='Подготовка')||(state.role==='parts'&&kp.status==='Проценка ОЗЧ');
return h('Калькуляция '+kp.id,'Автоматическая из сообщения о завершении дефектовки')+
bar(badge(kp.status,kp.status==='Согласование'?'warning':'new')+(state.role==='master'?btn('Проценить','PRICE_REQUEST'): '')+btn('Статус: Согласование','KP_TO_AGREEMENT','primary'))+
`<div class="doc-header">Заказчик: ${esc(state.event.customer)} · Автомобиль: ${esc(state.event.vehicle)} · ЗН: ${esc(state.order?.id)} · Тип: ${esc(kp.createdBy)}</div>`+
`<div class="tabs"><span class="active">Автоработы (${kp.works.length})</span><span>Товары (${kp.parts.length})</span><span>Рекомендации</span><span>Калькуляция по сделке</span></div>`+
`<h3>Автоработы</h3>`+(canAdd&&state.role==='master'?selectAdd(E.WORKS,'work'):'')+
 table(['Авторабота','Количество','Норма, ч','Цена','Сумма','Решение клиента'],kp.works.map(x=>`<tr><td>${esc(x.name)}</td><td>${x.qty}</td><td>${x.norm}</td><td>${fmt(x.price)}</td><td>${fmt(x.price*x.qty)}</td><td>${flagSelect(x,'works')}</td></tr>`))+
`<h3>Товары</h3>`+(canAdd?selectAdd(E.PARTS,'part'):'')+
 table(['Артикул','Номенклатура','Остаток','Количество','Цена','Поставщик','Решение клиента'],kp.parts.map(x=>`<tr><td>${esc(x.article)}</td><td>${esc(x.name)}</td><td>${x.stock}</td><td>${x.qty}</td><td>${state.role==='parts'&&kp.status==='Проценка ОЗЧ'?`<input class="price-field" type="number" min="1" step="1" id="price-${esc(x.id)}" value="${x.price||''}">`:fmt(x.price)}</td><td>${state.role==='parts'&&kp.status==='Проценка ОЗЧ'?`<input class="price-field" id="supplier-${esc(x.id)}" value="${esc(x.supplier)}" placeholder="Поставщик"> ${btn('Применить','SET_PRICE','',`data-id="${esc(x.id)}"`)}`:esc(x.supplier||'—')}</td><td>${flagSelect(x,'parts')}</td></tr>`))+
`<div class="summary-bar">Итого калькуляция: <strong>${fmt(E.totals(kp))}</strong></div>`+
(kp.status==='Согласование'&&state.role==='master'?`<h3>Результат согласования с клиентом</h3><div class="form-field required"><label for="approval-note">Комментарий в задаче</label><textarea id="approval-note" class="note-field" placeholder="Клиент согласовал замену колодок. Срок ремонта и стоимость подтверждены.">${esc(kp.approvalNote)}</textarea></div><div class="toolbar" style="margin-top:12px">${btn('Завершить согласование','KP_AGREED','primary')}</div>`:'');}
function communicationView(){return h('Мессенджер MAX','Учебная имитация без подключения к внешнему сервису')+
bar(btn('Пригласить клиента','MAX_INVITE','primary')+btn('Отправить учебное сообщение','MAX_SEND'))+
`<div class="doc-header">Контрагент: ${esc(state.event.customer||'—')} · Контакт: ${esc(state.event.contact||'—')} · Телефон: ${esc(state.event.phone||'—')}</div>`+
`<div class="notification ${state.consent?'':'warning'}">Приглашение: ${state.maxInvited?'сформировано':'не отправлено'} · Согласие на обработку ПД: ${state.consent?'получено':'отсутствует'}. В обучении статус согласия изменяет координатор.</div>`+
`<div class="callout">В вашей конфигурации без действующего согласия сотрудник не может направлять клиенту сообщения через MAX. В тренажёре проверяется именно эта блокировка; фактические сообщения не отправляются.</div>`;}
function resultView(){const ev=E.evaluate(state);return h('Результаты прохождения','Проверка последовательно созданных документов и задач')+
`<div class="result-number">${ev.percent}%</div><p class="page-subtitle">Выполнено ${ev.passed} из ${ev.total} контрольных условий · Режим: ${esc(state.mode)}${state.mode==='Экзамен'?' · Баллы за ошибки: '+state.score:''}</p>`+
ev.checks.map(x=>`<div class="result-check"><span class="${x.ok?'yes':'no'}">${x.ok?'✓':'○'}</span><span>${esc(x.title)}</span></div>`).join('')+
bar(btn('Выгрузить результат JSON','EXPORT','primary')+btn('Начать заново','RESET'))+
`<h3>Журнал учебных действий</h3><div class="timeline">${state.history.slice().reverse().map(h=>`<div class="timeline-entry">Шаг ${h.at}: ${esc(h.text)}</div>`).join('')||'<div>Действий пока нет</div>'}</div>`;
}
function render(){renderNav();renderSide();let view;switch(state.screen){case 'event':view=eventView();break;case 'request':view=requestView();break;case 'order':view=orderView();break;case 'tasks':view=taskList();break;case 'estimate':view=estimateView();break;case 'communications':view=communicationView();break;case 'results':view=resultView();break;default:view=dashboard();} $('main-content').innerHTML=view;}
function exportReport(){const data={product:'AA6 training v1',generated:new Date().toISOString(),role:E.ROLE[state.role],mode:state.mode,score:state.score,evaluation:E.evaluate(state),state};const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='alfa-auto-training-result.json';a.click();URL.revokeObjectURL(url);toast('Отчёт сформирован и сохранён.');}
window.addEventListener('click',event=>{
  const target=event.target.closest('[data-act]');if(!target)return;
  const act=target.dataset.act;
  if(act==='RESET'){if(window.confirm('Начать новый сценарий? Текущий прогресс будет сброшен.'))perform({type:'RESET'});return;}
  if(act==='EXPORT'){exportReport();return;}
  if(['SHOW','TAKE_TASK'].includes(act)){perform({type:act,value:target.dataset.value,id:target.dataset.id});return;}
  if(['ADD_WORK','ADD_PART'].includes(act)){perform({type:act,id:$(target.dataset.select)?.value});return;}
  if(act==='CREATE_REQUEST'){perform({type:act,date:$('request-date')?.value});return;}
  if(act==='SET_PRICE'){perform({type:act,id:target.dataset.id,price:$('price-'+target.dataset.id)?.value,supplier:$('supplier-'+target.dataset.id)?.value});return;}
  if(act==='KP_AGREED'){perform({type:act,note:$('approval-note')?.value});return;}
  if(act==='CREATE_CRM_TASK'){perform({type:act,owner:$('crm-owner')?.value,kind:$('crm-kind')?.value,subject:$('crm-subject')?.value,note:$('crm-note')?.value,general:$('crm-general')?.checked,proposed:$('crm-proposed')?.value,desired:$('crm-desired')?.value});return;}
  if(act==='EVENT_CANCEL'){perform({type:act,reason:$('cancel-reason')?.value});return;}
  if(act==='COMPLETE_CRM_TASK'){perform({type:act,id:target.dataset.id,result:$('task-result-'+target.dataset.id)?.value});return;}
  if(act==='REVIEW_CANCEL'){perform({type:act,decision:target.dataset.decision,note:$('control-note')?.value});return;}
  if(act==='MAX_CONSENT'){perform({type:act,value:target.dataset.value==='true'});return;}
  perform({type:act});
});
window.addEventListener('change',event=>{
  if(event.target.id==='role-picker'){perform({type:'SET_ROLE',value:event.target.value});return;}
  if(event.target.id==='mode-picker'){perform({type:'SET_MODE',value:event.target.value});return;}
  if(event.target.matches('[data-field]')){
    try{state=E.dispatch(state,{type:'EVENT_FIELD',field:event.target.dataset.field,value:event.target.value});save();}catch(e){toast(e.message,true);}return;
  }
  if(event.target.matches('.flag-select')){
    const a={type:'ITEM_FLAG',kind:event.target.dataset.kind,id:event.target.dataset.id,flag:event.target.value};
    try{state=E.dispatch(state,a);save();}catch(e){toast(e.message,true);}return;
  }
});
$('reset-btn').addEventListener('click',()=>{if(window.confirm('Удалить текущий прогресс и начать новый учебный сценарий?'))perform({type:'RESET'});});
render();
})();

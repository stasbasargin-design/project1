/* Explicit review mode only, loaded by preview.html. Never forwards requests to 1C. */
(function(){
  window.ITUS_REVIEW_MODE = true;
  const role = new URLSearchParams(location.search).get('role') || 'master';
  const allowedRole = ['master','executor','tech'].includes(role) ? role : 'master';
  window.__ITUS_API_BASE__ = '/review-api';
  window.WebApp = {ready(){},expand(){},platform:'review',user:{id:'900000001'}};
  const messages = [{id:'m1',authorName:'Тестовый клиент',text:'Здравствуйте! Фото прикреплено.',createdAt:'2026-09-24T14:10:15+05:00'},
    {id:'m2',authorName:'Имя из истории',text:'Проверка имени текущего сотрудника',direction:'outgoing',createdAt:'2026-09-24T09:12:18Z'}];
  const events = ['new_messages','executor_assigned','quality_control_requested'].map((type,i)=>({eventId:'review-'+i,type,title:'Проверочное уведомление',message:type,orderRef:'review-order',payload:{unreadCount:3}}));
  let poll = 0;
  window.fetch = async (url,options={}) => {
    const method = String(url).replace('/review-api','');
    let body={};try {body=JSON.parse(options.body || '{}');}catch{}
    let data = {};
    if(method === '/auth/max') data = {name:'Тестовый сотрудник ИТУС',role:allowedRole,roleName:{master:'Мастер-приёмщик',executor:'Исполнитель',tech:'Технолог'}[allowedRole],availableTabs:['orders','mp','executor','tech','clients','chat']};
    else if(method === '/orders/list') data={orders:[]};
    else if(method === '/notifications/poll') data={events:poll++ ? []:events,unreadMessagesCount:3,nextCursor:'review-1'};
    else if(method === '/internal-chat/contacts/list') data={contacts:[{employeeRef:'employee-2',name:'Петрова Анна',authorized:true},{employeeRef:'employee-3',name:'Неавторизованный',authorized:false}]};
    else if(method === '/internal-chat/direct/open') data={groupRef:'direct-'+body.employeeRef};
    else if(method.endsWith('/topics/list') || method.endsWith('/groups/list')) data={topics:[{topicRef:'review-topic',title:'Тестовый клиент',unreadCount:3}],groups:[{groupRef:'review-group',title:'Передача смены',subtitle:'Все внутренние пользователи',unreadCount:2}]};
    else if(method.endsWith('/messages/read')) data={read:true,unreadCount:0};
    else if(method.endsWith('/messages/list')) data={messages};
    else if(method.endsWith('/messages/send') || method.endsWith('/files/send')) {
      messages.push({id:String(Date.now()),direction:'outgoing',text:body.text || 'Файл сохранён только в проверочной памяти',createdAt:new Date().toISOString(),attachments:body.file?[body.file]:[]});
    } else return new Response(JSON.stringify({success:false,error:{message:'Этот сценарий не имитируется. Для проверки с 1С откройте обычную версию.'}}),{status:422});
    return new Response(JSON.stringify({success:true,data}),{headers:{'Content-Type':'application/json'}});
  };
})();

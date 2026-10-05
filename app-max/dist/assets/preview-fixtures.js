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
  let reviewUnread = 3;
  let clientUnread = 1;
  const staffGroups = [{groupRef:'review-group',title:'Передача смены',subtitle:'Все внутренние пользователи',unreadCount:2}];
  const staffMessages = new Map([['review-group',[{id:'shift-message',authorName:'Сотрудник смены',text:'Информация по передаче смены.',createdAt:'2026-09-24T09:10:00Z'}]]]);
  let packageData = {packageRef:'review-existing-package',packageNumber:'УРВ-0007',status:'Не стартовал'};
  const created = new Map();
  const reviewOrder = () => ({orderRef:'review-order',orderNumber:'ЗН-УРВ-001',workshopRef:'review-workshop',vehicle:{model:'Тестовый автомобиль',plate:'А001АА'},worktime:packageData || {}});
  window.fetch = async (url,options={}) => {
    const method = String(url).replace('/review-api','');
    let body={};try {body=JSON.parse(options.body || '{}');}catch{}
    let data = {};
    if(method === '/auth/max') data = {employeeRef:'review-self',workshopRef:'review-workshop',name:'Тестовый сотрудник ИТУС',role:allowedRole,roleName:{master:'Мастер-приёмщик',executor:'Исполнитель',tech:'Технолог'}[allowedRole],availableTabs:['orders','mp','executor','tech','clients','chat']};
    else if(method === '/orders/list') data={orders:allowedRole === 'executor' ? [reviewOrder()] : []};
    else if(method === '/orders/get') data={order:reviewOrder()};
    else if(method.startsWith('/worktime/')) {
      try { window.ITUS_WORKTIME.validateRequest(method,body); }
      catch(error) { return new Response(JSON.stringify({success:false,error:{code:'VALIDATION_ERROR',message:error.message}}),{status:400,headers:{'Content-Type':'application/json'}}); }
      if(method === '/worktime/orders/works') data={workshopRef:'review-workshop',works:[{workRef:'review-work-1',name:'Диагностика',available:true},{workRef:'review-work-2',name:'Замена масла',available:true},{workRef:'review-work-3',name:'Работа с активным пакетом',available:true,hasActivePackage:true,activePackageRef:'other-package'}].filter(work => ![...created.values()].some(entry => entry.workRefs.includes(work.workRef) && entry.package.status !== 'Закрыт'))};
      else if(method === '/worktime/packages/list') data={packages:packageData && packageData.status !== 'Закрыт' ? [packageData] : []};
      else if(method === '/worktime/executors/list') data={executors:[{employeeRef:'review-self',name:'Тестовый сотрудник ИТУС',workshopRef:'review-workshop',available:true},{employeeRef:'review-colleague',name:'Петров Алексей',workshopRef:'review-workshop',available:true}]};
      else if(method === '/worktime/participation/validate') data={valid:true};
      else if(method === '/worktime/packages/create') {
        const signature=JSON.stringify([body.workRefs,body.participants,body.orderRef,body.workshopRef]);
        const previous=created.get(body.clientPackageId);
        if(previous && previous.signature!==signature) return new Response(JSON.stringify({success:false,error:{message:'Состав пакета изменён для прежнего ключа создания'}}),{status:409});
        packageData=previous?.package || {packageRef:'review-package-'+(created.size+1),status:'Создан'};
        created.set(body.clientPackageId,{signature,package:packageData,workRefs:[...body.workRefs]}); data={package:packageData};
      } else if(['/worktime/packages/start','/worktime/packages/pause','/worktime/packages/close'].includes(method)) {
        if(!packageData || packageData.packageRef!==body.packageRef) return new Response(JSON.stringify({success:false,error:{message:'Пакет не найден'}}),{status:404});
        packageData.status=method.endsWith('/start')?'В работе':method.endsWith('/pause')?'Перерыв':'Закрыт';data={package:packageData};
      } else return new Response(JSON.stringify({success:false,error:{message:'Метод не имитируется'}}),{status:404});
    }
    else if(method === '/notifications/poll') data={events:poll++ ? []:events,unreadMessagesCount:reviewUnread,nextCursor:'review-1'};
    else if(method === '/internal-chat/contacts/list') data={contacts:[{employeeRef:'employee-2',name:'Петрова Анна',authorized:true},{employeeRef:'employee-3',name:'Неавторизованный',authorized:false}]};
    else if(method === '/internal-chat/direct/open') {
      const ref='direct-'+body.employeeRef;
      if(!staffGroups.some(group=>group.groupRef===ref)){staffGroups.push({groupRef:ref,title:'Петрова Анна',unreadCount:0});staffMessages.set(ref,[]);}
      data={groupRef:ref};
    }
    else if(method.endsWith('/topics/list') || method.endsWith('/groups/list')) data={topics:[{topicRef:'review-topic',title:'Тестовый клиент',unreadCount:clientUnread}],groups:staffGroups};
    else if(method.endsWith('/messages/read')) {if(method.startsWith('/clients/'))clientUnread=0;else {const group=staffGroups.find(x=>x.groupRef===body.groupRef);if(group)group.unreadCount=0;}reviewUnread=clientUnread+staffGroups.reduce((n,x)=>n+x.unreadCount,0);data={read:true,unreadCount:0,unreadMessagesCount:reviewUnread};}
    else if(method.endsWith('/messages/list')) data={messages:method.startsWith('/internal-chat/')?(staffMessages.get(body.groupRef)||[]):messages};
    else if(method.endsWith('/messages/send') || method.endsWith('/files/send') || method.endsWith('/polls/send')) {
      const targetMessages=method.startsWith('/internal-chat/')?(staffMessages.get(body.groupRef)||[]):messages;
      targetMessages.push({id:String(Date.now()),direction:'outgoing',text:body.text || '',poll:body.poll,createdAt:new Date().toISOString(),attachments:body.file?[body.file]:[]});
    } else if(method.endsWith('/polls/vote')) {
      data={saved:true,messageRef:body.messageRef,option:body.option};
    } else return new Response(JSON.stringify({success:false,error:{message:'Этот сценарий не имитируется. Для проверки с 1С откройте обычную версию.'}}),{status:422});
    return new Response(JSON.stringify({success:true,data}),{headers:{'Content-Type':'application/json'}});
  };
})();

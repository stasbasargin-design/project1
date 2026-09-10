(function (root) {
  'use strict';

  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const asArray = value => Array.isArray(value) ? value : [];
  const text = (value, fallback = '') => {
    if (value === null || value === undefined) return fallback;
    return ['string', 'number', 'boolean'].includes(typeof value) ? String(value) : fallback;
  };
  const bool = (value, fallback = false) => value === undefined || value === null ? fallback : Boolean(value);

  function normalizeUser(value) {
    if (Array.isArray(value)) return Object.assign({}, ...value.filter(isObject));
    return isObject(value) ? value : null;
  }

  function extractOrders(response) {
    const candidates = [
      response?.data?.orders, response?.data?.items, response?.orders, response?.items,
      Array.isArray(response?.data) ? response.data : null
    ];
    return candidates.find(Array.isArray) || [];
  }

  function extractItems(response, keys = []) {
    for (const key of keys) {
      if (Array.isArray(response?.[key])) return response[key];
      if (Array.isArray(response?.data?.[key])) return response.data[key];
    }
    return [response?.data?.items, response?.items, Array.isArray(response?.data) ? response.data : null].find(Array.isArray) || [];
  }

  function normalizeDefects(value) {
    return asArray(value).map((item, index) => {
      if (typeof item === 'string') return { id: String(index), text: item, type: 'text' };
      return {
        id: text(item?.entryRef || item?.defectRef || item?.id, String(index)),
        type: text(item?.type, 'text'),
        text: text(item?.text || item?.description || item?.title),
        createdAt: text(item?.createdAt || item?.date),
        author: text(item?.authorName || item?.author),
        file: normalizeFile(item?.file || item?.media),
        transcript: text(item?.transcript)
      };
    });
  }

  function normalizeMedia(value) {
    return asArray(value).map(normalizeFile).filter(Boolean);
  }

  function normalizeFile(value) {
    if (!value) return null;
    if (typeof value === 'string') return { fileRef: value, fileName: value };
    if (!isObject(value)) return null;
    return {
      fileRef: text(value.fileRef || value.ref || value.id),
      fileName: text(value.fileName || value.name, 'Файл'),
      mimeType: text(value.mimeType || value.contentType),
      sizeBytes: Number(value.sizeBytes || value.size || 0),
      contentBase64: text(value.contentBase64 || value.base64),
      downloadUrl: text(value.downloadUrl || value.url)
    };
  }

  function mapOrder(source) {
    const x = isObject(source) ? source : {};
    const status = isObject(x.status) ? x.status : {};
    const client = isObject(x.client) ? x.client : {};
    const counterparty = isObject(x.counterparty) ? x.counterparty : {};
    const contact = isObject(x.contact) ? x.contact : {};
    const vehicle = isObject(x.vehicle) ? x.vehicle : {};
    const executor = isObject(x.executor) ? x.executor : {};
    const post = isObject(x.post) ? x.post : {};
    const worktime = isObject(x.worktime) ? x.worktime : {};
    const unread = isObject(x.unread) ? x.unread : {};
    const counters = isObject(x.counters) ? x.counters : {};
    const id = text(x.orderRef || x.ref || x.orderId || x.id || x.orderNumber || x.number);
    return {
      id,
      orderRef: text(x.orderRef || x.ref || x.orderId || x.id, id),
      num: text(x.orderNumber || x.number || x.num, '—'),
      orderDate: text(x.orderDate || x.date),
      car: text(vehicle.model || vehicle.name || x.vehicleModel || x.vehicleName || x.car, '—'),
      vehicleRef: text(vehicle.vehicleRef || vehicle.ref || x.vehicleRef),
      plate: text(vehicle.plate || vehicle.stateNumber || x.vehiclePlate || x.plate, '—'),
      vin: text(vehicle.vin || x.vin),
      status: text(status.title || status.name || x.statusTitle || (typeof x.status === 'string' ? x.status : '') || status.code, '—'),
      statusCode: text(status.code || x.statusCode),
      clientRef: text(client.counterpartyRef || counterparty.ref || x.counterpartyRef || x.clientRef),
      client: text(client.name || counterparty.name || (typeof x.client === 'string' ? x.client : '') || x.counterpartyName, '—'),
      contactRef: text(contact.contactRef || contact.ref || x.contactRef),
      contact: text(contact.name || (typeof x.contact === 'string' ? x.contact : '') || x.contactName),
      phone: text(contact.phone || x.contactPhone || x.phone),
      mileage: text(x.mileage || x.odometer),
      engineHours: text(x.engineHours || x.hours),
      reason: text(x.reason || x.appealText || x.description),
      executor: text(executor.name || (typeof x.executor === 'string' ? x.executor : '') || x.executorName, 'Не назначен'),
      executorRef: text(executor.employeeRef || executor.ref || x.executorRef),
      post: text(post.title || post.name || (typeof x.post === 'string' ? x.post : '') || x.workPost, 'Не выбран'),
      postRef: text(post.postRef || post.ref || x.postRef),
      packageRef: text(worktime.packageRef || x.packageRef),
      packageStatus: text(worktime.status || x.packageStatus || x.package, 'Не создан'),
      defectDocumentRef: text(x.defectDocumentRef || x.defectSheetRef || x.defectSheet?.documentRef || x.defectSheet?.ref || x.defectSheet?.document?.ref),
      defects: normalizeDefects(x.defects || x.defectEntries),
      media: normalizeMedia(x.media || x.files || x.photos),
      clientTopicRef: text(x.clientTopicRef || x.topicRef || x.topicId),
      unread: {
        client: Number(unread.clientMessages || unread.client || 0),
        internal: Number(unread.internalMessages || unread.internal || 0)
      },
      counters: {
        defects: Number(counters.defects || 0),
        documents: Number(counters.documents || 0),
        media: Number(counters.media || 0)
      },
      updatedAt: text(x.updatedAt)
    };
  }

  function normalizeOption(value, index) {
    if (isObject(value)) return { value: text(value.value || value.code || value.id, String(index)), label: text(value.label || value.title || value.name || value.value, String(index)) };
    return { value: text(value), label: text(value) };
  }

  function normalizeField(value, index) {
    const x = isObject(value) ? value : {};
    const type = text(x.type || x.valueType, 'text').toLowerCase();
    return {
      id: text(x.id || x.code || x.name, `field_${index}`),
      label: text(x.label || x.title || x.text || x.name, `Поле ${index + 1}`),
      type: ['text','textarea','number','date','time','datetime-local','select','tel','email'].includes(type) ? type : 'text',
      required: bool(x.required, false),
      placeholder: text(x.placeholder),
      unit: text(x.unit),
      value: x.value ?? x.defaultValue ?? '',
      options: asArray(x.options || x.answers || x.values).map(normalizeOption)
    };
  }

  function normalizeForm(value) {
    const x = isObject(value) ? value : {};
    return {
      title: text(x.title),
      hint: text(x.hint || x.description),
      fields: asArray(x.fields).map(normalizeField)
    };
  }

  function normalizeQuestion(value, index) {
    const x = isObject(value) ? value : {};
    let type = text(x.type || x.answerType, 'single').toLowerCase();
    if (type === 'radio') type = 'single';
    if (type === 'checkbox') type = 'multi';
    if (!['single','multi','text','textarea','number','boolean','select'].includes(type)) type = 'single';
    return {
      id: text(x.id || x.code || x.questionRef, `question_${index}`),
      text: text(x.text || x.title || x.question, `Вопрос ${index + 1}`),
      type,
      required: bool(x.required, true),
      hint: text(x.hint || x.description),
      options: asArray(x.options || x.answers || x.values).map(normalizeOption)
    };
  }

  function normalizeSurvey(value) {
    const x = isObject(value) ? value : {};
    return {
      surveyRef: text(x.surveyRef || x.ref || x.id),
      version: text(x.version),
      title: text(x.title, 'Анкета'),
      hint: text(x.hint || x.description),
      questions: asArray(x.questions || x.items).map(normalizeQuestion)
    };
  }

  function normalizeProcess(response, key) {
    const data = response?.data || response || {};
    const x = data?.[key] || data?.process || data;
    const document = x?.document || data?.document || {};
    return {
      ...(key === 'acceptance' ? { photo: { required: bool(x?.photo?.required, true) } } : {}),
      active: true,
      documentRef: text(x?.documentRef || document?.documentRef || document?.ref || data?.documentRef),
      status: text(x?.status || document?.status, 'created'),
      form: normalizeForm(x?.form || data?.form),
      survey: normalizeSurvey(x?.survey || data?.survey),
      values: isObject(x?.values) ? x.values : {},
      answers: isObject(x?.answers) ? x.answers : {},
      entries: normalizeDefects(x?.entries || data?.entries)
    };
  }

  function normalizeResource(value, index) {
    const x = isObject(value) ? value : {};
    return {
      ref: text(x.ref || x.postRef || x.employeeRef || x.id, String(index)),
      name: text(x.name || x.title || x.fullName, `Элемент ${index + 1}`),
      description: text(x.description || x.schedule || x.role || x.businessUnit),
      planned: bool(x.planned, false),
      available: bool(x.available, true)
    };
  }

  function normalizeMessage(value, index) {
    const x = isObject(value) ? value : {};
    const direction = text(x.direction || x.side);
    return {
      id: text(x.messageRef || x.messageId || x.id, String(index)),
      author: text(x.authorName || x.senderName || x.from, 'Система'),
      text: text(x.text || x.message),
      createdAt: text(x.createdAt || x.date || x.time),
      side: direction === 'outgoing' || direction === 'mine' || x.isMine ? 'mine' : (direction === 'system' ? 'system' : 'theirs'),
      attachments: normalizeMedia(x.attachments || x.files),
      status: text(x.status)
    };
  }

  function normalizeTopic(value, index) {
    const x = isObject(value) ? value : {};
    return {
      ref: text(x.topicRef || x.topicId || x.ref || x.id, String(index)),
      title: text(x.title || x.clientName || x.counterpartyName || x.name, `Тема ${index + 1}`),
      subtitle: text(x.subtitle || x.contactName || x.description),
      lastMessage: text(x.lastMessage?.text || x.lastMessage || x.preview),
      unread: Number(x.unreadCount || x.unread || 0),
      orderRef: text(x.orderRef || x.orderId),
      orderNumber: text(x.orderNumber),
      vehiclePlate: text(x.vehiclePlate || x.plate)
    };
  }

  root.ITUS_API = Object.freeze({
    asArray, extractItems, extractOrders, isObject, mapOrder, normalizeFile,
    normalizeForm, normalizeMessage, normalizeOption, normalizeProcess,
    normalizeQuestion, normalizeResource, normalizeSurvey, normalizeTopic,
    normalizeUser, text
  });
})(typeof window !== 'undefined' ? window : globalThis);

import assert from 'node:assert/strict';

await import('../assets/api-normalizers.js');
const api = globalThis.ITUS_API;

const ordersResponse = {
  success: true,
  data: { orders: [{
    orderRef: 'ref-1', orderNumber: 'РИЦ-1',
    status: { code: 'waiting_repair', title: 'Ожидание ремонта' },
    client: { counterpartyRef: 'client-1', name: 'Тестовый клиент' },
    contact: { name: 'Контакт', phone: '+70000000000' },
    vehicle: { vehicleRef: 'vehicle-1', model: 'Модель', plate: 'А000АА', vin: 'VIN' },
    executor: { employeeRef: 'employee-1', name: 'Исполнитель' },
    post: { postRef: 'post-1', title: 'Пост №1' },
    worktime: { packageRef: 'package-1', status: 'В работе' },
    counters: { defects: 2, documents: 1, media: 3 }
  }] }
};

const order = api.mapOrder(api.extractOrders(ordersResponse)[0]);
assert.deepEqual({
  id: order.id, num: order.num, status: order.status, client: order.client,
  car: order.car, executorRef: order.executorRef, postRef: order.postRef,
  packageRef: order.packageRef
}, {
  id: 'ref-1', num: 'РИЦ-1', status: 'Ожидание ремонта', client: 'Тестовый клиент',
  car: 'Модель', executorRef: 'employee-1', postRef: 'post-1', packageRef: 'package-1'
});

const process = api.normalizeProcess({
  success: true,
  data: {
    acceptance: {
      documentRef: 'acceptance-1',
      form: { fields: [{ id: 'mileage', label: 'Пробег', type: 'number', required: true }] },
      survey: { surveyRef: 'survey-1', version: '3', title: 'Анкета', questions: [
        { id: 'body', text: 'Кузов', type: 'single', required: true, options: [
          { value: 'ok', label: 'Без замечаний' }, { value: 'bad', label: 'Есть повреждения' }
        ] }
      ] }
    }
  }
}, 'acceptance');

assert.equal(process.documentRef, 'acceptance-1');
assert.equal(process.form.fields[0].type, 'number');
assert.equal(process.survey.questions[0].options[1].value, 'bad');

assert.deepEqual(api.normalizeUser([{ maxUserId: 1 }, { name: 'Пользователь' }, { role: 'master' }]), { maxUserId: 1, name: 'Пользователь', role: 'master' });

const messages = api.extractItems({ data: { messages: [{ messageId: 'm1', direction: 'outgoing', text: 'Тест' }] } }, ['messages']).map(api.normalizeMessage);
assert.equal(messages[0].side, 'mine');
assert.equal(messages[0].text, 'Тест');

console.log('API normalizers: OK');

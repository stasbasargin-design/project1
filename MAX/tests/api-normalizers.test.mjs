import assert from 'node:assert/strict';
await import('../assets/api-normalizers.js');
const A = globalThis.ITUS_API;
const order = A.mapOrder({
  orderRef: 'R1', orderNumber: 'РИЦ-З22752',
  status: { code: 'waiting_repair', title: 'Ожидание ремонта' },
  client: { counterpartyRef: 'C1', name: 'ООО Клиент' },
  vehicle: { vehicleRef: 'V1', model: 'КАМАЗ 54901', plate: 'А000АА72' },
  unread: { clientMessages: 1, internalMessages: 2 }
});
assert.equal(order.id, 'R1');
assert.equal(order.plate, 'А000АА72');
assert.deepEqual(order.unread, { client: 1, internal: 2 });
assert.equal(A.extractOrders({ data: { orders: [order] } }).length, 1);
assert.equal(A.normalizeMessage({ direction: 'outgoing' }).side, 'mine');
assert.equal(A.normalizeFile('F1').fileRef, 'F1');
console.log('tests: OK');

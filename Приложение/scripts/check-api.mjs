const target = String(
  process.env.ONE_C_TARGET || 'https://1c.eazia.ru/aa6_ea_test9/ru/hs/max-service'
).replace(/\/+$/, '');
const userId = String(process.env.ITUS_USER_ID || '').trim();

await import('../assets/api-normalizers.js');
const normalizers = globalThis.ITUS_API;

if (!userId) {
  console.error('Укажите числовой ID: ITUS_USER_ID=13970179 npm run check:api');
  process.exit(2);
}

async function post(path, body) {
  const response = await fetch(target + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = (await response.text()).replace(/^\uFEFF/, '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, contentType: response.headers.get('content-type') || '', data, text };
}

const authBody = { userId, maxUserId: userId, authId: userId, authMode: 'manual', source: 'ITUS_CHECK' };
const auth = await post('/auth/max', authBody);
const orders = await post('/orders/list', { ...authBody, status: 'active' });
const orderItems = normalizers.extractOrders(orders.data || {});
const mappedOrders = orderItems.map(normalizers.mapOrder);
const mappedFieldsValid = mappedOrders.every((item) =>
  ['id', 'num', 'status', 'client', 'contact', 'car', 'plate', 'executor', 'post']
    .every((key) => typeof item[key] === 'string')
);

console.log(JSON.stringify({
  target,
  auth: {
    status: auth.status,
    success: auth.data?.success === true,
    userShape: Array.isArray(auth.data?.user) ? 'array' : typeof auth.data?.user,
    availableTabs: auth.data?.availableTabs || []
  },
  orders: {
    status: orders.status,
    success: orders.data?.success === true,
    count: Array.isArray(orderItems) ? orderItems.length : 0,
    path: Array.isArray(orders.data?.data?.orders) ? 'data.orders' : 'other',
    mappedFieldsValid
  }
}, null, 2));

if (auth.status !== 200 || orders.status !== 200 || !Array.isArray(orderItems)) process.exit(1);

const target = String(process.env.ONE_C_TARGET || 'https://1c.eazia.ru/aa6_ea_test9/ru/hs/max-service').replace(/\/+$/, '');
const userId = String(process.env.ITUS_USER_ID || '').trim();
const token = String(process.env.ITUS_TOKEN || '').trim();
await import('../assets/api-normalizers.js');
const N = globalThis.ITUS_API;
if (!userId) { console.error('ITUS_USER_ID не задан'); process.exit(2); }
let fails = 0;
const bad = m => { fails++; console.error('✗', m); };
const ok = m => console.log('✓', m);
async function post(path, body, raw = false) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (token) headers['X-ITUS-Token'] = token;
  const r = await fetch(target + path, { method: 'POST', headers, body: raw ? body : JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let data = null; try { data = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, '')); } catch {}
  return { status: r.status, bom: buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF, data };
}
const authBody = { requestId: crypto.randomUUID(), timestamp: new Date().toISOString(), userId, maxUserId: userId, authId: userId, authMode: 'manual', source: 'ITUS_CHECK' };
const auth = await post('/auth/max', authBody);
auth.status === 200 ? ok('/auth/max 200') : bad(`/auth/max ${auth.status}`);
auth.bom ? bad('BOM') : ok('без BOM');
auth.data?.success === true ? ok('commonSuccess') : bad('commonSuccess');
const broken = await post('/orders/list', '{invalid', true);
broken.status === 400 ? ok('битый JSON → 400') : bad(`битый JSON → ${broken.status}`);
const orders = await post('/orders/list', { ...authBody, requestId: crypto.randomUUID(), status: 'active' });
const items = N.extractOrders(orders.data || {}).map(N.mapOrder);
orders.status === 200 ? ok(`/orders/list → ${items.length}`) : bad(`/orders/list ${orders.status}`);
console.log(fails ? `Провалено: ${fails}` : 'Все проверки пройдены');
process.exit(fails ? 1 : 0);

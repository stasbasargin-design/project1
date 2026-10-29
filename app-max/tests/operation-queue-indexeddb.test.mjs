import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {spawn} from 'node:child_process';

const browserCandidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);
const browser = browserCandidates.find(existsSync);

if (!browser) {
  if (process.env.REQUIRE_BROWSER_TESTS === '1' || process.env.CI === 'true') throw new Error('IndexedDB browser regression is required; configure CHROME_PATH.');
  console.log('Operation queue IndexedDB: SKIPPED (set CHROME_PATH to run the browser regression).');
  process.exit(0);
}

const queueSource = readFileSync(new URL('../assets/operation-queue.js', import.meta.url), 'utf8');
const page = `<!doctype html><meta charset="utf-8"><img src="/wait" hidden><pre id="result">RUNNING</pre><script>${queueSource}</script><script>
(async () => {
  const result = document.getElementById('result');
  const expect = (value, message) => { if (!value) throw new Error(message); };
  const removeDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('itus-operation-queue');
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  try {
    await removeDb();
    const make = () => ITUS_OPERATION_QUEUE.create({delays:[0], sender:async () => ({success:true})});
    const original = {id:'restart-entry',scope:'browser',method:'/defects/entries/add',kind:'entry',documentKey:'doc',clientEntryId:'entry-1',requestId:'request-1',body:{documentRef:'doc',clientEntryId:'entry-1',entry:{clientEntryId:'entry-1',file:{fileName:'one.jpg',contentBase64:'original'}}}};
    const first = make();
    const [saved] = await first.prepareBatch([original]);
    const afterRestart = make();
    const [replayed] = await afterRestart.prepareBatch([{...original,requestId:'request-2'}]);
    expect(replayed.requestId === saved.requestId, 'restart changed requestId');
    expect(replayed.clientEntryId === saved.clientEntryId, 'restart changed clientEntryId');
    expect(replayed.body.entry.file.contentBase64 === 'original', 'restart changed content');
    let conflict = false;
    try { await afterRestart.prepareBatch([{...original,body:{...original.body,entry:{...original.body.entry,file:{...original.body.entry.file,contentBase64:'changed'}}}}]); }
    catch (error) { conflict = error && error.code === 'QUEUE_ID_CONFLICT'; }
    expect(conflict, 'changed content was not rejected');
    const concurrent = {id:'concurrent-entry',scope:'browser',method:'/defects/entries/add',kind:'entry',documentKey:'doc',clientEntryId:'entry-2',requestId:'request-3',body:{documentRef:'doc',clientEntryId:'entry-2',entry:{clientEntryId:'entry-2',file:{fileName:'two.jpg',contentBase64:'second'}}}};
    const [left, right] = await Promise.all([make().prepareBatch([concurrent]), make().prepareBatch([concurrent])]);
    expect(left[0].clientEntryId === right[0].clientEntryId, 'concurrent enqueue returned different packages');
    const savedOperations = await make().list('browser');
    expect(savedOperations.length === 2, 'concurrent enqueue created more than one saved package');
    const leased = {id:'leased-entry',scope:'browser',method:'/defects/entries/add',kind:'entry',documentKey:'doc',clientEntryId:'entry-3',requestId:'request-4',body:{documentRef:'doc',clientEntryId:'entry-3',entry:{clientEntryId:'entry-3',file:{fileName:'three.jpg',contentBase64:'third'}}}};
    let releaseFirstSender, firstSenderStarted;
    const firstSenderStartedPromise = new Promise(resolve => { firstSenderStarted = resolve; });
    const firstSenderReleased = new Promise(resolve => { releaseFirstSender = resolve; });
    let firstSenderCalls = 0, secondSenderCalls = 0;
    const firstTab = ITUS_OPERATION_QUEUE.create({delays:[0], sender:async () => { firstSenderCalls++; firstSenderStarted(); await firstSenderReleased; return {success:true}; }});
    const secondTab = ITUS_OPERATION_QUEUE.create({delays:[0], sender:async () => { secondSenderCalls++; return {success:true}; }});
    await firstTab.prepare(leased);
    const firstRun = firstTab.run(leased.id);
    await firstSenderStartedPromise;
    const heldOperation = await firstTab.get(leased.id);
    expect(Boolean(heldOperation.leaseOwner) && Number(heldOperation.leaseUntil) > Date.now(), 'active sender did not keep its IndexedDB lease');
    let secondWasBusy = false;
    try { await secondTab.run(leased.id); } catch (error) { secondWasBusy = error && error.code === 'QUEUE_BUSY'; }
    expect(secondWasBusy, 'second queue did not observe the active lease');
    expect(firstSenderCalls === 1 && secondSenderCalls === 0, 'second queue called sender while first sender was held');
    releaseFirstSender();
    await firstRun;
    const staleLease = {...leased, id:'expired-lease-entry', clientEntryId:'entry-4', requestId:'request-5', body:{...leased.body, clientEntryId:'entry-4', entry:{...leased.body.entry, clientEntryId:'entry-4'}}};
    await firstTab.prepare(staleLease);
    const storeA = ITUS_OPERATION_QUEUE.indexedDbStore();
    const storeB = ITUS_OPERATION_QUEUE.indexedDbStore();
    const staleOperation = await storeA.get(staleLease.id);
    await storeA.put({...staleOperation, leaseOwner:'closed-tab', leaseUntil:Date.now() - 1});
    let recoveredSenderCalls = 0;
    const recoveredTab = ITUS_OPERATION_QUEUE.create({delays:[0], sender:async () => { recoveredSenderCalls++; return {success:true}; }});
    await recoveredTab.run(staleLease.id);
    expect(recoveredSenderCalls === 1, 'expired lease did not recover after tab close');
    const releaseCheck = {...leased, id:'owner-release-entry', clientEntryId:'entry-5', requestId:'request-6', body:{...leased.body, clientEntryId:'entry-5', entry:{...leased.body.entry, clientEntryId:'entry-5'}}};
    await firstTab.prepare(releaseCheck);
    await storeA.claim(releaseCheck.id, 'old-owner', 1);
    await new Promise(resolve => setTimeout(resolve, 10));
    await storeB.claim(releaseCheck.id, 'new-owner', 60000);
    await storeA.release(releaseCheck.id, 'old-owner');
    const protectedLease = await storeB.get(releaseCheck.id);
    expect(protectedLease.leaseOwner === 'new-owner', 'stale owner released another tab lease');
    result.textContent = 'OK';
  } catch (error) { result.textContent = 'ERROR: ' + (error && error.message || error); }
  await fetch('/complete?result=' + encodeURIComponent(result.textContent));
})();
</script>`;

let waitingResponse;
const server = createServer((request, response) => {
  if (request.url === '/wait') {
    waitingResponse = response;
    return;
  }
  if (request.url?.startsWith('/complete')) {
    response.end();
    waitingResponse?.end();
    waitingResponse = undefined;
    return;
  }
  response.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
  response.end(page);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const {port} = server.address();
const output = await new Promise((resolve, reject) => {
  const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-gpu-compositing', '--no-first-run', '--virtual-time-budget=3000', `--user-data-dir=${process.env.TEMP || process.cwd()}/itus-indexeddb-test-${process.pid}`, '--dump-dom', `http://127.0.0.1:${port}/`]);
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve(stdout) : reject(new Error(`Browser exited with ${code}: ${stderr}`)));
});
await new Promise(resolve => server.close(resolve));
assert.match(output, /<pre id="result">OK<\/pre>/);
console.log('Operation queue IndexedDB: restart identity, enqueue, lease ownership and recovery OK.');

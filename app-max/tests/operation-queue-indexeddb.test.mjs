import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync, existsSync} from 'node:fs';
import {spawn} from 'node:child_process';

const browserCandidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);
const browser = browserCandidates.find(existsSync);

if (!browser) {
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
console.log('Operation queue IndexedDB: restart identity, concurrent enqueue and content conflict OK.');

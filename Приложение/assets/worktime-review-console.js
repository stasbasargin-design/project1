// Loaded only by the explicit review page. No calls to the production service.
(() => {
  if (!window.ITUS_REVIEW_MODE) return;
  const panel = document.createElement('details');
  panel.className = 'card';
  panel.style.cssText = 'max-width:900px;margin:20px auto;padding:16px;background:white;position:relative;z-index:1';
  panel.open = true;
  const heading = document.createElement('summary');
  heading.textContent = 'Консоль worktime · тестовые запросы, без записи в 1С';
  const output = document.createElement('pre');
  output.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px';
  output.textContent = 'Откройте «Исполнитель» → «Создать пакет УРВ». Здесь появятся фактические запросы демонстрации.\n';
  panel.append(heading,output);document.body.append(panel);
  window.addEventListener('itus:worktime-request',event => {
    output.textContent += '\nPOST ' + event.detail.method + '\n' + JSON.stringify(event.detail.request,null,2) + '\n';
  });
  window.ITUS_WORKTIME_CONSOLE.enable();
})();

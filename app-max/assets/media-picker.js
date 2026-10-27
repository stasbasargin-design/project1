(function(root) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const mediaKind = file => /^video\//.test(file.type || '') ? 'video' : 'photo';
  const isMedia = file => /^(image|video)\//.test(file.type || '');

  function create({showSheet, closeSheet, toast, maxBytes}) {
    let session = null;
    const urls = new Map();
    const picker = document.createElement('input');
    picker.type = 'file'; picker.className = 'hidden'; picker.id = 'mediaPickerInput';
    document.body.append(picker);

    function revoke() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); }
    function preview(file) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (!urls.has(key)) urls.set(key, URL.createObjectURL(file));
      return urls.get(key);
    }
    function render() {
      if (!session) return;
      const files = session.files;
      const cards = files.map((item, index) => {
        const { file } = item;
        const url = preview(file), video = mediaKind(file) === 'video';
        const thumb = video
          ? `<video src="${escape(url)}" muted playsinline preload="metadata"></video><span class="media-picker-play">▶</span>`
          : `<img src="${escape(url)}" alt="${escape(file.name)}">`;
        const result = item.status === 'failed' ? `<small class="media-picker-error">${escape(item.error || 'Ошибка загрузки')}</small>` : (item.status === 'success' ? '<small class="media-picker-success">Загружено</small>' : '');
        return `<article class="media-picker-item ${item.status}">${thumb}<button type="button" data-action="media-remove" data-index="${index}" aria-label="Удалить ${escape(file.name)}">×</button><small>${escape(file.name)}</small>${result}</article>`;
      }).join('');
      const pending = files.filter(item => item.status !== 'success').length;
      const failed = files.filter(item => item.status === 'failed').length;
      showSheet('Фото и видео', session.hint || 'Выберите файлы, проверьте список и отправьте одним действием',
        `<div class="media-picker-actions"><button class="primary" data-action="media-gallery">Галерея</button><button data-action="media-camera-photo">Камера</button><button data-action="media-camera-video">Видео</button></div><p class="tiny">Можно выбрать несколько фото и видео. Файлы будут прикреплены к текущему документу или чату.</p><div class="media-picker-grid">${cards || '<div class="empty">Файлы ещё не выбраны</div>'}</div><div class="media-picker-footer"><span>${files.length ? `Выбрано: ${files.length}${failed ? ` · ошибки: ${failed}` : ''}` : 'Выберите фото или видео'}</span><button class="primary" data-action="media-send" ${pending && !session.sending ? '' : 'disabled'}>${session.sending ? (session.phase === 'saving' ? '<span class="spinner"></span> Сохранение…' : `Отправка ${session.sent + 1}/${session.total}`) : (failed ? 'Повторить ошибки' : 'Отправить')}</button></div>`);
    }
    function openInput(mode) {
      if (!session || session.sending) return;
      picker.value = '';
      picker.multiple = mode === 'gallery';
      if (mode === 'photo') { picker.accept = 'image/*'; picker.setAttribute('capture', 'environment'); }
      else if (mode === 'video') { picker.accept = 'video/*'; picker.setAttribute('capture', 'environment'); }
      else { picker.accept = 'image/*,video/*'; picker.removeAttribute('capture'); }
      picker.click();
    }
    function add(files) {
      if (!session) return;
      const existing = new Set(session.files.map(item => item.key));
      let rejected = 0;
      for (const file of files) {
        if (!isMedia(file) || file.size > maxBytes || existing.has(`${file.name}:${file.size}:${file.lastModified}`)) { rejected++; continue; }
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        existing.add(key); session.files.push({ file, key, uploadId: root.crypto?.randomUUID ? root.crypto.randomUUID() : `media-${Date.now()}-${Math.random()}`, status:'pending', error:'' });
      }
      if (rejected) toast(`Не добавлены неподдерживаемые, повторные или слишком большие файлы (лимит ${Math.round(maxBytes / 1024 / 1024)} МБ)`, true);
      render();
    }
    picker.addEventListener('change', () => add(Array.from(picker.files || [])));
    async function send() {
      if (!session || !session.files.length || session.sending) return;
      const activeSession = session;
      const queue = activeSession.files.filter(item => item.status !== 'success');
      // Freeze the complete selection before any asynchronous preparation starts.
      const snapshot = queue.map(item => ({ file:item.file, kind:mediaKind(item.file), uploadId:item.uploadId }));
      activeSession.sending = true; activeSession.sent = 0; activeSession.total = queue.length;
      if (!activeSession.onCommit) {
        for (const [index, item] of queue.entries()) {
          item.status = 'sending'; item.error = ''; render();
          try { await activeSession.onSend(item.file, snapshot[index].kind, item.uploadId); item.status = 'success'; }
          catch (error) { item.status = 'failed'; item.error = error.message || 'Не удалось отправить файл'; }
          activeSession.sent++; render();
        }
        activeSession.sending = false;
        const failed = activeSession.files.filter(item => item.status === 'failed').length;
        render(); toast(failed ? `Загружено: ${activeSession.files.length - failed}, ошибки: ${failed}` : 'Фото и видео отправлены', Boolean(failed));
        return;
      }
      activeSession.phase = 'saving'; queue.forEach(item => { item.status = 'saving'; item.error = ''; }); render();
      try {
        await activeSession.onCommit(snapshot);
        queue.forEach(item => { item.status = 'success'; });
        activeSession.sent = queue.length;
        activeSession.sending = false; activeSession.phase = '';
        if (session === activeSession) close();
        toast('Файлы сохранены на устройстве и будут отправлены в фоне');
      } catch (error) {
        queue.forEach(item => { item.status = 'failed'; item.error = error.message || 'Не удалось сохранить файл'; });
        activeSession.sending = false; activeSession.phase = ''; render();
        toast(error.message || 'Не удалось сохранить все файлы', true);
      }
    }
    function dismiss({force = false} = {}) {
      if (session?.sending && !force) { toast('Подождите, пока все файлы сохранятся на устройстве', true); return false; }
      revoke(); session = null; return true;
    }
    function close() { if (dismiss()) closeSheet(); }
    function handle(action, button) {
      if (!session || !action.startsWith('media-')) return false;
      if (action === 'media-gallery') openInput('gallery');
      else if (action === 'media-camera-photo') openInput('photo');
      else if (action === 'media-camera-video') openInput('video');
      else if (action === 'media-remove' && !session.sending) { session.files.splice(Number(button?.dataset?.index), 1); render(); }
      else if (action === 'media-send') void send();
      return true;
    }
    return {
      open({hint, onCommit, onSend}) { revoke(); session = {hint, onCommit, onSend, files:[], sending:false, sent:0, total:0, phase:''}; render(); },
      handle,
      close,
      dismiss
    };
  }
  root.ITUS_MEDIA_PICKER = {create};
})(window);

(function (root) {
  'use strict';

  const trimValue = value => String(value ?? '').trim();
  const characters = value => Array.from(trimValue(value));

  function normalize(value) {
    const result = trimValue(value);
    if (characters(result).length !== 5) throw new Error('QR заказ-наряда должен содержать ровно 5 символов');
    return result;
  }

  function exactSuffix(orderNumber, suffix) {
    return String(orderNumber ?? '').endsWith(suffix);
  }

  function filterMatches(orders, suffix) {
    return Array.from(orders || []).filter(order => order?.id && exactSuffix(order.num, suffix));
  }

  function createScanner({ onResult, onFailure, onStream }) {
    let stream = null;
    let frame = 0;
    let stopped = true;
    let detector = null;
    let canvas = null;
    let context = null;
    let scanning = false;

    function stop() {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks?.().forEach(track => track.stop());
      stream = null;
      onStream?.(null);
    }

    async function decode(video) {
      if (detector) {
        const codes = await detector.detect(video).catch(() => []);
        return codes[0]?.rawValue || '';
      }
      if (typeof root.jsQR !== 'function' || !video.videoWidth || !video.videoHeight) return '';
      canvas ||= document.createElement('canvas');
      context ||= canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return '';
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      return root.jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data || '';
    }

    async function tick(video) {
      if (stopped) return;
      if (!scanning && video.readyState >= 2) {
        scanning = true;
        try {
          const value = await decode(video);
          if (value) {
            stop();
            await onResult(value);
            return;
          }
        } finally { scanning = false; }
      }
      frame = requestAnimationFrame(() => tick(video));
    }

    async function start(video) {
      stop();
      stopped = false;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна в этом браузере');
        if (typeof root.BarcodeDetector === 'function') {
          try { detector = new root.BarcodeDetector({ formats: ['qr_code'] }); }
          catch { detector = null; }
        }
        if (!detector && typeof root.jsQR !== 'function') throw new Error('Распознавание QR недоступно');
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } }
        });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        onStream?.(stream);
        video.srcObject = stream;
        await video.play?.().catch(() => {});
        frame = requestAnimationFrame(() => tick(video));
      } catch (error) {
        stop();
        onFailure?.(error);
      }
    }

    return { start, stop };
  }

  root.ITUS_ORDER_QR = { normalize, exactSuffix, filterMatches, createScanner };
})(window);

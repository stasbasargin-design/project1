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
    let generation = 0;

    function stop() {
      generation++;
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks?.().forEach(track => track.stop());
      stream = null;
      onStream?.(null);
    }

    async function decode(video) {
      if (detector) {
        try {
          const codes = await detector.detect(video);
          return codes[0]?.rawValue || '';
        } catch {
          // Some WebViews expose BarcodeDetector but cannot decode their camera
          // frames. Continue with the bundled decoder instead of spinning forever.
          detector = null;
        }
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

    async function tick(video, session) {
      if (stopped || session !== generation) return;
      if (!scanning && video.readyState >= 2) {
        scanning = true;
        try {
          const value = await decode(video);
          if (stopped || session !== generation) return;
          if (value) {
            stop();
            await onResult(value);
            return;
          }
        } catch (error) {
          if (session === generation) { stop(); onFailure?.(error); }
        } finally { scanning = false; }
      }
      if (!stopped && session === generation) frame = requestAnimationFrame(() => tick(video, session));
    }

    async function start(video) {
      stop();
      stopped = false;
      const session = generation;
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Камера недоступна в этом браузере');
        if (typeof root.BarcodeDetector === 'function') {
          try { detector = new root.BarcodeDetector({ formats: ['qr_code'] }); }
          catch { detector = null; }
        }
        if (!detector && typeof root.jsQR !== 'function') throw new Error('Распознавание QR недоступно');
        const acquired = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' } }
        });
        if (stopped || session !== generation) { acquired.getTracks().forEach(track => track.stop()); return; }
        stream = acquired;
        onStream?.(stream);
        video.srcObject = stream;
        await video.play?.().catch(() => {});
        if (!stopped && session === generation) frame = requestAnimationFrame(() => tick(video, session));
      } catch (error) {
        if (session === generation) { stop(); onFailure?.(error); }
      }
    }

    return { start, stop };
  }

  root.ITUS_ORDER_QR = { normalize, exactSuffix, filterMatches, createScanner };
})(window);

// Luồng riêng chạy nhận diện mép giấy, để hình camera không bị giật
importScripts('https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js', 'detector.js');

let ready = false;
(async () => {
  for (let i = 0; i < 2400; i++) {
    if (typeof cv !== 'undefined') {
      if (cv instanceof Promise) self.cv = await cv;
      if (cv && cv.Mat) { ready = true; postMessage({ type: 'ready' }); return; }
    }
    await new Promise(r => setTimeout(r, 50));
  }
  postMessage({ type: 'fail' });
})();

onmessage = e => {
  const { id, img } = e.data;
  if (!ready) { postMessage({ type: 'det', id, q: null, notReady: true }); return; }
  let q = null;
  try { q = Detector.detect(img, e.data.prev || null); } catch (err) { q = null; }
  postMessage({ type: 'det', id, q });
};

// Nắn phẳng, lọc ảnh (dùng OpenCV.js); nhận diện mép giấy ở detector.js
const Vision = (() => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let isReady = false;

  const ready = (async () => {
    for (let i = 0; i < 1200; i++) {            // chờ tối đa ~2 phút (mạng chậm lần đầu)
      if (typeof cv !== 'undefined') {
        if (cv instanceof Promise) window.cv = await cv;
        if (cv && cv.Mat) { isReady = true; return true; }
      }
      await sleep(100);
    }
    throw new Error('Không tải được bộ nhận diện (OpenCV)');
  })();

  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // Bộ nhận diện mép giấy nằm trong detector.js (dùng chung với Web Worker)
  const detect = src => Detector.detect(src);
  const refineQuad = (src, q) => Detector.refineQuad(src, q);
  const order = q => Detector.order(q);

  // Tỉ lệ chuẩn: CCCD 85,6×54 mm; A4 210×297 mm
  function snapRatio(W, H) {
    const long = Math.max(W, H), short = Math.min(W, H), r = long / short;
    for (const [target, tol] of [[85.6 / 53.98, 0.09], [297 / 210, 0.06]]) {
      if (Math.abs(r - target) / target < tol) {
        const nl = short * target;
        return W >= H ? [nl, short] : [short, nl];
      }
    }
    return [W, H];
  }

  // Nắn phẳng: canvas nguồn + tứ giác (tọa độ nguồn) -> canvas mới
  function warp(srcCanvas, q, maxSide) {
    // lẹm vào 0,6% để không dính viền nền bàn
    const cx = q.reduce((a, p) => a + p[0], 0) / 4, cy = q.reduce((a, p) => a + p[1], 0) / 4;
    q = q.map(p => [p[0] + (cx - p[0]) * 0.012, p[1] + (cy - p[1]) * 0.012]);
    const src = cv.imread(srcCanvas);
    let W = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
    let H = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
    [W, H] = snapRatio(W, H);
    const s = Math.min(1, maxSide / Math.max(W, H));          // không phóng to: không thêm chi tiết, chỉ chậm hơn
    W = Math.round(W * s); H = Math.round(H * s);
    const from = cv.matFromArray(4, 1, cv.CV_32FC2, q.flat());
    const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, W, 0, W, H, 0, H]);
    const M = cv.getPerspectiveTransform(from, to);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(W, H), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar());
    const out = document.createElement('canvas');
    cv.imshow(out, dst);
    src.delete(); from.delete(); to.delete(); M.delete(); dst.delete();
    return out;
  }

  // Ước lượng nền giấy (ánh sáng không đều) cho ảnh 1 hoặc 3 kênh
  function background(m, floor) {
    const W = m.cols, H = m.rows, f = 8;
    const small = new cv.Mat(), bg = new cv.Mat();
    cv.resize(m, small, new cv.Size(Math.max(8, Math.round(W / f)), Math.max(8, Math.round(H / f))), 0, 0, cv.INTER_AREA);
    // vùng lấy mẫu ~45% cạnh ngắn: đủ rộng để "nhảy qua" ảnh chân dung, con dấu, khối chữ đậm
    const ks = Math.max(9, Math.round(Math.min(small.cols, small.rows) * 0.45)) | 1;
    const k = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ks, ks));
    cv.dilate(small, small, k);                 // xóa nét chữ, ảnh tối -> còn màu giấy
    cv.medianBlur(small, small, 5);
    cv.GaussianBlur(small, small, new cv.Size(ks, ks), 0);
    cv.resize(small, bg, new cv.Size(W, H), 0, 0, cv.INTER_LINEAR);
    // chặn dưới để vùng ảnh chân dung / con dấu không bị cháy sáng
    const fl = new cv.Mat(H, W, bg.type(), m.channels() === 3 ? new cv.Scalar(floor, floor, floor) : new cv.Scalar(floor));
    cv.max(bg, fl, bg);
    small.delete(); k.delete(); fl.delete();
    return bg;
  }

  function applyFilter(canvas, filter) {
    if (filter === 'photo') return canvas;
    const rgba = cv.imread(canvas);
    const rgb = new cv.Mat(), out = new cv.Mat();
    cv.cvtColor(rgba, rgb, cv.COLOR_RGBA2RGB);
    try {
      if (filter === 'color') {
        const bg = background(rgb, 150);
        cv.divide(rgb, bg, out, 255);
        out.convertTo(out, -1, 1.08, -10);       // tăng tương phản nhẹ
        bg.delete();
      } else {
        const g = new cv.Mat();
        cv.cvtColor(rgb, g, cv.COLOR_RGB2GRAY);
        const bg = background(g, filter === 'bw' ? 60 : 130);
        cv.divide(g, bg, g, 255);
        if (filter === 'gray') {
          g.convertTo(out, -1, 1.12, -18);
        } else {
          let block = Math.round(Math.max(g.cols, g.rows) / 60) | 1;
          block = Math.max(15, block);
          cv.adaptiveThreshold(g, out, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, block, 10);
          cv.medianBlur(out, out, 3);
        }
        g.delete(); bg.delete();
      }
      const res = document.createElement('canvas');
      cv.imshow(res, out);
      return res;
    } finally {
      rgba.delete(); rgb.delete(); out.delete();
    }
  }

  return { ready, get isReady() { return isReady; }, detect, refineQuad, warp, applyFilter, order };
})();

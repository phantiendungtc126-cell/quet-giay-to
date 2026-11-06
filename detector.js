// Nhận diện mép giấy – dùng chung cho luồng chính và Web Worker (cần OpenCV.js)
(function (root) {

  // Sắp 4 điểm: trên-trái, trên-phải, dưới-phải, dưới-trái (chiều kim đồng hồ trên màn hình)
  function order(pts) {
    const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4;
    const byAng = pts.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
    let k = 0, m = Infinity;
    byAng.forEach((p, i) => { if (p[0] + p[1] < m) { m = p[0] + p[1]; k = i; } });
    return byAng.slice(k).concat(byAng.slice(0, k));
  }
  function detect(source) {
  const src = source instanceof ImageData ? cv.matFromImageData(source) : cv.imread(source);
  const W = src.cols, H = src.rows, A = W * H;
  const mats = [];
  const M = () => { const m = new cv.Mat(); mats.push(m); return m; };
  try {
    const rgb = M(); cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const rgbB = M(); cv.GaussianBlur(rgb, rgbB, new cv.Size(5, 5), 0);
    const gray = M(); cv.cvtColor(rgbB, gray, cv.COLOR_RGB2GRAY);

    // ---- bản đồ độ lớn gradient (bằng chứng đường biên)
    // lấy gradient lớn nhất trong 3 kênh màu: bắt được cả mép "cùng độ sáng, khác màu" (thẻ xanh trên bàn gỗ)
    const mag = new Float32Array(A);
    {
      const ch = new cv.MatVector(); cv.split(rgbB, ch);
      const gx = M(), gy = M();
      for (let c = 0; c < 3; c++) {
        const m = ch.get(c);
        cv.Sobel(m, gx, cv.CV_32F, 1, 0, 3); cv.Sobel(m, gy, cv.CV_32F, 0, 1, 3);
        const a = gx.data32F, b = gy.data32F;
        for (let i = 0; i < A; i++) { const v = Math.hypot(a[i], b[i]); if (v > mag[i]) mag[i] = v; }
        m.delete();
      }
      ch.delete();
    }
    let msum = 0;
    for (let i = 0; i < A; i++) msum += mag[i];
    const mmean = msum / A;
    const Tm = Math.max(40, mmean * 1.6);          // ngưỡng "có biên"
    const col = rgbB.data;                          // màu đã làm mượt để so trong/ngoài

    const magAt = (x, y) => { x = Math.round(x); y = Math.round(y); return (x < 0 || y < 0 || x >= W || y >= H) ? -1 : mag[y * W + x]; };
    const colAt = (x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return null; const k = (y * W + x) * 3; return [col[k], col[k + 1], col[k + 2]]; };

    // ---- nguồn ứng viên
    const cands = [];
    const k3 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)); mats.push(k3);
    const k5 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)); mats.push(k5);
    const k9 = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(9, 9)); mats.push(k9);

    function harvest(bin, mode) {
      const cs = new cv.MatVector(), hi = new cv.Mat();
      cv.findContours(bin, cs, hi, mode, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < cs.size(); i++) {
        const c = cs.get(i);
        const a = cv.contourArea(c);
        if (a < A * 0.04 || a > A * 0.97) { c.delete(); continue; }
        const hull = new cv.Mat(); cv.convexHull(c, hull, false, true);
        const peri = cv.arcLength(hull, true);
        let got = false;
        for (const eps of [0.015, 0.025, 0.04, 0.06, 0.08]) {
          const ap = new cv.Mat(); cv.approxPolyDP(hull, ap, eps * peri, true);
          if (ap.rows === 4) { const d = ap.data32S; cands.push([[d[0], d[1]], [d[2], d[3]], [d[4], d[5]], [d[6], d[7]]]); got = true; }
          ap.delete(); if (got) break;
        }
        if (!got) {   // hình gần chữ nhật nhưng góc bo/bị che → dùng hình chữ nhật bao nhỏ nhất
          const r = cv.minAreaRect(hull);
          if (a / (r.size.width * r.size.height + 1) > 0.82) {
            const pts = cv.RotatedRect.points(r); cands.push(pts.map(p => [p.x, p.y]));
          }
        }
        hull.delete(); c.delete();
      }
      cs.delete(); hi.delete();
    }

    // 1) biên trên ảnh đã xóa chữ (đóng hình thái học)
    const closed = M(); cv.morphologyEx(gray, closed, cv.MORPH_CLOSE, k9);
    const e1 = M(); cv.Canny(closed, e1, 20, 60); cv.dilate(e1, e1, k3); harvest(e1, cv.RETR_LIST);
    // 2) biên thường
    const e2 = M(); cv.Canny(gray, e2, 40, 120); cv.dilate(e2, e2, k3); harvest(e2, cv.RETR_LIST);
    // 3) độ trắng = min(R,G,B): giấy trắng/nhạt nổi trên nền có màu
    const wmap = M(); wmap.create(H, W, cv.CV_8UC1);
    { const w = wmap.data; for (let i = 0, k = 0; i < A; i++, k += 3) w[i] = Math.min(col[k], col[k + 1], col[k + 2]); }
    const t3 = M(); cv.threshold(wmap, t3, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(t3, t3, cv.MORPH_OPEN, k5); cv.morphologyEx(t3, t3, cv.MORPH_CLOSE, k9); harvest(t3, cv.RETR_EXTERNAL);
    // 4) khác màu so với nền (màu nền lấy ở viền khung hình)
    {
      const bs = [[], [], []], b = 4;
      for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
        if (x > b && y > b && x < W - b && y < H - b) continue;
        const k = (y * W + x) * 3; bs[0].push(col[k]); bs[1].push(col[k + 1]); bs[2].push(col[k + 2]);
      }
      const med = bs.map(a => { a.sort((p, q) => p - q); return a[a.length >> 1]; });
      const dmap = M(); dmap.create(H, W, cv.CV_8UC1);
      const d = dmap.data;
      for (let i = 0, k = 0; i < A; i++, k += 3) d[i] = Math.min(255, (Math.abs(col[k] - med[0]) + Math.abs(col[k + 1] - med[1]) + Math.abs(col[k + 2] - med[2])));
      cv.GaussianBlur(dmap, dmap, new cv.Size(5, 5), 0);
      const t4 = M(); cv.threshold(dmap, t4, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
      cv.morphologyEx(t4, t4, cv.MORPH_OPEN, k5); cv.morphologyEx(t4, t4, cv.MORPH_CLOSE, k9); harvest(t4, cv.RETR_EXTERNAL);
    }
    // 6) biên màu (ngưỡng trên bản đồ gradient 3 kênh)
    {
      const em = M(); em.create(H, W, cv.CV_8UC1);
      const d = em.data, T = Tm * 0.8;
      for (let i = 0; i < A; i++) d[i] = mag[i] > T ? 255 : 0;
      cv.dilate(em, em, k3); harvest(em, cv.RETR_LIST);
    }
    // 5) ngưỡng sáng tối trên ảnh xóa chữ
    const t5 = M(); cv.threshold(closed, t5, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(t5, t5, cv.MORPH_OPEN, k5); harvest(t5, cv.RETR_EXTERNAL);

    // ---- chấm điểm
    function score(q0) {
      const q = order(q0);
      if (!angleOk(q)) return null;
      const area = Math.abs(polyArea(q)) / A;
      if (area < 0.04 || area > 0.97) return null;
      let supSum = 0, supMin = 1, difSum = 0, difMin = 1e9;
      const ins = [0, 0, 0], ins2 = [0, 0, 0]; let ni = 0;   // màu phía trong mép: giấy thật thì đồng đều
      for (let s = 0; s < 4; s++) {
        const p0 = q[s], p1 = q[(s + 1) % 4];
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
        if (L < 12) return null;
        const nx = -dy / L, ny = dx / L;           // pháp tuyến hướng vào trong
        let n = 0, sup = 0, dif = 0, nd = 0;
        for (let t = 0.06; t <= 0.94; t += 0.022) {
          const x = p0[0] + dx * t, y = p0[1] + dy * t;
          let m = -1; for (let o = -2; o <= 2; o++) m = Math.max(m, magAt(x + nx * o, y + ny * o));
          if (m < 0) continue;
          n++; if (m > Tm) sup++;
          const ci = colAt(x + nx * 5, y + ny * 5), co = colAt(x - nx * 5, y - ny * 5);
          if (ci && co) { dif += (Math.abs(ci[0] - co[0]) + Math.abs(ci[1] - co[1]) + Math.abs(ci[2] - co[2])) / 3; nd++; }
          const cd = colAt(x + nx * 7, y + ny * 7);
          if (cd) { for (let k = 0; k < 3; k++) { ins[k] += cd[k]; ins2[k] += cd[k] * cd[k]; } ni++; }
        }
        if (n < 8) return null;
        const sr = sup / n, dr = nd ? dif / nd : 0;
        supSum += sr; supMin = Math.min(supMin, sr); difSum += dr; difMin = Math.min(difMin, dr);
      }
      if (supMin < 0.22 || difMin < 4 || supSum - supMin < 3 * 0.55) return null;
      const sup = supSum / 4, dif = difSum / 4;
      let sd = 0; for (let k = 0; k < 3; k++) { const m = ins[k] / ni; sd += Math.sqrt(Math.max(0, ins2[k] / ni - m * m)); } sd /= 3;
      const uni = Math.max(0.15, Math.min(1, 1 - (sd - 18) / 50));
      const sc = Math.sqrt(area) * sup * sup * (0.5 + 0.5 * supMin) * Math.min(1, dif / 25) * uni;
      return { q, sc, uni };
    }
    const valid = [];
    for (const c of cands) { const r = score(c); if (r) valid.push(r); }
    if (!valid.length) return null;
    let best = valid.reduce((a, b) => (b.sc > a.sc ? b : a));
    // Ưu tiên mép ngoài: khung hoa văn trong GCN, dải màu đầu thẻ CCCD… nằm gọn trong mép giấy thật
    for (let guard = 0; guard < 5; guard++) {
      const outer = valid.filter(v => v !== best && v.sc >= best.sc * 0.45 && v.uni >= 0.3 && contains(v.q, best.q, 2))
        .sort((a, b) => Math.abs(polyArea(b.q)) - Math.abs(polyArea(a.q)))[0];
      if (!outer) break;
      best = outer;
    }
    return refine(best.q, magAt, Tm, W, H) || best.q;
  } finally {
    src.delete(); mats.forEach(m => { try { m.delete(); } catch {} });
  }
  }
  // q chứa trọn r (mọi góc của r nằm trong q, cách mép ít nhất m điểm ảnh) và lớn hơn rõ rệt
  function contains(q, r, m) {
    if (Math.abs(polyArea(q)) < Math.abs(polyArea(r)) * 1.03) return false;
    return r.every(p => {
      for (let i = 0; i < 4; i++) {
        const a = q[i], b = q[(i + 1) % 4];
        const cross = ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (cross < m) return false;     // q xếp theo chiều kim đồng hồ trên màn hình → phía trong có cross > 0
      }
      return true;
    }) && Math.abs(polyArea(q)) < Math.abs(polyArea(r)) * 2.2;
  }
  function polyArea(q) { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; a += p[0] * r[1] - r[0] * p[1]; } return a / 2; }
  function angleOk(q) {
    for (let i = 0; i < 4; i++) {
      const a = q[(i + 3) % 4], b = q[i], c = q[(i + 1) % 4];
      const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2) + 1e-9);
      const deg = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
      if (deg < 45 || deg > 135) return false;
    }
    return true;
  }
  // Tinh chỉnh: tìm điểm biên mạnh nhất dọc pháp tuyến, khớp đường thẳng cho từng cạnh, giao 4 đường
  function refine(q, magAt, Tm, W, H, R = 6) {
    const lines = [];
    for (let s = 0; s < 4; s++) {
      const p0 = q[s], p1 = q[(s + 1) % 4];
      const dx = p1[0] - p0[0], dy = p1[1] - p0[1], L = Math.hypot(dx, dy);
      const nx = -dy / L, ny = dx / L;
      let pts = [];
      for (let t = 0.1; t <= 0.9; t += 0.02) {
        const x = p0[0] + dx * t, y = p0[1] + dy * t;
        let bm = -1, bo = 0;
        for (let o = -R; o <= R; o += 0.5) { const m = magAt(x + nx * o, y + ny * o); if (m > bm) { bm = m; bo = o; } }
        if (bm > Tm) pts.push([x + nx * bo, y + ny * bo]);
      }
      let line = null;
      for (let it = 0; it < 2 && pts.length >= 8; it++) {
        line = fitLine(pts);
        const keep = pts.filter(p => Math.abs((p[0] - line.x) * line.nx + (p[1] - line.y) * line.ny) < 1.5);
        if (keep.length < 8) break;
        pts = keep;
      }
      if (pts.length >= 8) line = fitLine(pts);
      if (!line) { const n = Math.hypot(dx, dy); line = { x: p0[0], y: p0[1], nx: -dy / n, ny: dx / n }; }
      lines.push(line);
    }
    const out = [];
    for (let i = 0; i < 4; i++) {
      const a = lines[(i + 3) % 4], b = lines[i];
      const c1 = a.nx * a.x + a.ny * a.y, c2 = b.nx * b.x + b.ny * b.y;
      const det = a.nx * b.ny - a.ny * b.nx;
      if (Math.abs(det) < 1e-6) return null;
      const p = [(c1 * b.ny - a.ny * c2) / det, (a.nx * c2 - c1 * b.nx) / det];
      if (Math.hypot(p[0] - q[i][0], p[1] - q[i][1]) > 0.06 * Math.hypot(W, H)) return null;
      out.push(p);
    }
    return out;
  }
  function fitLine(pts) {
    let mx = 0, my = 0; pts.forEach(p => { mx += p[0]; my += p[1]; }); mx /= pts.length; my /= pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    pts.forEach(p => { const a = p[0] - mx, b = p[1] - my; sxx += a * a; sxy += a * b; syy += b * b; });
    const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);   // hướng của đường
    return { x: mx, y: my, nx: -Math.sin(th), ny: Math.cos(th) };
  }

  // gradient lớn nhất trong 3 kênh màu
  function colorGrad(rgbB, W, H) {
    const A = W * H, mag = new Float32Array(A);
    const ch = new cv.MatVector(); cv.split(rgbB, ch);
    const gx = new cv.Mat(), gy = new cv.Mat();
    for (let c = 0; c < 3; c++) {
      const m = ch.get(c);
      cv.Sobel(m, gx, cv.CV_32F, 1, 0, 3); cv.Sobel(m, gy, cv.CV_32F, 0, 1, 3);
      const a = gx.data32F, b = gy.data32F;
      for (let i = 0; i < A; i++) { const v = Math.hypot(a[i], b[i]); if (v > mag[i]) mag[i] = v; }
      m.delete();
    }
    ch.delete(); gx.delete(); gy.delete();
    return mag;
  }

  // Tinh chỉnh tứ giác q (tọa độ của imageData) trên ảnh độ phân giải cao hơn
  function refineQuad(source, q) {
    const src = source instanceof ImageData ? cv.matFromImageData(source) : cv.imread(source);
    const rgb = new cv.Mat(), rgbB = new cv.Mat();
    try {
      const W = src.cols, H = src.rows, A = W * H;
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      cv.GaussianBlur(rgb, rgbB, new cv.Size(5, 5), 0);
      const mag = colorGrad(rgbB, W, H);
      let ms = 0; for (let i = 0; i < A; i++) ms += mag[i];
      const Tm = Math.max(40, (ms / A) * 1.6);
      const magAt = (x, y) => { x = Math.round(x); y = Math.round(y); return (x < 0 || y < 0 || x >= W || y >= H) ? -1 : mag[y * W + x]; };
      return refine(order(q), magAt, Tm, W, H, 8) || q;
    } finally { src.delete(); rgb.delete(); rgbB.delete(); }
  }

  root.Detector = { detect, refineQuad, order };
})(typeof self !== 'undefined' ? self : this);

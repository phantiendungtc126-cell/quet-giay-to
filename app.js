// ================= Quét giấy tờ – điều khiển giao diện =================
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));

const QUALITY = {
  std: { side: 1800, jpeg: 0.72 },
  high: { side: 2500, jpeg: 0.82 },
  max: { side: 3300, jpeg: 0.9 },
};
const TYPES = {
  gcn: { label: 'Giấy chứng nhận', short: 'GCN', folder: 'Giấy chứng nhận' },
  cccd: { label: 'CCCD', short: 'CCCD', folder: 'Căn cước công dân' },
  khac: { label: 'Khác', short: 'Giấy tờ', folder: 'Giấy tờ khác' },
};

// ---------------- tiện ích ----------------
function toast(msg, ms = 2200) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function busy(on, text) { $('busy').classList.toggle('hidden', !on); if (text) $('busyText').textContent = text; }
const canvasToBlob = (c, type = 'image/jpeg', q = 0.85) => new Promise(r => c.toBlob(r, type, q));
function freeCanvas(c) { if (c && c.width) { c.width = 0; c.height = 0; } } // iOS giới hạn bộ nhớ canvas
function loadImage(blob) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(blob), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Không đọc được ảnh')); };
    img.src = url;
  });
}
function imageToCanvas(img, maxSide = 0) {
  let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  if (maxSide && Math.max(w, h) > maxSide) { const s = maxSide / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c;
}
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1]);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}
const pad = n => String(n).padStart(2, '0');
function stamp(d = new Date()) { return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}h${pad(d.getMinutes())}`; }
function cleanName(s) { return (s || '').normalize('NFC').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function makeFileName(type, name, date) {
  const n = cleanName(name);
  return `${TYPES[type].short}${n ? ' - ' + n : ''} - ${stamp(date)}.pdf`;
}
function fmtSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
const fullQuad = (w, h) => [[0, 0], [w, 0], [w, h], [0, h]];

// Xử lý 1 trang: ảnh gốc + tứ giác + bộ lọc + xoay -> Blob JPEG
async function renderPage(p, srcCanvas) {
  const q = QUALITY[Settings.get('quality')] || QUALITY.high;
  let base = srcCanvas;
  if (!base) base = imageToCanvas(await loadImage(p.raw));
  let warped = Vision.isReady ? Vision.warp(base, p.quad, q.side) : base;
  let filtered = Vision.isReady ? Vision.applyFilter(warped, p.filter) : warped;
  let final = filtered;
  if (p.rot % 4) {
    final = document.createElement('canvas');
    const odd = p.rot % 2 === 1;
    final.width = odd ? filtered.height : filtered.width;
    final.height = odd ? filtered.width : filtered.height;
    const x = final.getContext('2d');
    x.translate(final.width / 2, final.height / 2);
    x.rotate(p.rot * Math.PI / 2);
    x.drawImage(filtered, -filtered.width / 2, -filtered.height / 2);
  }
  const blob = await canvasToBlob(final, 'image/jpeg', q.jpeg);
  p.outW = final.width; p.outH = final.height;
  [warped, filtered, final].forEach(c => { if (c !== srcCanvas && c !== base) freeCanvas(c); });
  if (!srcCanvas) freeCanvas(base);
  if (p.outUrl) URL.revokeObjectURL(p.outUrl);
  p.out = blob; p.outUrl = URL.createObjectURL(blob);
  return blob;
}

// ---------------- điều hướng ----------------
let current = 'home';
function show(id, push = true) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
  if (current === 'scanner' && id !== 'scanner') Scanner.stop();
  current = id;
  document.querySelector('meta[name=theme-color]').content = (id === 'scanner' || id === 'cropper') ? '#000000' : '#f2f2f7';
  if (push) history.pushState({ s: id }, '');
}
history.replaceState({ s: 'home' }, '');
window.addEventListener('popstate', e => {
  const s = (e.state && e.state.s) || 'home';
  if (current === 'review' && s === 'scanner') { Scanner.start(); show('scanner', false); return; }
  if (current === 'scanner' && session.pages.length && s === 'home') {
    if (!confirm('Bỏ các trang vừa quét?')) { history.pushState({ s: 'scanner' }, ''); return; }
    resetSession();
  }
  if (current === 'cropper') { show('review', false); return; }
  show(s, false);
  if (s === 'home') renderList();
});

// ---------------- phiên quét hiện tại ----------------
const session = { pages: [], idx: 0, type: 'gcn' };
function resetSession() {
  session.pages.forEach(p => p.outUrl && URL.revokeObjectURL(p.outUrl));
  session.pages = []; session.idx = 0;
  updateThumb(false);
}

// ================= MÁY QUÉT =================
const Scanner = (() => {
  const video = $('video'), overlay = $('overlay'), octx = overlay.getContext('2d');
  const small = document.createElement('canvas'), sctx = small.getContext('2d', { willReadFrequently: true });
  let stream = null, running = false, raf = 0, lastDetect = 0, wakeLock = null;
  let auto = Settings.get('autoCapture');
  let filter = Settings.get('filter');
  let det = null;        // tứ giác mới nhất (tọa độ video)
  let shown = null;      // tứ giác đang vẽ (đã làm mượt)
  let stable = 0, lost = 0, armed = true, lastCapQ = null, lastCapAt = 0, capturing = false, justCaptured = 0;
  const STABLE_N = 9;

  function setHint(t, go = false) { const h = $('hint'); if (h.textContent !== t) h.textContent = t; h.classList.toggle('go', go); }
  function setMode(a) {
    auto = a; Settings.set('autoCapture', a);
    $('btnMode').textContent = a ? 'Tự động' : 'Thủ công';
    $('btnMode').style.color = a ? '#ffd60a' : '#fff';
  }
  function setFilter(f) {
    filter = f;
    document.querySelectorAll('#filterBar button').forEach(b => b.classList.toggle('on', b.dataset.f === f));
  }

  async function start() {
    setMode(auto); setFilter(filter);
    det = shown = null; stable = 0; armed = true;
    setHint('Đang mở máy ảnh…');
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
      });
    } catch (e) {
      setHint('Không mở được máy ảnh');
      alert('Không mở được máy ảnh.\n\nHãy cho phép ứng dụng dùng máy ảnh (Cài đặt › Safari/Chrome › Máy ảnh), hoặc bấm nút ảnh ở màn hình chính để chọn ảnh có sẵn.\n\nChi tiết: ' + e.message);
      return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch {}
    const track = stream.getVideoTracks()[0];
    try {
      const caps = track.getCapabilities ? track.getCapabilities() : {};
      $('btnTorch').classList.toggle('hidden', !caps.torch);
      if (caps.focusMode && caps.focusMode.includes('continuous'))
        track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    } catch {}
    try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
    running = true;
    resize();
    loop();
    if (!Vision.isReady) {
      setHint('Đang tải bộ nhận diện… (lần đầu hơi lâu)');
      Vision.ready.catch(() => setHint('Chưa tải được bộ nhận diện – chụp tay vẫn được'));
    }
  }

  function stop() {
    running = false; cancelAnimationFrame(raf);
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; video.srcObject = null;
    $('btnTorch').classList.remove('on');
    try { wakeLock && wakeLock.release(); } catch {} wakeLock = null;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    overlay.width = overlay.clientWidth * dpr; overlay.height = overlay.clientHeight * dpr;
  }
  window.addEventListener('resize', () => running && resize());

  // ánh xạ tọa độ video -> màn hình (video dùng object-fit: cover)
  function mapper() {
    const vw = video.videoWidth, vh = video.videoHeight, ow = overlay.width, oh = overlay.height;
    const s = Math.max(ow / vw, oh / vh), dx = (ow - vw * s) / 2, dy = (oh - vh * s) / 2;
    return p => [p[0] * s + dx, p[1] * s + dy];
  }

  const diagOf = () => Math.hypot(video.videoWidth, video.videoHeight);
  const qDiff = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p[0] - b[i][0], p[1] - b[i][1])));

  function detectFrame() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw) return;
    const s = 480 / Math.max(vw, vh);
    small.width = Math.round(vw * s); small.height = Math.round(vh * s);
    sctx.drawImage(video, 0, 0, small.width, small.height);
    let q = null;
    try { q = Vision.detect(sctx.getImageData(0, 0, small.width, small.height)); } catch (e) { console.warn(e); }
    if (q) {
      q = q.map(p => [p[0] / s, p[1] / s]);
      const diag = diagOf();
      if (det && qDiff(q, det) / diag < 0.022) stable++; else stable = Math.min(stable, 1);
      det = q; lost = 0;
      if (!armed && lastCapQ && qDiff(q, lastCapQ) / diag > 0.12) armed = true;
    } else {
      lost++;
      if (lost > 3) { det = null; stable = 0; armed = true; }
    }
  }

  function loop() {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    if (Vision.isReady && !capturing && now - lastDetect > 70) { lastDetect = now; detectFrame(); }

    // làm mượt
    if (det) shown = shown ? shown.map((p, i) => [p[0] + (det[i][0] - p[0]) * 0.45, p[1] + (det[i][1] - p[1]) * 0.45]) : det.map(p => p.slice());
    else shown = null;
    draw();

    if (capturing) return;
    if (now - justCaptured < 1300) { setHint('Đã chụp. Đưa trang tiếp theo vào khung', true); return; }
    if (!Vision.isReady) return;
    if (!auto) { setHint(det ? 'Bấm nút chụp' : 'Chế độ thủ công – bấm nút chụp'); return; }
    if (!det) { setHint(session.pages.length ? 'Đưa trang tiếp theo vào khung' : 'Đưa giấy tờ vào khung hình'); return; }
    if (!armed) { setHint('Đổi sang trang khác hoặc bấm Lưu'); return; }
    if (stable >= 2) setHint('Giữ yên…', true); else setHint('Đã thấy giấy tờ');
    if (stable >= STABLE_N && now - lastCapAt > 1500) capture(det);
  }

  function draw() {
    const W = overlay.width, H = overlay.height;
    octx.clearRect(0, 0, W, H);
    if (!shown || !video.videoWidth) return;
    const m = mapper(), pts = shown.map(m);
    const prog = auto && armed ? Math.min(1, stable / STABLE_N) : 0;
    octx.beginPath();
    pts.forEach((p, i) => i ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1]));
    octx.closePath();
    octx.fillStyle = `rgba(10,132,255,${0.22 + prog * 0.18})`;
    octx.fill();
    octx.lineWidth = 3 * (window.devicePixelRatio || 1);
    octx.strokeStyle = prog > 0.2 ? '#ffd60a' : 'rgba(10,132,255,0.95)';
    octx.lineJoin = 'round';
    octx.stroke();
  }

  async function capture(q) {
    if (capturing || !video.videoWidth) return;
    capturing = true;
    const f = $('flash'); f.classList.add('on'); setTimeout(() => f.classList.remove('on'), 60);
    if (navigator.vibrate) navigator.vibrate(30);
    const vw = video.videoWidth, vh = video.videoHeight;
    const c = document.createElement('canvas'); c.width = vw; c.height = vh;
    c.getContext('2d').drawImage(video, 0, 0, vw, vh);
    const quad = q ? q.map(p => [Math.max(0, Math.min(vw, p[0])), Math.max(0, Math.min(vh, p[1]))]) : fullQuad(vw, vh);
    lastCapQ = q; armed = false; stable = 0; lastCapAt = performance.now();
    try {
      const page = { quad, filter, rot: 0, rawW: vw, rawH: vh };
      page.raw = await canvasToBlob(c, 'image/jpeg', 0.92);
      await renderPage(page, c);
      session.pages.push(page);
      updateThumb(true);
      justCaptured = performance.now();
    } catch (e) {
      console.error(e); toast('Lỗi khi xử lý ảnh: ' + e.message);
    } finally {
      freeCanvas(c); capturing = false;
    }
  }

  // nút bấm
  $('shutter').onclick = () => capture(det);
  $('btnMode').onclick = () => { setMode(!auto); armed = true; toast(auto ? 'Tự chụp khi giữ yên' : 'Chụp thủ công'); };
  $('btnFilterQuick').onclick = () => $('filterBar').classList.toggle('hidden');
  $('filterBar').onclick = e => { const b = e.target.closest('button'); if (b) { setFilter(b.dataset.f); $('filterBar').classList.add('hidden'); } };
  $('btnTorch').onclick = async () => {
    const t = stream && stream.getVideoTracks()[0]; if (!t) return;
    const on = !$('btnTorch').classList.contains('on');
    try { await t.applyConstraints({ advanced: [{ torch: on }] }); $('btnTorch').classList.toggle('on', on); } catch {}
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) { stop(); Scanner._resume = true; }
    else if (!document.hidden && Scanner._resume && current === 'scanner') { Scanner._resume = false; start(); }
  });

  return { start, stop };
})();

function updateThumb(pop) {
  const n = session.pages.length, tb = $('thumbBtn');
  tb.classList.toggle('has', n > 0);
  $('thumbCount').textContent = n;
  $('scanSave').disabled = n === 0;
  $('scanSave').textContent = n ? `Lưu (${n})` : 'Lưu';
  if (n) {
    $('thumbImg').src = session.pages[n - 1].outUrl;
    if (pop) { tb.classList.remove('pop'); void tb.offsetWidth; tb.classList.add('pop'); }
  }
}

$('btnScan').onclick = () => { resetSession(); show('scanner'); Scanner.start(); };
$('scanCancel').onclick = () => {
  if (session.pages.length && !confirm('Bỏ các trang vừa quét?')) return;
  resetSession(); show('home'); renderList();
};
$('scanSave').onclick = () => openReview();
$('thumbBtn').onclick = () => openReview();

// ---------------- chọn ảnh có sẵn ----------------
$('btnImport').onclick = () => $('fileImport').click();
$('fileImport').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  if (!files.length) return;
  resetSession();
  busy(true, 'Đang tải bộ nhận diện…');
  try { await Promise.race([Vision.ready, sleep(25000)]); } catch {}
  busy(true, 'Đang xử lý ảnh…');
  for (const f of files) {
    try {
      const img = await loadImage(f);
      const c = imageToCanvas(img, 3200);
      const quad = detectOnCanvas(c) || fullQuad(c.width, c.height);
      const page = { quad, filter: Settings.get('filter'), rot: 0, rawW: c.width, rawH: c.height };
      page.raw = await canvasToBlob(c, 'image/jpeg', 0.92);
      await renderPage(page, c);
      freeCanvas(c);
      session.pages.push(page);
    } catch (err) { console.error(err); toast('Bỏ qua 1 ảnh lỗi: ' + err.message); }
  }
  busy(false);
  if (session.pages.length) openReview();
};

function detectOnCanvas(c) {
  if (!Vision.isReady) return null;
  const s = 480 / Math.max(c.width, c.height);
  const t = document.createElement('canvas');
  t.width = Math.round(c.width * s); t.height = Math.round(c.height * s);
  const x = t.getContext('2d'); x.drawImage(c, 0, 0, t.width, t.height);
  const q = Vision.detect(x.getImageData(0, 0, t.width, t.height));
  freeCanvas(t);
  return q ? q.map(p => [p[0] / s, p[1] / s]) : null;
}

// ================= XEM LẠI =================
function openReview() {
  if (!session.pages.length) return;
  Scanner.stop();
  show('review');
  if (!session.typeChosen) setDocType(session.pages.length === 2 && isCardShape(session.pages[0]) ? 'cccd' : (isCardShape(session.pages[0]) ? 'cccd' : 'gcn'));
  renderPager(session.pages.length - 1);
  updateNameHelp();
}
function isCardShape(p) {
  const r = Math.max(p.outW, p.outH) / Math.min(p.outW, p.outH);
  return Math.abs(r - 1.586) < 0.12;
}
function renderPager(goto) {
  const pg = $('pager');
  pg.innerHTML = session.pages.map((p, i) =>
    `<div class="page-slide"><img src="${p.outUrl}" alt="Trang ${i + 1}"><small>Trang ${i + 1} / ${session.pages.length}</small></div>`).join('');
  $('reviewTitle').textContent = `${session.pages.length} trang`;
  if (goto != null) {
    session.idx = Math.max(0, Math.min(goto, session.pages.length - 1));
    requestAnimationFrame(() => { pg.scrollLeft = session.idx * pg.clientWidth; });
  }
  syncFilterBar();
}
$('pager').addEventListener('scroll', () => {
  const pg = $('pager');
  session.idx = Math.round(pg.scrollLeft / Math.max(1, pg.clientWidth));
  syncFilterBar();
}, { passive: true });
function curPage() { return session.pages[session.idx]; }
function syncFilterBar() {
  const p = curPage(); if (!p) return;
  document.querySelectorAll('#reviewFilterBar button').forEach(b => b.classList.toggle('on', b.dataset.f === p.filter));
}
async function rerender(p) {
  busy(true, 'Đang xử lý…');
  try { await renderPage(p); } catch (e) { toast('Lỗi: ' + e.message); }
  busy(false);
  renderPager(session.idx);
}
$('toolRotate').onclick = () => { const p = curPage(); if (!p) return; p.rot = (p.rot + 1) % 4; rerender(p); };
$('toolFilter').onclick = () => $('reviewFilterBar').classList.toggle('hidden');
$('reviewFilterBar').onclick = e => {
  const b = e.target.closest('button'), p = curPage(); if (!b || !p) return;
  p.filter = b.dataset.f; rerender(p);
};
$('toolDelete').onclick = () => {
  const p = curPage(); if (!p) return;
  if (!confirm(`Xóa trang ${session.idx + 1}?`)) return;
  URL.revokeObjectURL(p.outUrl);
  session.pages.splice(session.idx, 1);
  updateThumb(false);
  if (!session.pages.length) { show('scanner'); Scanner.start(); return; }
  renderPager(session.idx);
};
$('toolCrop').onclick = () => { const p = curPage(); if (p) Cropper.open(p); };
$('reviewBack').onclick = () => { show('scanner'); Scanner.start(); };

function setDocType(t) {
  session.type = t;
  document.querySelectorAll('#docType button').forEach(b => b.classList.toggle('on', b.dataset.t === t));
  $('cccdMergeRow').classList.toggle('hidden', t !== 'cccd');
  $('docName').placeholder = t === 'gcn' ? 'VD: Nguyễn Văn A - thửa 125 tờ 12' : t === 'cccd' ? 'VD: Nguyễn Văn A' : 'VD: Hợp đồng chuyển nhượng';
  updateNameHelp();
}
$('docType').onclick = e => { const b = e.target.closest('button'); if (b) { session.typeChosen = true; setDocType(b.dataset.t); } };
function updateNameHelp() {
  $('nameHelp').textContent = 'Tên trên Drive: ' + makeFileName(session.type, $('docName').value, new Date()) +
    ` · thư mục "Quét giấy tờ/${TYPES[session.type].folder}"`;
}
$('docName').addEventListener('input', updateNameHelp);

// ---------------- tạo PDF ----------------
async function buildPdf(pages, type, merge) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'p', compress: true });
  const bytes = async b => new Uint8Array(await b.arrayBuffer());
  let first = true;
  const newPage = orient => { if (first) { first = false; if (orient === 'l') { pdf.deletePage(1); pdf.addPage('a4', 'l'); } } else pdf.addPage('a4', orient); };

  if (type === 'cccd' && merge) {
    const CW = 85.6, CH = 53.98;
    for (let i = 0; i < pages.length; i += 2) {
      newPage('p');
      const pair = pages.slice(i, i + 2);
      let y = 30;
      for (const p of pair) {
        const portrait = p.outH > p.outW;
        const w = portrait ? CH : CW, h = portrait ? CW : CH;
        pdf.addImage(await bytes(p.out), 'JPEG', (210 - w) / 2, y, w, h, undefined, 'FAST');
        y += h + 18;
      }
    }
  } else {
    for (const p of pages) {
      const land = p.outW > p.outH;
      newPage(land ? 'l' : 'p');
      const PW = land ? 297 : 210, PH = land ? 210 : 297;
      const r = Math.max(p.outW, p.outH) / Math.min(p.outW, p.outH);
      const m = Math.abs(r - 1.414) < 0.06 ? 0 : 8;
      const s = Math.min((PW - 2 * m) / p.outW, (PH - 2 * m) / p.outH);
      const w = p.outW * s, h = p.outH * s;
      pdf.addImage(await bytes(p.out), 'JPEG', (PW - w) / 2, (PH - h) / 2, w, h, undefined, 'FAST');
    }
  }
  return pdf.output('blob');
}

$('reviewSave').onclick = async () => {
  if (!session.pages.length) return;
  if (!window.jspdf) { alert('Chưa tải được thư viện tạo PDF. Kiểm tra mạng rồi thử lại.'); return; }
  busy(true, 'Đang tạo file PDF…');
  try {
    const now = new Date();
    const merge = session.type === 'cccd' && $('cccdMerge').checked;
    const pdf = await buildPdf(session.pages, session.type, merge);
    const doc = {
      id: 'd' + now.getTime() + Math.random().toString(36).slice(2, 6),
      name: cleanName($('docName').value),
      type: session.type,
      createdAt: now.getTime(),
      fileName: makeFileName(session.type, $('docName').value, now),
      pages: session.pages.map(p => ({ out: p.out, w: p.outW, h: p.outH })),
      pdf, size: pdf.size,
      status: Settings.get('url') ? 'pending' : 'local',
    };
    await DB.put(doc);
    resetSession();
    $('docName').value = ''; session.typeChosen = false;
    busy(false);
    show('home'); renderList();
    toast('Đã lưu trên máy' + (doc.status === 'pending' && Settings.get('autoUpload') ? ', đang đẩy lên Drive…' : ''));
    if (Settings.get('autoUpload')) Uploader.run();
  } catch (e) {
    busy(false); console.error(e); alert('Không lưu được: ' + e.message);
  }
};

// ================= CHỈNH GÓC =================
const Cropper = (() => {
  const stage = $('cropStage'), cv2 = $('cropCanvas'), ctx = cv2.getContext('2d');
  const loupe = $('loupe'), lctx = loupe.getContext('2d');
  let page, img, quad, fit, drag = -1;

  async function open(p) {
    page = p;
    busy(true, 'Đang mở ảnh…');
    try { img = imageToCanvas(await loadImage(p.raw)); } catch (e) { busy(false); toast(e.message); return; }
    busy(false);
    quad = p.quad.map(q => q.slice());
    show('cropper');
    requestAnimationFrame(layout);
  }
  function layout() {
    const dpr = window.devicePixelRatio || 1;
    cv2.width = stage.clientWidth * dpr; cv2.height = stage.clientHeight * dpr;
    const pad = 28 * dpr;
    const s = Math.min((cv2.width - 2 * pad) / img.width, (cv2.height - 2 * pad) / img.height);
    fit = { s, x: (cv2.width - img.width * s) / 2, y: (cv2.height - img.height * s) / 2, dpr };
    loupe.width = loupe.height = 110 * dpr;
    draw();
  }
  const toScreen = p => [fit.x + p[0] * fit.s, fit.y + p[1] * fit.s];
  const toImg = (x, y) => [Math.max(0, Math.min(img.width, (x - fit.x) / fit.s)), Math.max(0, Math.min(img.height, (y - fit.y) / fit.s))];
  function draw() {
    ctx.clearRect(0, 0, cv2.width, cv2.height);
    ctx.drawImage(img, fit.x, fit.y, img.width * fit.s, img.height * fit.s);
    const pts = quad.map(toScreen);
    // làm tối phần ngoài
    ctx.save();
    ctx.beginPath(); ctx.rect(fit.x, fit.y, img.width * fit.s, img.height * fit.s);
    pts.slice().reverse().forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]));
    ctx.closePath(); ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fill('evenodd'); ctx.restore();
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.lineWidth = 2 * fit.dpr; ctx.strokeStyle = '#ffd60a'; ctx.stroke();
    pts.forEach((p, i) => {
      ctx.beginPath(); ctx.arc(p[0], p[1], (drag === i ? 16 : 12) * fit.dpr, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fill();
      ctx.lineWidth = 3 * fit.dpr; ctx.strokeStyle = '#ffd60a'; ctx.stroke();
    });
  }
  function evPos(e) { const r = cv2.getBoundingClientRect(); return [(e.clientX - r.left) * fit.dpr, (e.clientY - r.top) * fit.dpr]; }
  function showLoupe(e) {
    const r = stage.getBoundingClientRect(), p = quad[drag];
    const lx = Math.min(r.width - 120, Math.max(10, e.clientX - r.left - 55));
    let ly = e.clientY - r.top - 150; if (ly < 10) ly = e.clientY - r.top + 40;
    loupe.style.left = lx + 'px'; loupe.style.top = ly + 'px'; loupe.style.display = 'block';
    const z = 3, L = loupe.width, srcSize = L / (fit.s * z);
    lctx.fillStyle = '#000'; lctx.fillRect(0, 0, L, L);
    lctx.drawImage(img, p[0] - srcSize / 2, p[1] - srcSize / 2, srcSize, srcSize, 0, 0, L, L);
    lctx.strokeStyle = '#ffd60a'; lctx.lineWidth = 2 * fit.dpr;
    lctx.beginPath(); lctx.moveTo(L / 2, L / 2 - 14 * fit.dpr); lctx.lineTo(L / 2, L / 2 + 14 * fit.dpr);
    lctx.moveTo(L / 2 - 14 * fit.dpr, L / 2); lctx.lineTo(L / 2 + 14 * fit.dpr, L / 2); lctx.stroke();
  }
  cv2.addEventListener('pointerdown', e => {
    const [x, y] = evPos(e);
    let best = -1, bd = 48 * fit.dpr;
    quad.map(toScreen).forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - y); if (d < bd) { bd = d; best = i; } });
    if (best < 0) return;
    drag = best; cv2.setPointerCapture(e.pointerId); draw(); showLoupe(e);
  });
  cv2.addEventListener('pointermove', e => {
    if (drag < 0) return;
    const [x, y] = evPos(e); quad[drag] = toImg(x, y); draw(); showLoupe(e);
  });
  const end = () => { drag = -1; loupe.style.display = 'none'; draw(); };
  cv2.addEventListener('pointerup', end); cv2.addEventListener('pointercancel', end);
  window.addEventListener('resize', () => current === 'cropper' && layout());

  $('cropCancel').onclick = () => { freeCanvas(img); history.back(); };
  $('cropFull').onclick = () => { quad = fullQuad(img.width, img.height); draw(); };
  $('cropAuto').onclick = () => {
    const q = detectOnCanvas(img);
    if (q) { quad = q; draw(); } else toast('Không tự nhận được mép giấy, hãy kéo tay');
  };
  $('cropDone').onclick = async () => {
    // sắp lại thứ tự góc phòng khi người dùng kéo chéo nhau
    page.quad = Vision.isReady ? Vision.order(quad.map(p => p.slice())) : quad;
    busy(true, 'Đang xử lý…');
    try { await renderPage(page, img); } catch (e) { toast('Lỗi: ' + e.message); }
    freeCanvas(img);
    busy(false);
    history.back();
    setTimeout(() => renderPager(session.idx), 50);
  };
  return { open };
})();

// ================= ĐẨY LÊN DRIVE =================
const Uploader = (() => {
  let runningP = null;
  async function call(payload) {
    const url = Settings.get('url');
    const r = await fetch(url, { method: 'POST', body: JSON.stringify(Object.assign({ secret: Settings.get('secret') }, payload)) });
    const text = await r.text();
    let j; try { j = JSON.parse(text); } catch { throw new Error('Apps Script trả về không đúng (kiểm tra lại URL và quyền "Bất kỳ ai")'); }
    if (!j.ok) throw new Error(j.error || 'Lỗi không rõ');
    return j;
  }
  async function uploadOne(doc) {
    doc.status = 'uploading'; await DB.put(doc); renderList();
    try {
      const data = await blobToBase64(doc.pdf);
      const j = await call({ action: 'upload', folder: TYPES[doc.type].folder, name: doc.fileName, mimeType: 'application/pdf', data });
      doc.status = 'done'; doc.driveUrl = j.url; doc.driveId = j.id; doc.error = '';
    } catch (e) {
      doc.status = 'error'; doc.error = navigator.onLine ? e.message : 'Mất mạng – sẽ tự đẩy khi có mạng';
    }
    await DB.put(doc); renderList();
    return doc.status === 'done';
  }
  async function run() {
    if (runningP) return runningP;
    if (!Settings.get('url') || !navigator.onLine) return;
    runningP = (async () => {
      const list = await DB.all();
      let ok = 0, fail = 0;
      for (const d of list.filter(d => d.status === 'pending' || d.status === 'error' || d.status === 'uploading' || d.status === 'local').reverse()) {
        (await uploadOne(d)) ? ok++ : fail++;
      }
      if (ok) toast(`Đã đẩy ${ok} file lên Google Drive`);
      if (fail) toast(`${fail} file chưa đẩy được – chạm vào để xem lỗi`, 3500);
    })().finally(() => { runningP = null; });
    return runningP;
  }
  window.addEventListener('online', () => Settings.get('autoUpload') && run());
  return { run, uploadOne, call };
})();

// ================= MÀN HÌNH CHÍNH =================
let filterType = '', thumbUrls = [];
async function renderList() {
  thumbUrls.forEach(u => URL.revokeObjectURL(u)); thumbUrls = [];
  const q = $('search').value.trim().toLowerCase().normalize('NFC');
  const all = await DB.all();
  const list = all.filter(d => (!filterType || d.type === filterType) && (!q || (d.fileName || '').toLowerCase().includes(q)));
  $('emptyState').classList.toggle('hidden', all.length > 0);
  $('setupBanner').classList.toggle('hidden', !!Settings.get('url'));
  const ul = $('docList'); ul.innerHTML = '';
  for (const d of list) {
    const li = document.createElement('li'); li.className = 'doc-item';
    const u = d.pages[0] ? URL.createObjectURL(d.pages[0].out) : ''; if (u) thumbUrls.push(u);
    const badge = {
      done: '<span class="badge ok">✓ Đã lên Drive</span>',
      pending: '<span class="badge wait">Đang chờ đẩy</span>',
      uploading: '<span class="badge wait">Đang đẩy…</span>',
      error: '<span class="badge err">Chưa đẩy được – chạm để xem</span>',
      local: '<span class="badge local">Chỉ trên máy</span>',
    }[d.status] || '';
    const dt = new Date(d.createdAt);
    li.innerHTML = `<img class="doc-thumb" src="${u}" alt="">
      <div class="doc-meta"><div class="doc-name"></div>
      <div class="doc-sub">${TYPES[d.type].label} · ${d.pages.length} trang · ${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(dt.getHours())}:${pad(dt.getMinutes())}</div>
      ${badge}</div>`;
    li.querySelector('.doc-name').textContent = d.name || d.fileName.replace(/\.pdf$/, '');
    li.onclick = () => openDetail(d.id);
    ul.appendChild(li);
  }
}
$('search').addEventListener('input', renderList);
$('typeFilter').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  filterType = b.dataset.t;
  document.querySelectorAll('#typeFilter button').forEach(x => x.classList.toggle('on', x === b));
  renderList();
};

// ================= CHI TIẾT =================
let detailDoc = null, detailUrls = [];
async function openDetail(id) {
  const d = await DB.get(id); if (!d) return;
  detailDoc = d;
  detailUrls.forEach(u => URL.revokeObjectURL(u));
  detailUrls = d.pages.map(p => URL.createObjectURL(p.out));
  $('detailTitle').textContent = d.name || TYPES[d.type].label;
  $('detailPages').innerHTML = detailUrls.map(u => `<img src="${u}" alt="">`).join('');
  const st = { done: 'Đã lên Google Drive', pending: 'Đang chờ đẩy', uploading: 'Đang đẩy', error: 'Chưa đẩy được', local: 'Chỉ lưu trên máy (chưa cài Drive)' }[d.status];
  $('detailInfo').innerHTML = `<b></b><br>${TYPES[d.type].label} · ${d.pages.length} trang · ${fmtSize(d.size)}<br>Trạng thái: ${st}` +
    (d.status === 'error' && d.error ? `<br><span style="color:var(--red)"></span>` : '');
  $('detailInfo').querySelector('b').textContent = d.fileName;
  if (d.status === 'error' && d.error) $('detailInfo').querySelector('span').textContent = 'Lỗi: ' + d.error;
  $('detailUpload').classList.toggle('hidden', d.status === 'done');
  $('detailOpenDrive').classList.toggle('hidden', !d.driveUrl);
  if (d.driveUrl) $('detailOpenDrive').href = d.driveUrl;
  show('detail');
}
$('detailBack').onclick = () => { show('home'); renderList(); };
$('detailShare').onclick = async () => {
  const d = detailDoc; if (!d) return;
  const file = new File([d.pdf], d.fileName, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: d.fileName }); } catch {}
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = d.fileName;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
};
$('detailUpload').onclick = async () => {
  if (!Settings.get('url')) { show('settings'); loadSettings(); toast('Nhập địa chỉ Apps Script trước'); return; }
  busy(true, 'Đang đẩy lên Drive…');
  const ok = await Uploader.uploadOne(detailDoc);
  busy(false);
  toast(ok ? 'Đã đẩy lên Google Drive' : 'Chưa đẩy được: ' + detailDoc.error, 3500);
  openDetail(detailDoc.id);
};
$('detailRename').onclick = async () => {
  const d = detailDoc; const n = prompt('Tên mới', d.name || '');
  if (n == null) return;
  d.name = cleanName(n); d.fileName = makeFileName(d.type, d.name, new Date(d.createdAt));
  if (d.status === 'done') toast('Tên trên Drive giữ nguyên, chỉ đổi trên máy');
  await DB.put(d); openDetail(d.id);
};
$('detailDelete').onclick = async () => {
  const d = detailDoc;
  const msg = d.status === 'done' ? 'Xóa file này khỏi máy? (Bản trên Google Drive vẫn còn)' : 'File này CHƯA lên Drive. Xóa khỏi máy là mất hẳn. Vẫn xóa?';
  if (!confirm(msg)) return;
  await DB.del(d.id); show('home'); renderList();
};

// ================= CÀI ĐẶT =================
function segSet(id, attr, val) { document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('on', b.dataset[attr] === val)); }
async function loadSettings() {
  $('setUrl').value = Settings.get('url'); $('setSecret').value = Settings.get('secret');
  $('setAutoUpload').checked = Settings.get('autoUpload'); $('setAutoCapture').checked = Settings.get('autoCapture');
  segSet('setFilter', 'f', Settings.get('filter')); segSet('setQuality', 'q', Settings.get('quality'));
  $('setTestResult').textContent = '';
  try {
    const all = await DB.all(), est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : null;
    const size = all.reduce((a, d) => a + (d.size || 0) * 2, 0);
    $('storageInfo').textContent = `${all.length} giấy tờ trên máy, khoảng ${fmtSize(size)}` +
      (est && est.quota ? ` · còn trống ~${fmtSize(est.quota - est.usage)}` : '');
  } catch {}
}
$('btnSettings').onclick = () => { loadSettings(); show('settings'); };
$('bannerSetup').onclick = () => { loadSettings(); show('settings'); };
$('settingsBack').onclick = () => { show('home'); renderList(); };
$('setUrl').onchange = () => { Settings.set('url', $('setUrl').value.trim()); };
$('setSecret').onchange = () => { Settings.set('secret', $('setSecret').value.trim()); };
$('setAutoUpload').onchange = e => Settings.set('autoUpload', e.target.checked);
$('setAutoCapture').onchange = e => Settings.set('autoCapture', e.target.checked);
$('setFilter').onclick = e => { const b = e.target.closest('button'); if (b) { Settings.set('filter', b.dataset.f); segSet('setFilter', 'f', b.dataset.f); } };
$('setQuality').onclick = e => { const b = e.target.closest('button'); if (b) { Settings.set('quality', b.dataset.q); segSet('setQuality', 'q', b.dataset.q); } };
$('setTest').onclick = async () => {
  Settings.set('url', $('setUrl').value.trim()); Settings.set('secret', $('setSecret').value.trim());
  const out = $('setTestResult');
  if (!/^https:\/\/script\.google\.com\/.+\/exec/.test(Settings.get('url'))) { out.textContent = '⚠ Địa chỉ phải có dạng https://script.google.com/macros/s/…/exec'; return; }
  out.textContent = 'Đang kiểm tra…';
  try {
    const j = await Uploader.call({ action: 'ping' });
    out.innerHTML = '✅ Đã nối được Google Drive' + (j.email ? ' của <b></b>' : '') + '. File sẽ nằm trong thư mục "Quét giấy tờ".';
    if (j.email) out.querySelector('b').textContent = j.email;
    // đổi các file "chỉ trên máy" sang chờ đẩy
    for (const d of await DB.all()) if (d.status === 'local') { d.status = 'pending'; await DB.put(d); }
    if (Settings.get('autoUpload')) Uploader.run();
  } catch (e) { out.textContent = '❌ ' + e.message; }
};
$('setCleanup').onclick = async () => {
  const done = (await DB.all()).filter(d => d.status === 'done');
  if (!done.length) { toast('Không có file nào đã lên Drive'); return; }
  if (!confirm(`Xóa ${done.length} file đã lên Drive khỏi máy? Bản trên Drive vẫn còn.`)) return;
  for (const d of done) await DB.del(d.id);
  loadSettings(); toast('Đã dọn xong');
};

// ================= KHỞI ĐỘNG =================
(async () => {
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  await renderList();
  if (Settings.get('autoUpload')) Uploader.run();
})();

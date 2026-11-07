// Lưu giấy tờ trên máy bằng IndexedDB (ảnh lưu dạng Blob)
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('quet-giay-to', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('docs')) d.createObjectStore('docs', { keyPath: 'id' });
      };
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction('docs', mode);
      const s = t.objectStore('docs');
      let out;
      const req = fn(s);
      if (req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Giao dịch bị hủy'));
    });
  }
  return {
    put: doc => tx('readwrite', s => s.put(doc)),
    get: id => tx('readonly', s => s.get(id)),
    del: id => tx('readwrite', s => s.delete(id)),
    all: async () => {
      const list = (await tx('readonly', s => s.getAll())) || [];
      return list.sort((a, b) => b.createdAt - a.createdAt);
    },
  };
})();

// Cài đặt (lưu localStorage, bọc try/catch)
const Settings = (() => {
  const KEY = 'qgt-settings';
  const def = { url: '', secret: '', autoUpload: true, saveToFiles: true, autoCapture: true, filter: 'color', quality: 'high' };
  let cur;
  try { cur = Object.assign({}, def, JSON.parse(localStorage.getItem(KEY) || '{}')); }
  catch { cur = Object.assign({}, def); }
  return {
    get: k => cur[k],
    set(k, v) { cur[k] = v; try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch {} },
  };
})();

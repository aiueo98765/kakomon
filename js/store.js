// IndexedDB の薄いラッパー。すべてこの端末のブラウザの中だけに保存する。
const DB_NAME = 'kakomon';
const STORES = ['kv', 'ink', 'attempts', 'keys', 'files', 'chats'];
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

export const db = {
  get: (store, key) => tx(store, 'readonly', s => s.get(key)),
  put: (store, key, val) => tx(store, 'readwrite', s => s.put(val, key)),
  del: (store, key) => tx(store, 'readwrite', s => s.delete(key)),
  keys: (store) => tx(store, 'readonly', s => s.getAllKeys()),
  all: (store) => open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const s = t.objectStore(store);
    const out = [];
    const c = s.openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (cur) { out.push([cur.key, cur.value]); cur.continue(); } else resolve(out);
    };
    c.onerror = () => reject(c.error);
  })),
};

// 設定は localStorage（キーや機種名など小さいもの）
export const settings = {
  get(k, d = null) { try { const v = localStorage.getItem('kakomon.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('kakomon.' + k, JSON.stringify(v)); } catch (e) {} },
};

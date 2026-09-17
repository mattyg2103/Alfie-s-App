// Minimal promise-based IndexedDB wrapper for storing binary files
// (photos, videos, recorded audio) locally on the device only.
const MVSS_DB_NAME = "mvss_db";
const MVSS_DB_VERSION = 1;
const MVSS_STORE = "files";

function mvssOpenDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(MVSS_DB_NAME, MVSS_DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(MVSS_STORE)) {
        req.result.createObjectStore(MVSS_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(id, blob) {
  const db = await mvssOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MVSS_STORE, "readwrite");
    tx.objectStore(MVSS_STORE).put(blob, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet(id) {
  if (!id) return null;
  const db = await mvssOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MVSS_STORE, "readonly");
    const r = tx.objectStore(MVSS_STORE).get(id);
    r.onsuccess = () => resolve(r.result || null);
    r.onerror = () => reject(r.error);
  });
}

async function idbDelete(id) {
  if (!id) return;
  const db = await mvssOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MVSS_STORE, "readwrite");
    tx.objectStore(MVSS_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClearAll() {
  const db = await mvssOpenDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MVSS_STORE, "readwrite");
    tx.objectStore(MVSS_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Runtime cache of object URLs so we don't leak / recreate them constantly.
const _mvssObjectUrlCache = new Map();
async function idbGetObjectUrl(id) {
  if (!id) return null;
  if (_mvssObjectUrlCache.has(id)) return _mvssObjectUrlCache.get(id);
  const blob = await idbGet(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  _mvssObjectUrlCache.set(id, url);
  return url;
}
function idbForgetObjectUrl(id) {
  if (_mvssObjectUrlCache.has(id)) {
    URL.revokeObjectURL(_mvssObjectUrlCache.get(id));
    _mvssObjectUrlCache.delete(id);
  }
}

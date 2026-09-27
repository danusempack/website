/* core/db.js — IndexedDB. Everything the user opens stays on their device:
   presets (XML text + optional media blobs), media library, settings, bookmarks.

   Stores
     presets : { id, name, added, xml, mediaMap, w, h, duration, fps }
     media   : { id, name, type, size, added, blob }
     kv      : { k, v }   settings + per-preset bookmarks

   No network calls anywhere in this file.
*/

const DB_NAME = 'am-preset-studio';
const DB_VER = 1;

let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) {
      reject(new Error('IndexedDB tidak tersedia di browser ini.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('presets')) {
        db.createObjectStore('presets', { keyPath: 'id' })
          .createIndex('added', 'added');
      }
      if (!db.objectStoreNames.contains('media')) {
        db.createObjectStore('media', { keyPath: 'id' })
          .createIndex('added', 'added');
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Gagal membuka IndexedDB.'));
    req.onblocked = () => reject(new Error('IndexedDB diblokir tab lain. Tutup tab lain lalu coba lagi.'));
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return await new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); }
    catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaksi IndexedDB dibatalkan.'));
  });
}

const wrap = (req) => new Promise((res, rej) => {
  req.onsuccess = () => res(req.result);
  req.onerror = () => rej(req.error);
});

/* ---------------- presets ---------------- */

export async function savePreset(rec) {
  await tx('presets', 'readwrite', (s) => s.put(rec));
  return rec.id;
}

export async function listPresets(limit = 40) {
  const all = await tx('presets', 'readonly', (s) => wrap(s.getAll()));
  return (all || []).sort((a, b) => b.added - a.added).slice(0, limit)
    .map(({ id, name, added, w, h, duration, fps, mediaCount }) =>
      ({ id, name, added, w, h, duration, fps, mediaCount }));
}

export async function getPreset(id) {
  return await tx('presets', 'readonly', (s) => wrap(s.get(id)));
}

export async function deletePreset(id) {
  await tx('presets', 'readwrite', (s) => s.delete(id));
  await setKV('bookmarks:' + id, undefined);
}

/* ---------------- media library ---------------- */

export async function putMedia(rec) {
  await tx('media', 'readwrite', (s) => s.put(rec));
  return rec.id;
}

export async function listMedia(limit = 300) {
  const all = await tx('media', 'readonly', (s) => wrap(s.getAll()));
  return (all || []).sort((a, b) => b.added - a.added).slice(0, limit);
}

export async function getMedia(id) {
  return await tx('media', 'readonly', (s) => wrap(s.get(id)));
}

export async function deleteMedia(id) {
  await tx('media', 'readwrite', (s) => s.delete(id));
}

/* ---------------- key/value ---------------- */

export async function setKV(k, v) {
  if (v === undefined) return await tx('kv', 'readwrite', (s) => s.delete(k));
  return await tx('kv', 'readwrite', (s) => s.put({ k, v }));
}

export async function getKV(k, fallback = null) {
  const rec = await tx('kv', 'readonly', (s) => wrap(s.get(k)));
  return rec ? rec.v : fallback;
}

/** Best-effort storage usage report for the settings dialog. */
export async function usage() {
  try {
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      return { used: e.usage || 0, quota: e.quota || 0 };
    }
  } catch { /* ignore */ }
  return { used: 0, quota: 0 };
}

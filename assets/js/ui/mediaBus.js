/* ui/mediaBus.js — shared media library state.

   Both the loader (preset slot binding) and the Media tab talk through this,
   so there is exactly one copy of the gallery in memory and one place that
   writes to IndexedDB.
*/

import { emit, EV } from '../core/bus.js';
import { state, setGallery } from '../core/store.js';
import * as db from '../core/db.js';
import { hashStr, isAudioFile, isImageFile, isVideoFile } from '../core/util.js';
import log from '../core/log.js';

const MAX_ITEM = 512 * 1024 * 1024;   // refuse absurd single files

/** uri -> Blob. The preset references media by filename, so that is the key. */
const byName = new Map();
/** uri -> object URL, cached for <img>/<video> src use. */
const urls = new Map();
/** preset slot uri -> gallery filename chosen by the user. */
const alias = new Map();

export const mediaBus = {
  async refresh() {
    try {
      const recs = await db.listMedia();
      for (const r of recs) {
        const full = await db.getMedia(r.id);
        if (full?.blob && !byName.has(full.name)) byName.set(full.name, full.blob);
      }
      setGallery(recs);
    } catch (err) {
      log.warn('Galeri media gagal dibaca: ' + err.message);
    }
  },

  async importFiles(files) {
    let n = 0;
    for (const f of files) {
      if (f.size > MAX_ITEM) {
        log.warn(`${f.name} dilewati: ${fmt(f.size)} melebihi batas 512 MB.`);
        continue;
      }
      if (!isImageFile(f) && !isVideoFile(f) && !isAudioFile(f)) {
        log.warn(`${f.name} dilewati: tipe tidak didukung.`);
        continue;
      }
      const id = 'm_' + hashStr(f.name + f.size + f.lastModified).toString(36);
      try {
        await db.putMedia({
          id, name: f.name, type: f.type || guessType(f), size: f.size,
          added: Date.now(), blob: f,
        });
        byName.set(f.name, f);
        n++;
      } catch (err) {
        log.err(`${f.name} gagal disimpan: ${err.message}`);
      }
    }
    if (n) await this.refresh();
    emit(EV.MEDIA_CHANGED);
    return n;
  },

  async remove(id) {
    await db.deleteMedia(id);
    await this.refresh();
    emit(EV.MEDIA_CHANGED);
  },

  /** Point a preset slot uri at a gallery file. */
  bind(uri, name) { alias.set(uri, name); },

  /** uri (preset slot) -> Blob, honouring a user binding. */
  blob(uri) {
    const n = alias.get(uri);
    return (n && byName.get(n)) || byName.get(uri) || null;
  },

  /** uri -> stable object URL (created on demand, cached). */
  url(uri) {
    const n = alias.get(uri);
    const key = n || uri;
    if (urls.has(key)) return urls.get(key);
    const b = this.blob(uri);
    if (!b) return null;
    const u = URL.createObjectURL(b);
    urls.set(key, u);
    return u;
  },

  /** Every imported blob keyed by BOTH the real filename and any bound slot. */
  allBlobs() {
    const m = new Map(byName);
    for (const [uri, name] of alias) {
      const b = byName.get(name);
      if (b) m.set(uri, b);
    }
    return m;
  },

  has(uri) { return !!this.blob(uri); },
};

function guessType(f) {
  if (isVideoFile(f)) return 'video/mp4';
  if (isAudioFile(f)) return 'audio/mpeg';
  if (isImageFile(f)) return 'image/png';
  return 'application/octet-stream';
}

const fmt = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');

/** Distinct media slots the current preset references, in first-seen order. */
export function presetSlots(scene) {
  const out = [];
  const seen = new Set();
  const walk = (layers) => {
    for (const l of layers) {
      if (l.uri && !seen.has(l.uri)) {
        seen.add(l.uri);
        out.push({ uri: l.uri, kind: l.kind, meta: scene.media[l.uri] || null });
      }
      if (l.children?.length) walk(l.children);
    }
  };
  if (scene) walk(scene.layers);
  return out;
}

/** Which gallery item currently fills a slot (by name match). */
export const slotFilled = (uri) => state.gallery.some((g) => g.name === uri) || mediaBus.has(uri);

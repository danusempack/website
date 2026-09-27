/* ui/loader.js — getting a preset into the app: file picker, drag & drop,
   IndexedDB recents, and the built-in demo.

   All paths are local. There is no upload, no fetch of remote presets.
*/

import { $, el, icon, fmtBytes, fmtTime, readTextCapped } from '../core/util.js';
import { on, emit, EV } from '../core/bus.js';
import { state, setScene, clearScene, setRecent, setTime } from '../core/store.js';
import { LIMITS } from '../am/parser.js';
import { parseInWorker } from '../core/xmlClient.js';
import * as db from '../core/db.js';
import toast from '../core/toast.js';
import log from '../core/log.js';
import { mediaBus } from './mediaBus.js';

const XML_RE = /\.xml$/i;
const MEDIA_RE = /\.(mp4|webm|mov|m4v|mp3|m4a|aac|wav|ogg|opus|flac|png|jpe?g|gif|webp|avif|bmp)$/i;

let busyTitle = null, busyNote = null, busyBox = null, player = null, onLoaded = null;

export function setBusy(title, note = '', cancellable = false) {
  if (!busyBox) return;
  busyTitle.textContent = title;
  busyNote.textContent = note;
  busyBox.hidden = !title;
  $('#busyClose').hidden = !cancellable;
}

const showXmlState = (msg, kind = '') => {
  const box = $('#xmlState');
  if (!box) return;
  box.textContent = msg;
  box.className = 'statusbox' + (kind ? ' ' + kind : '');
};

function setSubtitle() {
  const s = $('#subtitle');
  if (!s) return;
  if (!state.scene) { s.textContent = 'siap'; return; }
  s.textContent = `${state.scene.name} · ${state.scene.layers.length} layer · ${fmtTime(state.scene.duration)}`;
}

/** Parse one XML string and install it as the active preset. */
export async function loadXMLText(text, name, { save = true } = {}) {
  setBusy('Memuat preset…', name);
  try {
    const scene = await parseInWorker(text, name);
    setScene(scene, text);
    setTime(0);

    // attach any media the user already imported, matched by filename
    const blobs = new Map();
    for (const m of state.gallery) {
      const rec = await db.getMedia(m.id);
      if (rec?.blob) blobs.set(rec.name, rec.blob);
    }
    await onLoaded?.(scene, blobs);

    if (save) {
      try {
        const id = 'p_' + Date.now().toString(36);
        await db.savePreset({
          id, name, added: Date.now(), xml: text,
          w: scene.w, h: scene.h, duration: scene.duration, fps: scene.fps,
          mediaCount: Object.keys(scene.media).length,
        });
        await refreshRecent();
      } catch (err) { log.warn('gagal menyimpan ke recent: ' + err.message); }
    }

    log.ok(`${name}: ${scene.layers.length} layer, ${fmtTime(scene.duration)}`);
    for (const n of scene.notes) log.warn(n);
    toast.ok(`Preset dimuat: ${name}`);
    emit(EV.MEDIA_CHANGED);
    return scene;
  } catch (err) {
    const msg = err?.code === 'TOO_LARGE'
      ? `File terlalu besar (batas ${fmtBytes(LIMITS.MAX_XML_BYTES)}).`
      : err?.message || 'Gagal memuat preset.';
    showXmlState(msg, 'bad');
    toast.err(msg);
    log.err(`${name}: ${msg}`);
    return null;
  } finally {
    setBusy('');
  }
}

/** Handle a FileList from the picker or a drop. */
export async function handleFiles(files) {
  const list = [...files];
  const xmls = list.filter((f) => XML_RE.test(f.name) || /xml/.test(f.type));
  const media = list.filter((f) => MEDIA_RE.test(f.name) || /^(image|video|audio)\//.test(f.type));

  if (media.length) {
    await mediaBus.importFiles(media);
    toast.ok(`${media.length} media masuk galeri.`);
  }

  if (!xmls.length) {
    if (!media.length) toast.warn('Tidak ada file .xml atau media yang bisa dibaca.');
    return;
  }

  if (xmls.length > 1) {
    // Preset + group/cc: let the user pick which one to play.
    const sel = $('#multiPick');
    sel.textContent = '';
    const opts = [];
    for (const f of xmls) {
      const text = await readTextCapped(f, LIMITS.MAX_XML_BYTES);
      opts.push({ f, text });
    }
    for (const o of opts) {
      sel.append(el('option', { value: o.text, text: o.f.name }));
    }
    $('#multiPickRow').hidden = false;
    showXmlState(`${xmls.length} file XML. Pilih yang mau diputar.`);
    sel.onchange = () => loadXMLText(sel.value, sel.selectedOptions[0].textContent);
    // Presets are small enough to keep in options; the biggest is chosen by default.
    if (opts.length) sel.value = opts[opts.length - 1].text;
    return;
  }

  const f = xmls[0];
  try {
    const text = await readTextCapped(f, LIMITS.MAX_XML_BYTES);
    $('#multiPickRow').hidden = true;
    showXmlState(`${f.name} — ${fmtBytes(f.size)}`);
    await loadXMLText(text, f.name);
  } catch (err) {
    showXmlState(err.message, 'bad');
    toast.err(err.message);
  }
}

export async function refreshRecent() {
  try {
    const recents = await db.listPresets(24);
    setRecent(recents);
    const host = $('#recentList');
    if (!host) return;
    host.textContent = '';
    $('#recentCount').textContent = recents.length ? `${recents.length}` : '';
    if (!recents.length) {
      host.append(el('div', { class: 'empty', text: 'Belum ada preset tersimpan.' }));
      return;
    }
    for (const r of recents) {
      const item = el('div', { class: 'recitem' }, [
        el('button', {
          class: 'rec-open', type: 'button',
          onclick: async () => {
            const full = await db.getPreset(r.id);
            if (!full) { toast.err('Preset tidak ditemukan di penyimpanan lokal.'); return; }
            await loadXMLText(full.xml, full.name, { save: false });
          },
        }, [
          el('span', { class: 'rec-name', text: r.name }),
          el('span', {
            class: 'rec-meta',
            text: `${r.w}×${r.h} · ${fmtTime(r.duration)} · ${new Date(r.added).toLocaleDateString('id-ID')}`,
          }),
        ]),
        el('button', {
          class: 'btn sm icon quiet', type: 'button', 'aria-label': `Hapus ${r.name} dari daftar`,
          onclick: async () => { await db.deletePreset(r.id); await refreshRecent(); },
        }, [icon('trash', 'ico sm')]),
      ]);
      host.append(item);
    }
  } catch (err) {
    log.warn('IndexedDB belum siap: ' + err.message);
  }
}

export async function loadDemo() {
  try {
    const res = await fetch('assets/data/demo.json', { cache: 'force-cache' });
    if (!res.ok) throw new Error('demo.json tidak ditemukan');
    const demo = await res.json();
    showXmlState('preset demo');
    await loadXMLText(demo.xml, demo.name, { save: false });
  } catch (err) {
    toast.err('Preset demo gagal dimuat: ' + err.message);
  }
}

export function initLoader({ onPresets, getPlayer } = {}) {
  busyBox = $('#stagebusy');
  busyTitle = $('#busyTitle');
  busyNote = $('#busyNote');
  onLoaded = onPresets;
  player = getPlayer;

  $('#inXml').addEventListener('change', (e) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  });

  $('#btnOpen').addEventListener('click', () => $('#inXml').click());
  $('#btnDemo').addEventListener('click', loadDemo);

  $('#btnReset').addEventListener('click', () => {
    clearScene();
    showXmlState('preset aktif dihapus');
    setSubtitle();
    toast('Preset aktif dihapus.');
  });

  // drag & drop anywhere on the document
  const veil = $('#dropveil');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (++depth === 1) veil.classList.add('on');
  });
  addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) { depth = 0; veil.classList.remove('on'); }
  });
  addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    veil.classList.remove('on');
    if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files);
  });

  $('#busyClose').addEventListener('click', () => setBusy(''));

  on(EV.PRESET_LOADED, setSubtitle);
  on(EV.PRESET_CLEARED, setSubtitle);

  refreshRecent();
}

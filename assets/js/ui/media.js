/* ui/media.js — Media tab: preset slots, gallery, and the slot picker dialog. */

import { $, el, icon, fmtBytes } from '../core/util.js';
import { on, emit, EV } from '../core/bus.js';
import { state, updateSetting } from '../core/store.js';
import { mediaBus, presetSlots } from './mediaBus.js';
import { placeholderDataURL } from '../gl/media.js';
import toast from '../core/toast.js';
import * as db from '../core/db.js';

let pickTarget = null;   // uri of the slot being filled
let getPlayer = null;

function thumb(name) {
  const url = name ? mediaBus.url(name) : null;
  if (url && /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(name)) {
    return el('img', { class: 'gthumb', src: url, alt: '', loading: 'lazy', decoding: 'async' });
  }
  if (url && /\.(mp4|webm|mov|m4v)$/i.test(name)) {
    return el('video', { class: 'gthumb', src: url, muted: true, playsinline: true, preload: 'metadata' });
  }
  return el('img', { class: 'gthumb ph', src: placeholderDataURL(200, 200, name.length), alt: '' });
}

function kindIcon(name) {
  if (/\.(mp4|webm|mov|m4v)$/i.test(name)) return 'film';
  if (/\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(name)) return 'music';
  return 'img';
}

function renderSlots() {
  const host = $('#slotList');
  if (!host) return;
  const scene = state.scene;
  host.textContent = '';

  if (!scene) {
    host.append(el('div', { class: 'empty', text: 'Belum ada preset dimuat.' }));
    $('#slotCount').textContent = '';
    return;
  }

  const slots = presetSlots(scene);
  $('#slotCount').textContent = slots.length ? `${slots.length} slot` : 'tidak ada';

  if (!slots.length) {
    host.append(el('div', { class: 'empty', text: 'Preset ini tidak butuh media eksternal.' }));
    return;
  }

  for (const s of slots) {
    const filled = mediaBus.has(s.uri);
    const row = el('div', { class: 'slotrow' + (filled ? ' ok' : ' miss') }, [
      el('div', { class: 'slotprev' }, [thumb(s.uri)]),
      el('div', { class: 'slotinfo' }, [
        el('div', { class: 'slot-name', text: s.uri, title: s.uri }),
        el('div', {
          class: 'slot-sub',
          text: filled
            ? `terisi — ${s.kind}${s.meta?.w ? ` · ${s.meta.w}×${s.meta.h}` : ''}`
            : `kosong — akan tampil placeholder`,
        }),
      ]),
      el('div', { class: 'slot-act' }, [
        el('button', {
          class: 'btn sm', type: 'button',
          onclick: () => openPicker(s.uri),
        }, ['Ganti media']),
      ]),
    ]);
    host.append(row);
  }
}

function renderGallery() {
  const host = $('#gallery');
  if (!host) return;
  host.textContent = '';
  const g = state.gallery;
  $('#galleryCount').textContent = g.length ? `${g.length} berkas` : '';

  if (!g.length) {
    host.append(el('div', { class: 'empty', text: 'Belum ada media.' }));
    return;
  }

  for (const item of g) {
    const card = el('figure', { class: 'gcard' }, [
      el('div', { class: 'gprev' }, [thumb(item.name), el('span', { class: 'gkind' }, [icon(kindIcon(item.name), 'ico sm')])]),
      el('figcaption', { class: 'gmeta' }, [
        el('span', { class: 'gname', text: item.name, title: item.name }),
        el('span', { class: 'gsize', text: fmtBytes(item.size) }),
      ]),
      el('div', { class: 'gact' }, [
        el('button', {
          class: 'btn sm', type: 'button',
          title: 'Pasang ke slot yang dipilih',
          onclick: () => {
            if (!pickTarget) { toast('Buka dulu panel Layer lalu pilih slot kosong.'); return; }
            applyToSlot(pickTarget, item.name);
          },
        }, ['Pakai']),
        el('button', {
          class: 'btn sm icon quiet', type: 'button', 'aria-label': `Hapus ${item.name}`,
          onclick: async () => { await mediaBus.remove(item.id); },
        }, [icon('trash', 'ico sm')]),
      ]),
    ]);
    host.append(card);
  }
}

function applyToSlot(uri, name) {
  const blob = mediaBus.blob(name);
  if (!blob) { toast.err('Berkas tidak ditemukan di galeri.'); return; }
  // The compositor keys textures by uri, so hand it the same key the preset uses.
  mediaBus.bind(uri, name);
  renderSlots();
  emit(EV.MEDIA_CHANGED);
  getPlayer?.()?.markDirty();
  toast.ok(`Slot ${uri} diisi dengan ${name}.`);
  $('#dlgPicker')?.close();
}

// Let mediaBus expose a manual alias (a gallery file standing in for a preset slot).

function openPicker(uri) {
  pickTarget = uri;
  const grid = $('#pickerGrid');
  grid.textContent = '';
  const g = state.gallery;
  if (!g.length) {
    grid.append(el('div', { class: 'empty', text: 'Galeri kosong. Tambahkan media dulu di tab Media.' }));
  }
  for (const item of g) {
    grid.append(el('button', {
      class: 'gcard pick', type: 'button',
      onclick: () => applyToSlot(uri, item.name),
    }, [
      el('div', { class: 'gprev' }, [thumb(item.name)]),
      el('span', { class: 'gname', text: item.name, title: item.name }),
    ]));
  }
  $('#dlgPicker')?.showModal();
}

export function initMedia({ getPlayer: gp } = {}) {
  getPlayer = gp;

  $('#inMedia').addEventListener('change', async (e) => {
    if (e.target.files?.length) {
      const n = await mediaBus.importFiles(e.target.files);
      if (n) toast.ok(`${n} media disimpan ke perangkat ini.`);
    }
    e.target.value = '';
  });

  // display sliders
  const ps = $('#photoScale'), psv = $('#photoScaleVal');
  ps.addEventListener('input', () => {
    const v = parseFloat(ps.value);
    psv.textContent = v.toFixed(2) + 'x';
    updateSetting('photoScale', v);
    getPlayer?.()?.markDirty();
  });

  $('#boxScale').addEventListener('change', (e) => {
    const v = e.target.value;
    updateSetting('boxScale', v === 'auto' ? 2 : parseInt(v, 10));
    getPlayer?.()?.markDirty();
  });

  on(EV.SETTINGS, ({ key }) => {
    if (key === 'photoScale' || key === '*') {
      ps.value = state.photoScale;
      psv.textContent = state.photoScale.toFixed(2) + 'x';
    }
    if (key === 'boxScale' || key === '*') {
      $('#boxScale').value = state.boxScale === 2 ? 'auto' : String(state.boxScale);
    }
  });

  on(EV.PRESET_LOADED, renderSlots);
  on(EV.PRESET_CLEARED, renderSlots);
  on(EV.GALLERY_CHANGED, renderGallery);

  renderSlots();
  renderGallery();
}

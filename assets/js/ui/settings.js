/* ui/settings.js — settings dialog, audio tab wiring, capabilities report. */

import { $, el, fmtBytes, fmtRate, fmtTime, clamp } from '../core/util.js';
import { on, EV } from '../core/bus.js';
import { state, updateSetting } from '../core/store.js';
import * as db from '../core/db.js';
import { workerAvailable } from '../core/xmlClient.js';
import { KNOWN_FX } from '../gl/effects.js';
import { mountLog, clearLog } from '../core/log.js';
import { pickMime } from './export.js';
import log from '../core/log.js';
import toast from '../core/toast.js';

const SHORTCUTS = [
  ['Space', 'Putar / jeda'],
  ['← / →', 'Geser 0,1 detik'],
  ['Shift + ← / →', 'Geser 1 detik'],
  ['Home / End', 'Lompat ke awal / akhir'],
  ['B', 'Tambah / hapus penanda waktu'],
  [', / .', 'Penanda sebelumnya / berikutnya'],
  ['1 – 5', 'Pindah tab'],
  ['L', 'Buka / tutup inspector render'],
  ['K', 'Tambah media ke galeri'],
  ['F', 'Muat timeline ke layar'],
  ['?', 'Buka pengaturan'],
];

export function initSettings() {
  const dlg = $('#dlgSettings');

  $('#btnSettings').addEventListener('click', async () => {
    dlg.showModal();
    await refreshInfo();
  });
  dlg.addEventListener('close', () => { /* nothing to persist here */ });

  /* theme */
  $('#btnTheme').addEventListener('click', async () => {
    const { toggle } = await import('../core/theme.js');
    toggle();
  });

  /* quality */
  const q = $('#setQuality');
  q.value = String(state.quality);
  q.addEventListener('change', () => {
    updateSetting('quality', parseInt(q.value, 10));
    renderResInfo();
  });

  const fps = $('#setFps'), fpsRow = $('#setFpsRow'), fpsNum = $('#setFpsNum');
  const applyFps = (v) => updateSetting('fps', clamp(v, 1, 120));
  fps.addEventListener('change', () => {
    if (fps.value === 'custom') { fpsRow.hidden = false; applyFps(parseInt(fpsNum.value, 10) || 30); }
    else { fpsRow.hidden = true; applyFps(parseInt(fps.value, 10)); }
  });
  fpsNum.addEventListener('input', () => applyFps(parseInt(fpsNum.value, 10) || 30));

  const bindCheck = (id, key, after) => {
    const n = $(id);
    n.checked = !!state[key];
    n.addEventListener('change', () => { updateSetting(key, n.checked); after?.(n.checked); });
  };
  bindCheck('#setAutoQ', 'autoQ');
  bindCheck('#setFx', 'fxEnabled', () => window.dispatchEvent(new CustomEvent('studio:dirty')));
  bindCheck('#setDebug', 'debug');
  bindCheck('#setKeepAwake', 'keepAwake');

  on(EV.SETTINGS, ({ key }) => {
    if (key === 'quality' || key === '*') { q.value = String(state.quality); renderResInfo(); }
    if (key === 'fps' || key === '*') {
      fps.value = [15, 24, 30, 60].includes(state.fps) ? String(state.fps) : 'custom';
      fpsRow.hidden = fps.value !== 'custom';
      fpsNum.value = String(state.fps);
    }
    if (key === 'autoQ' || key === '*') $('#setAutoQ').checked = state.autoQ;
    if (key === 'fxEnabled' || key === '*') $('#setFx').checked = state.fxEnabled;
    if (key === 'debug' || key === '*') $('#setDebug').checked = state.debug;
    if (key === 'keepAwake' || key === '*') $('#setKeepAwake').checked = state.keepAwake;
  });

  /* shortcuts table */
  const tb = $('#shortcutTable tbody');
  tb.textContent = '';
  for (const [k, v] of SHORTCUTS) {
    tb.append(el('tr', {}, [
      el('th', { scope: 'row' }, [el('kbd', { text: k })]),
      el('td', { text: v }),
    ]));
  }

  $('#btnClearLog').addEventListener('click', () => { clearLog(); log.ok('log dibersihkan'); });
  mountLog($('#logbox'));

  renderResInfo();
  $('#fxKnown').textContent = String(KNOWN_FX);
  window.addEventListener('studio:dirty', () => { /* hook for other modules */ });
}

function renderResInfo() {
  const scene = state.scene;
  const box = $('#setResInfo');
  if (!box) return;
  if (!scene) { box.textContent = 'Aktifkan preset untuk melihat rasio aspek.'; return; }
  const ar = scene.w / scene.h;
  const w = Math.round(state.quality * ar);
  const px = w * state.quality;
  box.textContent = `Preset ${scene.w}×${scene.h} (${ar.toFixed(3)}:1) → ${w}×${state.quality} (${(px / 1e6).toFixed(2)} MP per frame).`;
}

async function refreshInfo() {
  const u = await db.usage();
  $('#setStatus').textContent =
    `WebGL2: ya · Web Worker XML: ${workerAvailable() ? 'ya' : 'tidak (parsing di thread utama)'} · ` +
    `IndexedDB: ${u.quota ? `${fmtBytes(u.used)} terpakai dari ${fmtBytes(u.quota)}` : 'tersedia'} · ` +
    `perekam: ${pickMime() || 'tidak ada'}`;

  const s = state.scene;
  $('#setPerf').textContent = s
    ? `Preset: ${s.name} · ${s.layers.length} layer · ${fmtTime(s.duration)} · ${s.fps} fps proyek · render ${state.perf.fps} fps / ${state.perf.ms} ms`
    : 'Belum ada preset. Render idle.';
}

/* ------------------------------------------------------------------ audio tab */

export function initAudioTab(audioEngine, getPlayer) {
  const rate = $('#audioRate'), rateVal = $('#rateVal');
  const off = $('#audioOffset'), offVal = $('#offsetVal');

  rate.addEventListener('input', () => {
    const v = parseFloat(rate.value);
    rateVal.textContent = fmtRate(v);
    updateSetting('audioRate', v);
    audioEngine.setRate(v);
  });
  off.addEventListener('input', () => {
    const v = parseInt(off.value, 10);
    offVal.textContent = `${v} ms`;
    updateSetting('audioOffset', v);
  });
  $('#keepPitch').addEventListener('change', (e) => {
    updateSetting('keepPitch', e.target.checked);
    audioEngine.setRate(state.audioRate);
  });
  $('#unmuteVideo').addEventListener('change', (e) => {
    updateSetting('unmuteVideo', e.target.checked);
    getPlayer?.()?.markDirty();
  });
  $('#btnFitRate').addEventListener('click', () => {
    const scene = state.scene;
    if (!scene) { log.warn('tidak ada preset'); return; }
    const r = audioEngine.fitToProject(scene);
    rate.value = String(Math.min(1.5, r));
    rateVal.textContent = fmtRate(r);
    updateSetting('audioRate', r);
    toast.ok('Kecepatan audio disesuaikan ke durasi project.');
  });

  on(EV.SETTINGS, ({ key }) => {
    if (key === 'audioRate' || key === '*') {
      rate.value = String(state.audioRate);
      rateVal.textContent = fmtRate(state.audioRate);
    }
    if (key === 'audioOffset' || key === '*') {
      off.value = String(state.audioOffset);
      offVal.textContent = `${state.audioOffset} ms`;
    }
    if (key === 'keepPitch' || key === '*') $('#keepPitch').checked = state.keepPitch;
    if (key === 'unmuteVideo' || key === '*') $('#unmuteVideo').checked = state.unmuteVideo;
  });
}

const toastInfo = (m) => toast.info?.(m);

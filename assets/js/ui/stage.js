/* ui/stage.js — transport controls, stage sizing, render inspector. */

import { $, el, fmtTime, clamp, icon } from '../core/util.js';
import { on, emit, EV } from '../core/bus.js';
import { state, setTime, updateSetting } from '../core/store.js';
import { getKV, setKV } from '../core/db.js';
import { fxLabel, isKnownFx } from '../gl/effects.js';
import log from '../core/log.js';

let player = null;
let stageMode = 0;   // 0 = portrait card, 1 = fill, 2 = small

const SIZES = [
  () => ({ w: 270, h: 480 }),
  () => ({ w: 200, h: 356 }),
  () => ({ w: 150, h: 267 }),
];

export function initStage({ getPlayer } = {}) {
  player = getPlayer?.();
  const stage = $('#stage');

  /* ---- transport ---- */
  $('#btnPlay').addEventListener('click', () => player?.toggle());
  $('#btnRew').addEventListener('click', () => player?.seek(0));
  $('#seekReset').addEventListener('click', () => player?.seek(0));

  $('#btnLoop').addEventListener('click', (e) => {
    const next = !state.loop;
    updateSetting('loop', next);
    e.currentTarget.classList.toggle('on', next);
    e.currentTarget.setAttribute('aria-pressed', String(next));
  });

  const seek = $('#seek');
  let seeking = false;
  seek.addEventListener('pointerdown', () => { seeking = true; });
  addEventListener('pointerup', () => { seeking = false; });
  seek.addEventListener('input', () => {
    const d = state.scene?.duration || 0;
    if (!d) return;
    player?.seek((parseFloat(seek.value) / 1000) * d);
  });

  on(EV.TIME, (t) => {
    const d = state.scene?.duration || 0;
    if (!seeking) seek.value = d ? Math.round((t / d) * 1000) : 0;
    $('#clock').textContent = `${fmtTime(t)} / ${fmtTime(d)}`;
  });

  on(EV.PLAY, (p) => {
    const btn = $('#btnPlay');
    btn.querySelector('use').setAttribute('href', p ? '#i-pause' : '#i-play');
    $('#playLabel').textContent = p ? 'Jeda' : 'Putar';
    btn.setAttribute('aria-label', p ? 'Jeda pemutaran' : 'Mulai pemutaran');
  });

  /* ---- stage size cycling ---- */
  const applyStage = () => {
    const { w, h } = SIZES[stageMode]();
    stage.style.setProperty('--stage-w', w + 'px');
    stage.style.setProperty('--stage-h', h + 'px');
    setKV('stageMode', stageMode).catch(() => {});
  };
  $('#stageBtnSize').addEventListener('click', () => {
    stageMode = (stageMode + 1) % SIZES.length;
    applyStage();
  });
  getKV('stageMode', 0).then((m) => { stageMode = m | 0; applyStage(); });

  /* ---- inspector ---- */
  $('#inspClose').addEventListener('click', () => {
    updateSetting('debug', false, { persist: false });
    $('#inspector').hidden = true;
  });

  on(EV.SETTINGS, ({ key }) => {
    if (key === 'debug' || key === '*') $('#inspector').hidden = !state.debug;
  });

  // Keep the canvas CSS box square-ish to the scene aspect.
  on(EV.PRESET_LOADED, (scene) => {
    const ar = scene.w / scene.h;
    const base = SIZES[stageMode]();
    stage.style.setProperty('--stage-ar', String(ar));
    stage.style.setProperty('--stage-w', Math.round(base.h * ar) + 'px');
  });

  log.ok('Transport siap.');
}

/* ------------------------------------------------------- per-frame readout */

export function updateInspector(report, cost, fps) {
  if (!state.debug) return;
  const body = $('#inspBody');
  if (!body) return;
  const scene = state.scene;
  if (!scene) { body.textContent = ''; return; }

  const miss = report.missed || [];
  const rows = [
    ['resolusi', `${scene.w}×${scene.h} → ${player?.canvas.width}×${player?.canvas.height}`],
    ['waktu', `${fmtTime(state.time)} / ${fmtTime(scene.duration)}`],
    ['fps', String(Math.round(fps || 0))],
    ['biaya frame', `${(cost || 0).toFixed(1)} ms`],
    ['gambar', String(report.layers || 0)],
    ['draw call', String(player?.comp?.r?.stats?.draws ?? 0)],
    ['kuota (setting)', String(state.quality)],
  ];

  body.textContent = '';
  for (const [k, v] of rows) {
    body.append(el('div', { class: 'insrow' }, [
      el('span', { class: 'k', text: k }),
      el('span', { class: 'v', text: v }),
    ]));
  }

  if (miss.length) {
    body.append(el('div', { class: 'ins-sec' }, [
      el('h4', { text: `Efek belum didukung (${miss.length})` }),
      el('div', { class: 'chips' }, miss.slice(0, 24).map((m) =>
        el('span', { class: 'chip', title: 'tidak dirender' }, [fxLabel(m)]))),
    ]));
  } else {
    body.append(el('div', { class: 'ins-sec' }, [
      el('h4', { text: 'Efek' }),
      el('div', { class: 'chips' }, [
        el('span', { class: 'chip ok', text: 'semua efek di registri' }),
      ]),
    ]));
  }

  if (scene.notes?.length) {
    body.append(el('div', { class: 'ins-sec' }, [
      el('h4', { text: 'Catatan parser' }),
      ...scene.notes.map((n) => el('p', { class: 'ins-note', text: n })),
    ]));
  }
}

/* ------------------------------------------------------------- audio sync UI */

export function updateAudioStatus(audioEngine) {
  const a = $('#audioState'), s = $('#syncState');
  if (a) a.textContent = audioEngine.status();
  if (s) {
    const d = audioEngine.drift();
    s.textContent = 'sinkronisasi: ' + (d < 30 ? 'oke' : `geser ${Math.round(d)} ms`);
    s.className = 'statusbox' + (d < 30 ? '' : ' warn');
  }
}

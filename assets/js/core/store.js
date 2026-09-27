/* core/store.js — single source of truth for app state.

   Deliberately a plain object + explicit mutators rather than a framework:
   the app is small enough that this stays readable, and it keeps the render
   loop's hot path (getTransform) allocation-free.
*/

import { on, emit, EV } from './bus.js';
import { getKV, setKV } from './db.js';
import { sampleTrack } from '../am/parser.js';
import { clamp } from './util.js';

export const state = {
  scene: null,            // parsed model, or null
  raw: null,              // original XML text (for export / save)
  time: 0,                // ms
  playing: false,
  loop: true,
  selLayer: null,         // layer id
  quality: 360,           // preview render height
  fps: 30,
  autoQ: true,
  fxEnabled: true,
  debug: false,
  keepAwake: false,
  photoScale: 1,
  boxScale: 2,            // AM convention: layer box = size * 2
  audioRate: 1,
  audioOffset: 0,
  keepPitch: true,
  unmuteVideo: false,
  gallery: [],            // {id,name,type,size,added}
  recent: [],             // saved presets
  knownFx: 0,
  perf: { fps: 0, ms: 0, dropped: 0 },
};

const scratchLoc = [];
const scratchScale = [];

/**
 * AM transform convention (verified against the reference preset):
 *   - `loc` is a point in scene pixels, relative to the scene centre
 *   - `size` is a HALF-extent style box, so the drawn box is size * boxScale
 *   - `boxScale` defaults to 2 because AM multiplies the layer box by 2
 *   - `scale` then multiplies that box
 *   - `rot` is degrees, clockwise
 */
export function getTransform(layer, tMs, out = {}) {
  const tSec = tMs / 1000;
  const loc = sampleTrack(layer.transform?.loc, tSec, scratchLoc) || [0, 0, 0];
  const sc = sampleTrack(layer.transform?.scale, tSec, scratchScale) || [1, 1];
  const rot = sampleTrack(layer.transform?.rot, tSec) || 0;
  const op = sampleTrack(layer.transform?.opacity, tSec);

  out.x = loc[0] || 0;
  out.y = loc[1] || 0;
  out.z = loc[2] || 0;
  out.sx = (sc[0] ?? 1) * state.photoScale;
  out.sy = (sc[1] ?? sc[0] ?? 1) * state.photoScale;
  out.rot = rot || 0;
  out.opacity = clamp(op == null ? 1 : op, 0, 1);
  out.w = (layer.size?.[0] || 0) * state.boxScale;
  out.h = (layer.size?.[1] || 0) * state.boxScale;
  return out;
}

export const isLayerActive = (layer, tMs) => tMs >= layer.start && tMs < layer.end;

export function setScene(scene, raw) {
  state.scene = scene;
  state.raw = raw ?? null;
  state.time = 0;
  state.selLayer = null;
  emit(EV.PRESET_LOADED, scene);
  emit(EV.TIME, 0);
}

export function clearScene() {
  state.scene = null;
  state.raw = null;
  state.time = 0;
  state.selLayer = null;
  emit(EV.PRESET_CLEARED);
  emit(EV.TIME, 0);
}

export function setTime(ms) {
  const d = state.scene?.duration || 0;
  const t = clamp(ms, 0, d || 0);
  if (t === state.time) return t;
  state.time = t;
  emit(EV.TIME, t);
  return t;
}

export function setPlaying(v) {
  state.playing = !!v;
  emit(EV.PLAY, state.playing);
}

export function selectLayer(id) {
  state.selLayer = id;
  emit(EV.SELECT_LAYER, id);
}

export function setGallery(list) {
  state.gallery = list;
  emit(EV.GALLERY_CHANGED, list);
}

export function setRecent(list) {
  state.recent = list;
  emit('recent:changed', list);
}

/** Settings that persist. */
const PERSIST = [
  'quality', 'fps', 'autoQ', 'fxEnabled', 'debug', 'keepAwake',
  'photoScale', 'boxScale', 'audioRate', 'audioOffset', 'keepPitch', 'unmuteVideo', 'loop',
];

export function updateSetting(key, value, { persist = true } = {}) {
  if (!(key in state)) return;
  state[key] = value;
  if (persist && PERSIST.includes(key)) setKV('settings', settingsSnapshot()).catch(() => {});
  emit(EV.SETTINGS, { key, value });
}

const settingsSnapshot = () => Object.fromEntries(PERSIST.map((k) => [k, state[k]]));

export async function loadSettings() {
  const s = await getKV('settings', null);
  if (s && typeof s === 'object') {
    for (const k of PERSIST) {
      if (k in s && s[k] != null) state[k] = s[k];
    }
  }
  const theme = await getKV('theme', null);
  if (theme) document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  emit(EV.SETTINGS, { key: '*' });
}

/** Auto quality: step preview resolution down when frames are late. */
export const QUALITY_STEPS = [960, 720, 640, 480, 360, 270];

export function considerAutoQuality(frameMs) {
  if (!state.autoQ) return;
  const i = QUALITY_STEPS.indexOf(state.quality);
  if (i < 0) return;
  if (frameMs > 34 && i < QUALITY_STEPS.length - 1) {
    state.quality = QUALITY_STEPS[i + 1];
    emit(EV.SETTINGS, { key: 'quality', value: state.quality, auto: true });
  } else if (frameMs < 15 && i > 2) {
    state.quality = QUALITY_STEPS[i - 1];
    emit(EV.SETTINGS, { key: 'quality', value: state.quality, auto: true });
  }
}

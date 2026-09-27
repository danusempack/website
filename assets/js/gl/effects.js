/* gl/effects.js — local effect registry.

   The reference player executed the JavaScript embedded in the preset to drive
   effects, so any .xml from a stranger could run code inside the page. This
   project never does that. Instead there is a fixed, local table of effect
   ids (AM writes them as `com.alightcreative.effects.<name>`) mapped onto the
   uniform knobs the layer shader exposes.

   Effects that are not in here are NOT silently dropped: the layer is still
   drawn and the inspector labels it "belum didukung", so a partial render is
   always visible as such rather than passed off as complete.

   Property values may be static (`value="1.2"`) or animated (<kf> children);
   `readProp` samples an animated one at the current time.
*/

import { sampleTrack } from '../am/parser.js';

/** Sample an effect property at tMs, falling back to a default. */
export function readProp(props, name, tMs, d = 0) {
  const p = props.get(name);
  if (!p) return d;
  if (p.track?.kind === 'kf') {
    const v = sampleTrack(p.track, tMs / 1000);
    const n = Array.isArray(v) ? num(v[0]) : num(v);
    return Number.isFinite(n) ? n : d;
  }
  const n = num(p.value);
  return Number.isFinite(n) ? n : d;
}

const num = (v) => (Array.isArray(v) ? parseFloat(v[0]) : parseFloat(v));
const flag = (props, name, tMs) => readProp(props, name, tMs, 0) !== 0;

/* AM writes blend modes as ints on the effect's `blend` property. */
const BLEND_BY_INT = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'difference', 'softlight',
];

/**
 * id (short name) -> { label, group, map(p, t) -> uniform overrides }
 * `group` is only used for colouring in the UI.
 */
export const REGISTRY = {
  /* ---- colour / tone ---- */
  exposure: { label: 'Exposure', group: 'tone', map: (p, t) => ({ brightness: readProp(p, 'exposure', t) / 100 }) },
  lift: { label: 'Lift', group: 'tone', map: (p, t) => ({ brightness: readProp(p, 'm1', t) / 400 }) },
  satvib: { label: 'Saturation Vibrance', group: 'tone', map: (p, t) => ({ saturation: 1 + readProp(p, 'vib', t) / 200 }) },
  vignette: { label: 'Vignette', group: 'tone', map: (p, t) => ({ vignette: readProp(p, 'radius', t) / 100 }) },
  sharpen: { label: 'Sharpen', group: 'tone', map: () => ({}) },
  fourcolorgradient: { label: 'Four Colour Gradient', group: 'tone', map: () => ({}) },

  /* ---- blur family ---- */
  dblur: { label: 'Directional Blur', group: 'blur', map: (p, t) => ({ blur: readProp(p, 'size', t) / 120 }) },
  motionblur2: { label: 'Motion Blur II', group: 'blur', map: (p, t) => ({ blur: readProp(p, 'mag', t) / 140 }) },
  motionblur3: { label: 'Motion Blur III', group: 'blur', map: (p, t) => ({ blur: readProp(p, 'mag', t) / 140 }) },
  motionblur4: { label: 'Motion Blur IV', group: 'blur', map: (p, t) => ({ blur: readProp(p, 'mag', t) / 140 }) },
  zoomblur3: { label: 'Zoom Blur III', group: 'blur', map: (p, t) => ({ blur: readProp(p, 'mag', t) / 160 }) },

  /* ---- geometry ---- */
  tile: {
    label: 'Tile', group: 'geom',
    map: (p, t) => ({
      fillMode: 3,
      mirror: flag(p, 'mirror', t) ? 1 : 0,
    }),
  },
  displacemap3: { label: 'Displacement Map III', group: 'geom', map: () => ({}) },
  randomdisplace: { label: 'Random Displace', group: 'geom', map: () => ({}) },
  wavewarp2: { label: 'Wave Warp II', group: 'geom', map: () => ({}) },
  oscillo3: { label: 'Oscillate III', group: 'geom', map: () => ({}) },
  oscillate3: { label: 'Oscillate III', group: 'geom', map: () => ({}) },
  swing: { label: 'Swing', group: 'geom', map: () => ({}) },
  swing2: { label: 'Swing II', group: 'geom', map: () => ({}) },
  blink2: { label: 'Blink II', group: 'geom', map: () => ({}) },
  wipe2: { label: 'Wipe II', group: 'geom', map: () => ({}) },

  /* ---- keys ---- */
  lumakey3: { label: 'Luma Key III', group: 'key', map: () => ({}) },
  colorkey: { label: 'Colour Key', group: 'key', map: () => ({}) },

  /* ---- common short names some exports use ---- */
  blur: { label: 'Blur', group: 'blur', map: (p, t) => ({ blur: readProp(p, 'value', t) / 100 }) },
  gaussianblur: { label: 'Gaussian Blur', group: 'blur', map: (p, t) => ({ blur: readProp(p, 'value', t) / 100 }) },
  contrast: { label: 'Contrast', group: 'tone', map: (p, t) => ({ contrast: 1 + readProp(p, 'value', t) / 100 }) },
  brightness: { label: 'Brightness', group: 'tone', map: (p, t) => ({ brightness: readProp(p, 'value', t) / 100 }) },
  saturation: { label: 'Saturation', group: 'tone', map: (p, t) => ({ saturation: 1 + readProp(p, 'value', t) / 100 }) },
  grain: { label: 'Grain', group: 'texture', map: (p, t) => ({ grain: true, grainAmt: readProp(p, 'value', t) / 1200 }) },
  invert: { label: 'Invert', group: 'tone', map: (p, t) => ({ invert: flag(p, 'invert', t) }) },
};

const EFFECT_PREFIXES = ['com.alightcreative.effects.', 'com.alightcreative.'];

/**
 * REGISTRY is keyed by the short name ("exposure"), but a caller holding a
 * parsed effect naturally reaches for `ef.id`, which is the fully qualified
 * "com.alightcreative.effects.exposure". Looking that up directly yields
 * `undefined` for every effect, so `isKnownFx` would answer "unsupported" for
 * the entire registry and the inspector would show raw ids as labels. Accept
 * either form rather than trusting the caller to remember which is which.
 * AM also omits the `effects.` segment on some ids, so both prefixes go.
 */
const fxKey = (kind) => {
  if (typeof kind !== 'string') return '';
  for (const p of EFFECT_PREFIXES) {
    if (kind.startsWith(p)) return kind.slice(p.length);
  }
  return kind;
};

/* Directional blur appears under both spellings in the wild (a real export
   wrote `dblur`, another wrote `dbur`). Alias instead of duplicating so the
   label and the map can never drift apart. */
REGISTRY.dbur = REGISTRY.dblur;

export const KNOWN_FX = Object.keys(REGISTRY).length;
export const isKnownFx = (kind) => fxKey(kind) in REGISTRY;
export const fxLabel = (kind) => REGISTRY[fxKey(kind)]?.label || kind;
export const fxTint = (kind) => REGISTRY[fxKey(kind)]?.group || 'other';

const GROUP_TINT = {
  tone: '#e0af68', blur: '#7aa2f7', geom: '#bb9af7',
  key: '#f7768e', texture: '#9ece6a', other: '#6b7280',
};
export const fxGroupTint = (kind) => GROUP_TINT[REGISTRY[fxKey(kind)]?.group] || GROUP_TINT.other;

const FILL_MODE = {
  fill: 0, stretch: 0, none: 0, intrinsic: 0, original: 0,
  fit: 1, contain: 1, letterbox: 1,
  crop: 2, center: 2, centerCrop: 2,
  tile: 3, repeat: 3, mirroredRepeat: 3,
};

/**
 * Merge every supported effect on a layer into one set of uniform overrides.
 * Later effects in the stack win, matching AM's bottom-to-top order.
 * @returns {{uniforms:object, hit:number, miss:number, missed:string[]}}
 */
export function resolveEffects(layer, tMs = 0) {
  const uniforms = {};
  const missed = [];
  let hit = 0, miss = 0;

  for (const ef of layer.effects || []) {
    const rec = REGISTRY[ef.kind];
    if (!rec) { miss++; missed.push(ef.kind); continue; }
    hit++;
    try { Object.assign(uniforms, rec.map(ef.props, tMs) || {}); }
    catch { miss++; missed.push(ef.kind); }
  }

  // The layer's own mediaFillMode is the base, effects may override it.
  const base = FILL_MODE[layer.mediaFillMode];
  if (base != null) uniforms.fillMode = base;
  if (uniforms.mirror == null) uniforms.mirror = 0;

  return { uniforms, hit, miss, missed };
}

/** Blend-mode id for a layer / effect, from the AM integer code. */
export function effectBlend(effect) {
  const p = effect?.props?.get('blendMode') || effect?.props?.get('blend');
  if (!p) return null;
  const v = Number.isFinite(num(p.value)) ? num(p.value) : 0;
  return BLEND_BY_INT[v] || 'normal';
}

/** Count distinct effect types used anywhere in the scene. */
export function countSceneFx(layers, acc = new Set()) {
  for (const l of layers) {
    for (const e of l.effects || []) acc.add(e.kind);
    if (l.children?.length) countSceneFx(l.children, acc);
  }
  return acc;
}

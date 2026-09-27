/* core/util.js — small helpers, DOM builder, escaping. No dependencies. */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Create an element. Attributes starting with "on" bind listeners;
 *  `text` sets textContent (never innerHTML), `html` is deliberately absent. */
export function el(tag, attrs = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = String(v);
    else if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, String(v));
  }
  for (const kid of [].concat(kids)) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

/** SVG sprite reference. */
export function icon(id, cls = 'ico') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', cls);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + id);
  svg.append(use);
  return svg;
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp  = (a, b, t) => a + (b - a) * t;
export const round = (v, p = 3) => { const m = 10 ** p; return Math.round(v * m) / m; };

/** "#aarrggbb" | "#rrggbb" | "rgb(...)" -> [r,g,b,a] each 0..1 */
export function parseColor(str, fallback = [0, 0, 0, 1]) {
  if (typeof str !== 'string') return fallback;
  let s = str.trim();
  if (s[0] === '#') {
    s = s.slice(1);
    if (s.length === 3 || s.length === 4) s = [...s].map((c) => c + c).join('');
    if (s.length === 8) s = s.slice(0, 6);           // AM stores AARRGGBB; alpha handled separately
    if (s.length === 6) {
      const n = parseInt(s, 16);
      if (Number.isFinite(n)) {
        return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1];
      }
    }
    return fallback;
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return [p[0] / 255, p[1] / 255, p[2] / 255, p.length > 3 ? p[3] : 1];
  }
  return fallback;
}

export const fmtTime = (ms) => {
  const s = Math.max(0, ms) / 1000;
  return s.toFixed(2) + 's';
};

export const fmtBytes = (n) => {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${round(n / 1024 ** i, i ? 1 : 0)} ${u[i]}`;
};

export const fmtRate = (r) => r.toFixed(3) + 'x';

export function debounce(fn, ms = 120) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function throttleRaf(fn) {
  let queued = false, lastArgs;
  return (...a) => {
    lastArgs = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...lastArgs); });
  };
}

/** Deterministic small PRNG so procedural placeholders look stable. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const hashStr = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** Read a File as text with a hard size ceiling. Throws Error with .code. */
export async function readTextCapped(file, maxBytes) {
  if (file.size > maxBytes) {
    const e = new Error(`File terlalu besar: ${fmtBytes(file.size)} (batas ${fmtBytes(maxBytes)}).`);
    e.code = 'TOO_LARGE';
    throw e;
  }
  return await file.text();
}

export const isVideoFile = (f) => /^video\//.test(f.type) || /\.(mp4|webm|mov|m4v)$/i.test(f.name);
export const isAudioFile = (f) => /^audio\//.test(f.type) || /\.(mp3|m4a|aac|wav|ogg|opus|flac)$/i.test(f.name);
export const isImageFile = (f) => /^image\//.test(f.type);

/** Aspect-correct contain-fit of (sw,sh) into (dw,dh). */
export function fitContain(sw, sh, dw, dh) {
  if (!sw || !sh) return { w: dw, h: dh, s: 1 };
  const s = Math.min(dw / sw, dh / sh);
  return { w: sw * s, h: sh * s, s };
}

/** requestAnimationFrame-driven ticker with dt in ms. */
export function ticker(fn) {
  let raf = 0, prev = 0, live = false;
  const step = (now) => {
    if (!live) return;
    const dt = prev ? now - prev : 16.7;
    prev = now;
    fn(dt, now);
    raf = requestAnimationFrame(step);
  };
  return {
    start() { if (live) return; live = true; prev = 0; raf = requestAnimationFrame(step); },
    stop() { live = false; cancelAnimationFrame(raf); prev = 0; },
    get running() { return live; },
  };
}

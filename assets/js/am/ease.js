/* am/ease.js — Alight Motion keyframe easing.

   In an AM preset the `e` attribute of a <kf> describes the easing of the
   segment that runs FROM that keyframe TO the next one. Forms seen in the
   wild:
     e="cubicBezier 0.42 0.0 0.0 1.0"
     e="linear"
     e="elastic 0.5 1.0 0.0 1.0"
     e="reverse elastic 0.5 1.0 0.0 1.0"
     e="back ..."  e="bounce ..."  e="anticipate ..."  e="overshoot ..."

   Everything is normalised to f(t) with t in 0..1 returning 0..1 (easing
   curves may legitimately overshoot outside that range, which AM does too).
*/

export const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/** CSS-style cubic bezier solved by Newton-Raphson with a bisection fallback. */
export function cubicBezier(x1, y1, x2, y2) {
  if (x1 === y1 && x2 === y2) return (t) => t;              // already linear
  const A = (a, b) => 1 - 3 * b + 3 * a;
  const B = (a, b) => 3 * b - 6 * a;
  const C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);

  return function (x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 6; i++) {                           // Newton-Raphson
      const d = slope(t, x1, x2);
      if (Math.abs(d) < 1e-6) break;
      const e = calc(t, x1, x2) - x;
      if (Math.abs(e) < 1e-7) return calc(t, y1, y2);
      t -= e / d;
    }
    let lo = 0, hi = 1;                                     // bisection fallback
    t = x;
    for (let i = 0; i < 20; i++) {
      const e = calc(t, x1, x2) - x;
      if (Math.abs(e) < 1e-7) break;
      if (e > 0) hi = t; else lo = t;
      t = (lo + hi) / 2;
    }
    return calc(t, y1, y2);
  };
}

const pow2 = (x) => x * x;
const pow3 = (x) => x * x * x;

/**
 * AM "elastic a b c d" — a=amplitude, b=period.
 * Amplitude below 1 has no periodic solution (asin(1/a) is undefined), so
 * those fall back to a decaying sine overshoot, which is what AM shows.
 */
export function elastic(amp = 0.5, period = 1) {
  const a = Math.max(amp, 0);
  const p = Math.max(period, 1e-4);

  if (a >= 1) {
    const s = (p / (2 * Math.PI)) * Math.asin(1 / a);
    return (t) => {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return -(a * Math.pow(2, 10 * (t - 1)) * Math.sin(((t - 1) - s) * (2 * Math.PI) / p));
    };
  }

  const decay = Math.max(0, 1 - a);          // a -> 1 becomes no overshoot
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const damp = Math.exp(-6 * t);
    return 1 + a * damp * Math.sin((t * 2 - 1) * Math.PI * 2) * (1 - damp) * (t < 0.5 ? 1 : decay * 2);
  };
}

export function back(overshoot = 1.70158) {
  return (t) => pow3(t) - (overshoot + 1) * pow2(t) + overshoot * t;
}

export function bounceOut(t) {
  const n = 7.5625, d = 2.75;
  if (t < 1 / d) return n * t * t;
  if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75;
  if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375;
  return n * (t -= 2.625 / d) * t + 0.984375;
}

const linear = (t) => t;
const IN = (f) => (t) => f(1 - t);
const OUT = (f) => (t) => 1 - f(1 - t);
const INOUT = (f) => (t) => (t < 0.5 ? f(2 * t) / 2 : 1 - f(2 - 2 * t) / 2);

/** Named easings, no parameters. */
const NAMED = {
  linear,
  ease: cubicBezier(0.25, 0.1, 0.25, 1),
  'ease-in': cubicBezier(0.42, 0, 1, 1),
  'ease-out': cubicBezier(0, 0, 0.58, 1),
  'ease-in-out': cubicBezier(0.42, 0, 0.58, 1),
  quad: INOUT(pow2),
  cubic: INOUT(pow3),
  quart: INOUT((x) => x ** 4),
  quint: INOUT((x) => x ** 5),
  sine: INOUT((x) => 1 - Math.cos((x * Math.PI) / 2)),
  circ: INOUT((x) => 1 - Math.sqrt(1 - x * x)),
  back: INOUT(back(1.70158)),
  anticipate: (t) => (t < 0.5 ? back(2.2)(t * 2) / 2 : 1 - back(2.2)((1 - t) * 2) / 2),
  overshoot: (t) => (t < 0.5 ? back(1.9)(t * 2) / 2 : 1 - back(1.9)((1 - t) * 2) / 2),
  bounce: bounceOut,
  'bounce-in': IN(bounceOut),
  'bounce-out': OUT(bounceOut),
  'bounce-in-out': INOUT(bounceOut),
  elasticDefault: elastic(0.5, 1),
  hold: () => 0,                                            // step
};

const cache = new Map();

/** Parse an `e="..."` string into f(t). Returns linear() when unparsable. */
export function parseEasing(str) {
  if (!str) return linear;
  const key = str.trim();
  if (cache.has(key)) return cache.get(key);

  const parts = key.split(/\s+/);
  const head = parts[0].toLowerCase();
  const nums = parts.slice(1).map(Number).filter((n) => Number.isFinite(n));

  let fn = null;
  switch (head) {
    case 'cubicbezier':
    case 'cubic':
      fn = nums.length >= 4
        ? cubicBezier(nums[0], nums[1], nums[2], nums[3])
        : cubicBezier(0.42, 0, 0.58, 1);
      break;
    case 'linear':
      fn = linear;
      break;
    case 'elastic':
      fn = elastic(nums[0] ?? 0.5, nums[1] ?? 1);
      break;
    case 'reverse':
    case 'inversesine': {
      const inner = parseEasing(parts.slice(1).join(' ') || 'linear');
      fn = OUT(inner);
      break;
    }
    case 'back':
      fn = back(nums[0] ?? 1.70158);
      break;
    case 'bounce':
      fn = bounceOut;
      break;
    case 'spring':
      fn = elastic(0.6, nums[0] ?? 0.6);
      break;
    default:
      if (NAMED[key] || NAMED[head]) fn = NAMED[key] || NAMED[head];
      else fn = linear;
  }
  cache.set(key, fn);
  return fn;
}

/** Human-readable label for the UI. */
export function easingLabel(str) {
  if (!str) return 'linear';
  return str.trim();
}

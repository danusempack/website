/* core/bus.js — minimal pub/sub. Kept separate from the store so UI modules
   can talk to each other without importing the whole app state. */

const map = new Map();

export function on(evt, fn) {
  let set = map.get(evt);
  if (!set) map.set(evt, (set = new Set()));
  set.add(fn);
  return () => off(evt, fn);
}

export function off(evt, fn) {
  map.get(evt)?.delete(fn);
}

export function once(evt, fn) {
  const un = on(evt, (...a) => { un(); fn(...a); });
  return un;
}

export function emit(evt, payload) {
  const set = map.get(evt);
  if (!set) return;
  // Copy so handlers may unsubscribe during dispatch.
  for (const fn of [...set]) {
    try { fn(payload, evt); }
    catch (err) { console.error('[bus]', evt, err); }
  }
}

export const EV = {
  PRESET_LOADED: 'preset:loaded',
  PRESET_CLEARED: 'preset:cleared',
  MEDIA_CHANGED: 'media:changed',
  GALLERY_CHANGED: 'gallery:changed',
  TIME: 'time',
  PLAY: 'play',
  SELECT_LAYER: 'select:layer',
  SETTINGS: 'settings',
  TOAST: 'toast',
};

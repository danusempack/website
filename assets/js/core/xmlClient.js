/* core/xmlClient.js — talks to the XML worker, with a main-thread fallback
   for environments where module workers are unavailable (some file:// and
   older mobile WebViews). Falls back BEFORE reading, never after a failure,
   so a slow worker is not paid for twice. */

import { parsePresetXML } from '../am/parser.js';

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function ensureWorker() {
  if (worker || workerBroken) return worker;
  try {
    worker = new Worker(new URL('../workers/xmlWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const { id, ok, scene, error, code } = ev.data || {};
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      if (ok) p.resolve(scene);
      else {
        const e = new Error(error);
        e.code = code;
        p.reject(e);
      }
    };
    worker.onerror = () => {
      // Retry the in-flight work on the main thread rather than losing it.
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        try { p.resolve(p.workerJob ? parsePresetXML(p.workerJob.xml, { name: p.workerJob.name }) : null); }
        catch (err) { p.reject(err); }
      }
      pending.clear();
      worker.terminate();
      worker = null;
      workerBroken = true;
    };
  } catch {
    workerBroken = true;
  }
  return worker;
}

/**
 * @param {string} xml  preset text (already size-checked)
 * @param {string} name for display
 * @param {number} timeoutMs  hard cap so a pathological file cannot hang the UI
 */
export function parseInWorker(xml, name, timeoutMs = 15000) {
  const w = ensureWorker();
  if (!w) return Promise.resolve(parsePresetXML(xml, { name }));

  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      try { resolve(parsePresetXML(xml, { name })); }   // main thread took over
      catch (err) { reject(err); }
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, workerJob: { xml, name } });
    w.postMessage({ id, xml, name });
  });
}

export const workerAvailable = () => !!ensureWorker();

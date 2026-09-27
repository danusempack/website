/* core/log.js — ring buffer shown in the Settings dialog. Also mirrors to the
   devtools console. Keeps at most MAX entries so a long session can't grow
   the DOM without bound. */

import { $, el } from './util.js';
import { fmtTime } from './util.js';

const MAX = 200;
const buf = [];
let box = null;
let dirty = false;

const t0 = performance.now();

function render() {
  dirty = false;
  if (!box) return;
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 24;
  box.textContent = '';
  for (const r of buf) {
    box.append(el('div', { class: `logrow lv-${r.lv}` }, [
      el('span', { class: 'logt', text: ((r.t - t0) / 1000).toFixed(2) }),
      el('span', { class: 'logm', text: r.m }),
    ]));
  }
  if (atBottom) box.scrollTop = box.scrollHeight;
}

export function log(m, lv = 'info') {
  const row = { t: performance.now(), m: String(m), lv };
  buf.push(row);
  if (buf.length > MAX) buf.shift();
  if (lv === 'err') console.error('[studio]', m);
  else if (lv === 'warn') console.warn('[studio]', m);
  else console.log('[studio]', m);
  dirty = true;
  if (box) render();
  else if (!render.__q) {
    render.__q = true;
    queueMicrotask(() => { render.__q = false; if (dirty) render(); });
  }
}

log.ok = (m) => log(m, 'ok');
log.warn = (m) => log(m, 'warn');
log.err = (m) => log(m, 'err');

export function mountLog(node) {
  box = node;
  render();
}

export function clearLog() {
  buf.length = 0;
  if (box) box.textContent = '';
}

export const logText = () => buf.map((r) => `${fmtTime(r.t - t0)} ${r.lv} ${r.m}`).join('\n');

export default log;

/* core/toast.js — transient status messages. */

import { $, el } from './util.js';

const ICON = { info: 'i-fit', ok: 'i-fit', warn: 'i-warn', err: 'i-warn' };
let host = null;

const getHost = () => (host ||= $('#toasts'));

export function toast(msg, kind = 'info', ms = 3800) {
  const h = getHost();
  if (!h) return;

  const node = el('div', { class: `toast t-${kind}`, role: kind === 'err' ? 'alert' : 'status' }, [
    el('span', { class: 't-ico', 'aria-hidden': 'true', text: kind === 'ok' ? '✓' : kind === 'err' ? '✕' : kind === 'warn' ? '!' : 'i' }),
    el('span', { class: 't-msg', text: msg }),
    el('button', {
      class: 't-x', type: 'button', 'aria-label': 'Tutup notifikasi',
      onclick: () => remove(),
    }, ['✕']),
  ]);

  h.append(node);
  requestAnimationFrame(() => node.classList.add('in'));

  let timer = setTimeout(remove, ms);
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  node.addEventListener('mouseleave', () => { timer = setTimeout(remove, 1400); });
  node.addEventListener('focusin', () => clearTimeout(timer));

  function remove() {
    clearTimeout(timer);
    node.classList.remove('in');
    node.addEventListener('transitionend', () => node.remove(), { once: true });
    setTimeout(() => node.remove(), 400);
  }
}

toast.ok = (m, ms) => toast(m, 'ok', ms);
toast.warn = (m, ms) => toast(m, 'warn', ms);
toast.err = (m, ms) => toast(m, 'err', ms ?? 7000);

export default toast;

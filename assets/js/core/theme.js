/* core/theme.js — light/dark switch. Persisted; defaults to the OS preference
   and keeps following it while the user has not chosen explicitly. */

import { setKV, getKV } from './db.js';

const KEY = 'theme';
let explicit = false;
let mq = null;

function apply(mode) {
  document.documentElement.dataset.theme = mode;
  const color = mode === 'dark' ? '#101219' : '#5b4bdb';
  // index.html ships two media-scoped theme-color metas. The app theme, not the
  // OS preference, decides which colour applies, so drive them explicitly: keep
  // the first (unscoped), drop the rest, or create one if the page has none.
  // NB: Element.append() returns undefined, so it can never be the fallback
  // value here — the previous `|| document.head.append(...)` left `meta`
  // undefined and threw on every boot.
  const metas = Array.from(document.querySelectorAll('meta[name="theme-color"]'));
  if (metas.length) {
    metas[0].setAttribute('content', color);
    metas[0].removeAttribute('media');
    for (const extra of metas.slice(1)) extra.remove();
  } else {
    const meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    meta.setAttribute('content', color);
    document.head.appendChild(meta);
  }
  const btn = document.getElementById('btnTheme');
  if (btn) {
    const use = btn.querySelector('use');
    if (use) use.setAttribute('href', mode === 'dark' ? '#i-sun' : '#i-moon');
    btn.setAttribute('aria-label', mode === 'dark' ? 'Aktifkan tema terang' : 'Aktifkan tema gelap');
  }
}

export function current() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function toggle() {
  explicit = true;
  const next = current() === 'dark' ? 'light' : 'dark';
  apply(next);
  mq?.removeEventListener('change', follow);
  setKV(KEY, next).catch(() => {});
  return next;
}

function follow(e) {
  if (explicit) return;
  apply(e.matches ? 'dark' : 'light');
}

export async function initTheme() {
  mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', follow);
  const saved = await getKV(KEY, null);
  explicit = !!saved;
  apply(saved || (mq.matches ? 'dark' : 'light'));
}

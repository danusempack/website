/* core/sw.js — offline shell cache.

   Precaches the app itself so a second visit works with no network. User
   files (presets, media) are never touched: they live in IndexedDB, not here.
*/

const CACHE = 'am-preset-studio-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/css/app.css',
  'assets/img/icon.svg',
  'assets/data/demo.json',
  'assets/js/main.js',
  'assets/js/core/util.js',
  'assets/js/core/bus.js',
  'assets/js/core/db.js',
  'assets/js/core/log.js',
  'assets/js/core/toast.js',
  'assets/js/core/store.js',
  'assets/js/core/theme.js',
  'assets/js/core/audio.js',
  'assets/js/core/player.js',
  'assets/js/core/xmlClient.js',
  'assets/js/core/sw.js',
  'assets/js/am/parser.js',
  'assets/js/am/ease.js',
  'assets/js/gl/shaders.js',
  'assets/js/gl/media.js',
  'assets/js/gl/renderer.js',
  'assets/js/gl/effects.js',
  'assets/js/gl/scene.js',
  'assets/js/ui/tabs.js',
  'assets/js/ui/loader.js',
  'assets/js/ui/mediaBus.js',
  'assets/js/ui/media.js',
  'assets/js/ui/stage.js',
  'assets/js/ui/layers.js',
  'assets/js/ui/export.js',
  'assets/js/ui/settings.js',
  'assets/js/ui/keys.js',
  'assets/js/workers/xmlWorker.js',
];

export async function initSW() {
  if (!('serviceWorker' in navigator)) return null;
  // file:// and other opaque origins cannot host a worker.
  if (location.protocol === 'file:') return null;
  const reg = await navigator.serviceWorker.register('sw.js', { scope: './', type: 'module' });
  return reg;
}

// Only meaningful inside the SW scope itself.
if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  self.addEventListener('install', (e) => {
    e.waitUntil(
      caches.open(CACHE)
        .then((c) => c.addAll(SHELL))
        .then(() => self.skipWaiting())
        .catch(() => self.skipWaiting()),
    );
  });
  self.addEventListener('activate', (e) => {
    e.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim()),
    );
  });
  self.addEventListener('fetch', (e) => {
    const req = e.request;
    if (req.method !== 'GET') return;
    const url = new URL(req.url);
    if (url.origin !== location.origin) return;

    e.respondWith(
      caches.match(req).then((hit) => {
        if (hit) {
          // stale-while-revalidate for the shell
          fetch(req).then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone()));
          }).catch(() => {});
          return hit;
        }
        return fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => caches.match('index.html'));
      }),
    );
  });
}

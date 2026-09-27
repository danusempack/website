/* main.js — entry point.

   Boot order matters: settings and theme first (so the first paint is right),
   then GL, then the UI modules, then the render loop.
*/

import { $ } from './core/util.js';
import { on, EV } from './core/bus.js';
import { state, loadSettings } from './core/store.js';
import { initTheme } from './core/theme.js';
import { log } from './core/log.js';
import { Renderer } from './gl/renderer.js';
import { MediaStore } from './gl/media.js';
import { SceneCompositor } from './gl/scene.js';
import { Player } from './core/player.js';
import { AudioEngine } from './core/audio.js';
import { initTabs } from './ui/tabs.js';
import { initLoader, setBusy } from './ui/loader.js';
import { initStage, updateInspector, updateAudioStatus } from './ui/stage.js';
import { initMedia } from './ui/media.js';
import { initLayers } from './ui/layers.js';
import { initSettings, initAudioTab } from './ui/settings.js';
import { initExport, setMediaBlobs } from './ui/export.js';
import { initKeys } from './ui/keys.js';
import { mediaBus } from './ui/mediaBus.js';
import { initSW } from './core/sw.js';
import toast from './core/toast.js';

function fatal(msg, err) {
  log.err(msg + (err ? ' — ' + (err.message || err) : ''));
  const stage = $('#stagebusy');
  if (stage) {
    stage.hidden = false;
    $('#busyTitle').textContent = msg;
    $('#busyNote').textContent = err ? String(err.message || err).slice(0, 300) : '';
    $('#busyClose').hidden = false;
  }
}

async function boot() {
  // Reveal the shell before anything else can fail, so the user always sees UI.
  const app = $('#app');
  app.hidden = false;

  await loadSettings();
  await initTheme();

  $('#subtitle').textContent = 'menyiapkan GPU…';

  let renderer;
  try {
    renderer = new Renderer($('#view'));
  } catch (err) {
    fatal('WebGL2 tidak tersedia', err);
    $('#subtitle').textContent = 'GPU tidak tersedia';
    return;
  }

  const media = new MediaStore(renderer.gl);
  const compositor = new SceneCompositor(renderer, media);
  const audio = new AudioEngine();
  const player = new Player({ canvas: $('#view'), compositor, audio });
  const getPlayer = () => player;

  $('#subtitle').textContent = 'siap';

  /* ---- UI ---- */
  initTabs();
  initStage({ getPlayer });
  initMedia({ getPlayer });
  initLayers({ getPlayer });
  initSettings();
  initAudioTab(audio, getPlayer);
  initExport();
  initKeys({ getPlayer });

  initLoader({
    getPlayer,
    onPresets: async (scene, blobs) => {
      setMediaBlobs(mediaBus.allBlobs());
      await compositor.bindMedia(scene, blobs);
      audio.load(scene, mediaBusByUri());
      player.markDirty();
      refreshTrackList();
    },
  });

  await mediaBus.refresh();
  setMediaBlobs(mediaBus.allBlobs());

  /* ---- loop ---- */
  let acc = 0;
  player.onFrame = ({ report, cost, fps }) => {
    updateInspector(report, cost, fps);
    acc++;
    if (acc % 30 === 0) updateAudioStatus(audio);
  };
  player.start();

  /* ---- gallery reacts to new imports ---- */
  on(EV.GALLERY_CHANGED, () => {
    setMediaBlobs(mediaBus.allBlobs());
    refreshTrackList();
    if (state.scene) {
      compositor.bindMedia(state.scene, mediaBus.allBlobs()).then(() => player.markDirty());
    }
  });

  on(EV.MEDIA_CHANGED, () => player.markDirty());
  addEventListener('studio:dirty', () => player.markDirty());

  /* ---- service worker (offline shell) ---- */
  initSW().catch((err) => log.warn('service worker gagal: ' + err.message));

  log.ok('Aplikasi siap.');

  // Expose a tiny debug surface; no secrets, no user data.
  window.studio = { state, player, renderer, compositor, audio, mediaBus };
}

/** uri -> object URL map for the audio engine. */
function mediaBusByUri() {
  const map = new Map();
  for (const g of state.gallery) {
    const u = mediaBus.url(g.name);
    if (u) map.set(g.name, u);
  }
  return map;
}

function refreshTrackList() {
  const host = $('#trackList');
  if (!host) return;
  host.textContent = '';
  const scene = state.scene;
  if (!scene?.audio?.length) {
    host.append(Object.assign(document.createElement('div'), {
      className: 'empty',
      textContent: 'Preset ini tidak punya track audio.',
    }));
    return;
  }
  for (const t of scene.audio) {
    const row = document.createElement('div');
    row.className = 'slotrow';
    const filled = !!mediaBus.blob(t.src);
    row.innerHTML = '';
    row.append(
      Object.assign(document.createElement('div'), { className: 'slotinfo' }, [
        Object.assign(document.createElement('div'), { className: 'slot-name', text: t.src || '(tanpa sumber)' }),
        Object.assign(document.createElement('div'), {
          className: 'slot-sub',
          text: filled
            ? `terisi · ${(t.start / 1000).toFixed(2)}s → ${(t.end / 1000).toFixed(2)}s`
            : 'kosong — pilih berkas audio di tab Media',
        }),
      ]),
    );
    host.append(row);
  }
}

boot().catch((err) => fatal('Gagal menjalankan aplikasi', err));

/* ui/export.js — video export.

   The only path implemented today is the built-in MediaRecorder one below:
   frames are rendered deterministically and emitted via `captureStream(0)` +
   `requestFrame()`, paced against a wall clock so the recorded A/V timeline
   lines up with the project. It needs no libraries, but it is slower than
   real-time on a heavy preset because it encodes as it plays.

   True frame-exact offline encoding would go through WebCodecs (e.g. a local
   mediabunny drop-in, imported dynamically). That is NOT implemented. The
   CSP leaves room for it — `script-src 'self'` still permits a same-origin
   module — but do not describe it as working until it exists.

   Nothing on this path touches the network.
*/

import { $, el, fmtTime } from '../core/util.js';
import { state, setTime } from '../core/store.js';
import { outputSize } from '../gl/scene.js';
import toast from '../core/toast.js';
import log from '../core/log.js';

const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  for (const m of MIME_CANDIDATES) {
    if (MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return null;
}

let cancelled = false;
let running = false;

function setStatus(text, kind = '') {
  const box = $('#expState');
  if (!box) return;
  box.textContent = text;
  box.className = 'statusbox' + (kind ? ' ' + kind : '');
}

/**
 * Render the project into an offscreen canvas-driven stream.
 * @returns {Promise<{blob:Blob, ext:string, mime:string}>}
 */
async function exportWithMediaRecorder(scene, { height, fps, bitrate, audioCtx, audioDest }) {
  const mime = pickMime();
  if (!mime) throw new Error('Browser ini tidak mendukung perekaman video (MediaRecorder).');

  const { w, h } = outputSize(scene, height);

  // Dedicated canvas so we never disturb the preview surface.
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const { Renderer } = await import('../gl/renderer.js');
  const { MediaStore } = await import('../gl/media.js');
  const { SceneCompositor } = await import('../gl/scene.js');

  const renderer = new Renderer(cv);
  const media = new MediaStore(renderer.gl);
  const comp = new SceneCompositor(renderer, media);
  await comp.bindMedia(scene, mediaBlobs);

  const stream = cv.captureStream(0);
  const videoTrack = stream.getVideoTracks()[0];

  if (audioDest) {
    const at = audioDest.stream.getAudioTracks()[0];
    if (at) stream.addTrack(at);
  }

  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };

  const done = new Promise((res) => { rec.onstop = res; });
  rec.start();

  const total = scene.duration || 0;
  const frames = Math.max(1, Math.round((total / 1000) * fps));
  const bar = $('#expBar');
  const t0 = performance.now();
  const frameMs = 1000 / fps;

  for (let i = 0; i < frames; i++) {
    if (cancelled) break;
    const t = (i / fps) * 1000;
    setTime(Math.min(t, total));
    comp.render(scene, t, w, h);
    renderer.present({ w: scene.w, h: scene.h, outW: w, outH: h, letter: true });
    videoTrack.requestFrame?.();

    // Pace to the wall clock so MediaRecorder timestamps match the project.
    const due = t0 + (i + 1) * frameMs;
    const wait = due - performance.now();
    if (wait > 1) await new Promise((r) => setTimeout(r, wait));

    if (i % 5 === 0 || i === frames - 1) {
      const p = (i + 1) / frames;
      if (bar) bar.value = p;
      const left = Math.max(0, (due + frameMs * 5 - performance.now()) / 1000);
      setStatus(`Merekam frame ${i + 1} / ${frames} — sisa ~${left.toFixed(0)} dtk`);
    }
  }

  // Let the muxer flush.
  await new Promise((r) => setTimeout(r, 260));
  rec.stop();
  await done;
  videoTrack.stop();
  if (audioDest) audioDest.stream.getTracks().forEach((t) => t.stop());
  comp.stopVideos();
  renderer.dispose();
  media.clear();

  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
  return { blob, ext, mime };
}

/** Render the audio tracks to an OfflineAudioContext, if there is any audio. */
async function renderAudioOffline(scene, { sampleRate = 48000, rate = 1, keepPitch = true } = {}) {
  if (!scene.audio?.length) return null;
  const dur = (scene.duration || 0) / 1000;
  if (!(dur > 0)) return null;
  try {
    const ctx = new OfflineAudioContext(2, Math.ceil(dur * sampleRate), sampleRate);
    const dest = ctx.createGain();
    dest.gain.value = 1;
    dest.connect(ctx.destination);

    let any = false;
    for (const t of scene.audio) {
      const blob = mediaBlobs.get(t.src);
      if (!blob) continue;
      try {
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        const src = ctx.createBufferSource();
        src.buffer = buf;
        if (ctx.createStereoPanner) {
          const pan = ctx.createStereoPanner();
          pan.pan.value = 0;
          src.connect(pan).connect(dest);
        } else {
          src.connect(dest);
        }
        src.playbackRate.value = rate;
        const start = Math.max(0, t.start / 1000);
        const end = t.end ? (t.end - t.start) / 1000 : buf.duration / rate;
        src.start(start, 0, Math.min(end, buf.duration / rate));
        any = true;
      } catch (err) {
        log.warn('Audio track gagal di-decode: ' + (blob.name || t.src));
      }
    }
    if (!any) return null;
    const rendered = await ctx.startRendering();
    return rendered;
  } catch (err) {
    log.warn('Offline audio gagal: ' + err.message);
    return null;
  }
}

/** Shared blob source, set by initExport so the module stays importable. */
let mediaBlobs = new Map();
export function setMediaBlobs(map) { mediaBlobs = map || new Map(); }

export async function runExport() {
  const scene = state.scene;
  if (!scene) { setStatus('belum ada preset', 'bad'); toast.warn('Muat preset dulu.'); return; }
  if (running) return;
  if (typeof MediaRecorder === 'undefined') {
    setStatus('browser tidak mendukung ekspor video', 'bad');
    toast.err('Browser ini tidak mendukung perekaman video.');
    return;
  }

  running = true;
  cancelled = false;
  const btn = $('#btnExport'), stop = $('#btnExportStop'), bar = $('#expBar');
  btn.disabled = true; stop.disabled = false;
  if (bar) bar.value = 0;

  const resSel = $('#expRes').value;
  const height = resSel === 'same' ? state.quality : parseInt(resSel, 10);
  const fpsSel = $('#expFps').value;
  const fps = fpsSel === 'custom'
    ? clampInt(parseInt($('#expFpsNum').value, 10) || 30, 1, 120)
    : parseInt(fpsSel, 10);
  const brate = parseFloat($('#expBrate').value) * 1_000_000;

  const est = (scene.duration / 1000) / Math.max(1, fps) * fps / Math.max(1, fps);
  void est;

  setStatus('menyiapkan…');
  log(`ekspor: ${height}p, ${fps} fps, ${(brate / 1e6).toFixed(2)} Mbps`);

  try {
    const srSel = $('#expSr').value;
    const sampleRate = srSel === 'auto' ? 48000 : parseInt(srSel, 10);

    // Audio goes through a real-time graph so MediaRecorder can mux it.
    let audioCtx = null, audioDest = null;
    if (scene.audio?.length && mediaBlobs.size) {
      try {
        audioCtx = new AudioContext({ sampleRate });
        audioDest = audioCtx.createMediaStreamDestination();
        for (const t of scene.audio) {
          const blob = mediaBlobs.get(t.src);
          if (!blob) continue;
          const buf = await blob.arrayBuffer();
          const decoded = await audioCtx.decodeAudioData(buf);
          const src = audioCtx.createBufferSource();
          src.buffer = decoded;
          src.playbackRate.value = state.audioRate;
          const gain = audioCtx.createGain();
          gain.gain.value = 1;
          src.connect(gain).connect(audioDest);
          const start = Math.max(0, t.start / 1000);
          src.start(audioCtx.currentTime + start);
        }
        if (audioCtx.state === 'suspended') await audioCtx.resume();
      } catch (err) {
        log.warn('Audio tidak bisa disiapkan: ' + err.message);
        audioCtx?.close?.();
        audioCtx = null; audioDest = null;
      }
    }

    const { blob, ext, mime } = await exportWithMediaRecorder(scene, {
      height, fps, bitrate: brate, audioCtx, audioDest,
    });
    audioCtx?.close?.().catch(() => {});

    if (cancelled || !blob.size) {
      setStatus('dibatalkan', 'warn');
      return;
    }

    const url = URL.createObjectURL(blob);
    const name = (scene.name || 'preset').replace(/\.xml$/i, '') + '.' + ext;
    const out = $('#expOut');
    out.textContent = '';
    out.append(el('a', { class: 'btn primary block', href: url, download: name }, [
      'Unduh ' + name + ` (${(blob.size / 1048576).toFixed(1)} MB)`,
    ]));
    out.append(el('p', {
      class: 'hint',
      text: `Format ${mime.split(';')[0]}, ${fmtTime(scene.duration)}. Rekam ini berjalan mengikuti waktu nyata — beri tahu saya kalau hasil audionya bergeser.`,
    }));

    setStatus(`selesai — ${(blob.size / 1048576).toFixed(1)} MB`, 'ok');
    log.ok('ekspor selesai: ' + name);
    toast.ok('Video siap diunduh.');
  } catch (err) {
    setStatus('gagal: ' + err.message, 'bad');
    log.err('ekspor gagal: ' + err.message);
    toast.err('Ekspor gagal: ' + err.message);
  } finally {
    running = false;
    btn.disabled = false; stop.disabled = true;
    if (bar) bar.value = 0;
  }
}

const clampInt = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function initExport() {
  $('#btnExport').addEventListener('click', runExport);
  $('#btnExportStop').addEventListener('click', () => {
    cancelled = true;
    setStatus('membatalkan…', 'warn');
  });

  const fpsSel = $('#expFps');
  const fpsRow = $('#expFpsRow');
  fpsSel.addEventListener('change', () => {
    fpsRow.hidden = fpsSel.value !== 'custom';
  });

  const brate = $('#expBrate'), bl = $('#brateVal');
  const label = (mbps) => (mbps < 0.06 ? 'Rendah' : mbps < 0.12 ? 'Sedang' : mbps < 0.3 ? 'Tinggi' : 'Sangat tinggi');
  brate.addEventListener('input', () => { bl.textContent = label(parseFloat(brate.value)); });
  bl.textContent = label(parseFloat(brate.value));

  // generic range-reset buttons
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.range-reset[data-reset]');
    if (!b) return;
    const input = document.getElementById(b.dataset.reset);
    if (!input) return;
    input.value = b.dataset.default;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  setStatus('siap');
  const m = pickMime();
  if (!m) setStatus('browser tidak mendukung perekaman video', 'bad');
  else setStatus(`siap — akan merekam ${m.split(';')[0]}`);
}

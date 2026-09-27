/* core/audio.js — scene audio tracks.

   Design: one <audio> element per track, kept in sync with the timeline.
   Playback rate is user-adjustable; the optional "fit to project" action
   retimes a track so it ends exactly on the project duration.

   Everything is file-based and local. Nothing is uploaded.
*/

import { state } from './store.js';
import { clamp } from './util.js';

export class AudioEngine {
  constructor() {
    this.tracks = [];        // { id, el, track, url }
    this.master = null;
  }

  /** Build players for a scene's audio tracks. `sources` maps uri -> URL. */
  load(scene, sources = new Map()) {
    this.unload();
    for (const t of scene.audio || []) {
      if (!t.src) continue;
      const url = sources.get(t.src);
      if (!url) continue;
      const el = new Audio();
      el.src = url;
      el.preload = 'auto';
      el.loop = true;
      el.playsInline = true;
      this.tracks.push({ id: t.id, el, track: t, url });
    }
    return this.tracks.length;
  }

  unload() {
    for (const t of this.tracks) {
      try { t.el.pause(); t.el.removeAttribute('src'); t.el.load(); } catch { /* ignore */ }
    }
    this.tracks.length = 0;
  }

  get count() { return this.tracks.length; }

  setRate(rate) {
    const r = clamp(rate, 0.0625, 16);
    for (const t of this.tracks) {
      t.el.playbackRate = r;
      t.el.preservesPitch = !!state.keepPitch;
      t.el.mozPreservesPitch = !!state.keepPitch;
    }
    return r;
  }

  /** Retime every track so the longest one spans the project duration. */
  fitToProject(scene) {
    let out = 1;
    for (const t of this.tracks) {
      const d = Number.isFinite(t.el.duration) ? t.el.duration : t.track.outTime / 1000;
      if (d > 0) out = Math.max(out, scene.duration / 1000 / d);
    }
    this.setRate(out);
    return out;
  }

  play(tMs) {
    for (const t of this.tracks) {
      const el = t.el;
      el.playbackRate = state.audioRate;
      if (Number.isFinite(el.duration) && el.duration > 0) {
        const start = (t.start + state.audioOffset) / 1000;
        const end = t.end ? t.end / 1000 : Infinity;
        const rel = (tMs / 1000) - start;
        let want = ((rel % el.duration) + el.duration) % el.duration;
        if (t.end && (tMs < t.start || tMs >= t.end)) { el.pause(); continue; }
        if (Math.abs(el.currentTime - want) > 0.2) el.currentTime = want;
      }
      el.play().catch(() => {});
    }
  }

  pause() {
    for (const t of this.tracks) if (!t.el.paused) t.el.pause();
  }

  /** Set the gain envelope for a track at the current time. */
  applyGain(tMs) {
    for (const t of this.tracks) {
      const g = t.track.gain;
      if (!g) { t.el.volume = 1; continue; }
      const v = typeof g === 'number' ? g : (g.v ?? 1);
      t.el.volume = clamp(Array.isArray(v) ? v[0] : v, 0, 1);
    }
  }

  /** Overall drift between audio and video, in ms. */
  drift() {
    let worst = 0;
    for (const t of this.tracks) {
      if (t.el.paused) continue;
      const d = Math.abs(t.el.currentTime * 1000 - (state.time - t.track.start));
      if (d > worst) worst = d;
    }
    return worst;
  }

  status() {
    if (!this.tracks.length) return 'audio: tidak ada track';
    const d = this.drift();
    return `audio: ${this.tracks.length} track${this.tracks.length > 1 ? '' : ''} aktif` +
      (d > 60 ? ` — geser ${Math.round(d)} ms` : ' — sinkron');
  }
}

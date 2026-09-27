/* core/player.js — the render/playback loop.

   One rAF loop drives everything. When paused and nothing is dirty we skip
   rendering entirely so an idle tab costs ~0% CPU; `markDirty` is how the UI
   asks for a single extra frame after a settings change or a scrub.
*/

import { state, setTime, setPlaying, considerAutoQuality } from './store.js';
import { EV } from './bus.js';
import { outputSize } from '../gl/scene.js';

export class Player {
  constructor({ canvas, compositor, audio }) {
    this.canvas = canvas;
    this.comp = compositor;
    this.audio = audio;
    this.dirty = true;
    this.last = 0;
    this.acc = 0;
    this.frames = 0;
    this.fpsAt = 0;
    this.fps = 0;
    this.loopFn = this.loop.bind(this);
    this.running = false;
    this.onFrame = null;
    this.wakeLock = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.fpsAt = this.last;
    requestAnimationFrame(this.loopFn);
  }

  stop() {
    this.running = false;
    if (this.wakeLock) { this.wakeLock.release?.().catch(() => {}); this.wakeLock = null; }
  }

  markDirty() { this.dirty = true; }

  /** Resize the drawing buffer to the current quality setting. */
  syncResolution() {
    const scene = state.scene;
    const targetH = state.quality;
    if (!scene) {
      const w = Math.round(targetH * 9 / 16);
      if (this.canvas.width !== w || this.canvas.height !== targetH) {
        this.canvas.width = w;
        this.canvas.height = targetH;
        this.dirty = true;
      }
      return { w, h: targetH };
    }
    const { w, h } = outputSize(scene, targetH);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty = true;
    }
    return { w, h };
  }

  async play() {
    if (!state.scene) return;
    setPlaying(true);
    this.comp.syncVideos(true, state.time);
    this.audio.play(state.time);
    this.requestWake();
    this.last = performance.now();
    this.markDirty();
  }

  pause() {
    setPlaying(false);
    this.comp.syncVideos(false, state.time);
    this.comp.stopVideos();
    this.audio.pause();
    this.releaseWake();
    this.markDirty();
  }

  toggle() { state.playing ? this.pause() : this.play(); }

  seek(ms) {
    const t = setTime(ms);
    this.comp.syncVideos(state.playing, t);
    if (state.playing) this.audio.play(t);
    this.markDirty();
    return t;
  }

  async requestWake() {
    if (!state.keepAwake || this.wakeLock) return;
    try {
      this.wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* denied or unsupported */ }
  }

  releaseWake() {
    if (this.wakeLock) { this.wakeLock.release?.().catch(() => {}); this.wakeLock = null; }
  }

  loop(now) {
    if (!this.running) return;
    requestAnimationFrame(this.loopFn);

    const dt = now - this.last;
    this.last = now;

    // fps meter
    this.frames++;
    if (now - this.fpsAt >= 500) {
      this.fps = (this.frames * 1000) / (now - this.fpsAt);
      this.frames = 0;
      this.fpsAt = now;
      state.perf.fps = Math.round(this.fps);
    }

    if (state.playing && state.scene) {
      const dur = state.scene.duration || 0;
      let t = state.time + dt;
      if (t >= dur) {
        if (state.loop) t = dur > 0 ? t % dur : 0;
        else { t = dur; this.pause(); }
      }
      setTime(t);
      this.comp.syncVideos(true, t);
      this.dirty = true;
    }

    if (!this.dirty || !state.scene) return;
    this.dirty = false;

    const { w, h } = this.syncResolution();
    const t0 = performance.now();
    const report = this.comp.render(state.scene, state.time, w, h);
    const cost = performance.now() - t0;

    state.perf.ms = Math.round(cost * 10) / 10;
    if (state.autoQ) considerAutoQuality(cost);
    this.audio.applyGain(state.time);
    this.onFrame?.({ report, cost, dt, fps: this.fps });
  }
}

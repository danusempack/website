/* gl/scene.js — turns a parsed scene into draw calls.

   Draw order note: in an AM preset the FIRST element inside <scene> is the
   TOP-most layer (the file is written bottom-up), so this walks the layer
   array in reverse.
*/

import { parseColor, clamp } from '../core/util.js';
import { getTransform, isLayerActive, state } from '../core/store.js';
import { resolveEffects, effectBlend } from './effects.js';
import { blendModeId } from './renderer.js';
import { loadVideoBlob, loadImageBlob, guessKind } from './media.js';

const scratchTx = {};

/** Output size for a given target height, preserving the scene aspect. */
export function outputSize(scene, targetH) {
  const ar = scene.w / scene.h;
  const h = targetH;
  return { w: Math.round(h * ar), h };
}

export class SceneCompositor {
  constructor(renderer, media) {
    this.r = renderer;
    this.media = media;
    this.videos = new Map();     // uri -> HTMLVideoElement (playback controls)
    this.missing = new Set();
    this.report = { layers: 0, fxHit: 0, fxMiss: 0, missed: [] };
  }

  /** Attach user-supplied media blobs to the slots the preset references. */
  async bindMedia(scene, blobs) {
    if (!blobs?.size) return;
    for (const [uri, blob] of blobs) {
      if (!blob) continue;
      const it = this.media.ensure(uri);
      const kind = guessKind(blob.name || '', blob.type);
      if (kind === 'video') {
        const rec = loadVideoBlob(this.media, uri, blob, { muted: !state.unmuteVideo, loop: true });
        it.meta = { name: blob.name, type: blob.type, size: blob.size };
        this.videos.set(uri, rec.video);
      } else if (kind === 'image') {
        await loadImageBlob(this.media, uri, blob);
        it.meta = { name: blob.name, type: blob.type, size: blob.size };
      }
    }
  }

  /** Play/pause every attached <video> so they follow the timeline. */
  syncVideos(playing, tMs) {
    for (const [uri, v] of this.videos) {
      if (!v) continue;
      v.muted = !state.unmuteVideo;
      if (playing) {
        if (v.paused) v.play().catch(() => {});
        if (Number.isFinite(v.duration) && v.duration > 0) {
          const want = (tMs / 1000) % v.duration;
          if (Math.abs(v.currentTime - want) > 0.25) v.currentTime = want;
        }
      } else if (!v.paused) {
        v.pause();
      }
    }
  }

  stopVideos() {
    for (const v of this.videos.values()) { if (v && !v.paused) v.pause(); }
  }

  /** Sample a media slot; keeps video textures in sync. */
  texFor(uri) {
    if (!uri) return null;
    // ensure() fabricates a checkerboard placeholder for a slot the user never
    // filled, so kind is the only reliable "is this filled?" signal — the item
    // exists in the map from the first frame either way. Checking mere presence
    // made the missing-media report clear itself after one frame.
    const it = this.media.get(uri) || this.media.ensure(uri);
    if (it.kind === 'placeholder' || it.kind === 'empty') this.missing.add(uri);
    if (it.kind === 'video' && it.video) this.media.syncVideo(it, state.time);
    return it;
  }

  render(scene, tMs, outW, outH) {
    const r = this.r;
    const bg = parseColor(scene.bgcolor, [0, 0, 0, 1]);
    this.report = { layers: 0, fxHit: 0, fxMiss: 0, missed: [] };

    r.resize(outW, outH);
    r.clearTo(bg);
    r.stats.layers = 0; r.stats.draws = 0; r.stats.missing = 0;
    this.missing.clear();

    const ctxScene = {
      w: scene.w, h: scene.h, tSec: tMs / 1000,
      outW, outH, letter: true,
    };
    const bgTex = r.targets[r.cur].tex;

    const walk = (layers, parentOpacity, parentBlend) => {
      for (let i = layers.length - 1; i >= 0; i--) {
        const layer = layers[i];
        if (!isLayerActive(layer, tMs)) continue;
        if (layer.kind === 'audio') continue;         // audio is not visual
        if (this.report.layers++ > 2000) return;

        const tx = getTransform(layer, tMs, scratchTx);
        const op = clamp(parentOpacity * tx.opacity, 0, 1);
        if (op <= 0.002) continue;

        if (layer.kind === 'group') {
          walk(layer.children, op, layer.mediaFillMode);
          continue;
        }

        const { uniforms, hit, miss, missed } = state.fxEnabled
          ? resolveEffects(layer, tMs)
          : { uniforms: {}, hit: 0, miss: 0, missed: [] };
        this.report.fxHit += hit;
        this.report.fxMiss += miss;
        if (missed.length) {
          for (const m of missed) if (!this.report.missed.includes(m)) this.report.missed.push(m);
        }

        // Blend mode is NOT mediaFillMode — in AM it is an effect property.
        let blendName = null;
        for (const ef of layer.effects || []) {
          const b = effectBlend(ef);
          if (b) blendName = b;
        }

        const it = this.texFor(layer.uri);
        const isSolid = !layer.uri || layer.kind === 'shape';
        const tex = isSolid ? null : it?.tex;
        const texAR = !isSolid && it?.w && it?.h ? it.w / it.h : (tx.w / (tx.h || 1)) || 1;

        const col = layer.color || (layer.fillColor ? parseColor(layer.fillColor) : [1, 1, 1, 1]);

        r.drawLayer({
          tex: tex || bgTex,
          hasTex: !!tex && !isSolid,
          box: [tx.w || scene.w, tx.h || scene.h],
          center: [tx.x, tx.y],
          rot: tx.rot,
          opacity: op,
          color: col,
          blend: blendModeId(blendName || 'normal'),
          fillMode: 0,
          mirror: 0,
          texAR,
          scene: ctxScene,
          ...uniforms,
        });
      }
    };

    walk(scene.layers, 1, null);

    // present with letterbox
    r.present({ w: scene.w, h: scene.h, outW: r.canvas.width, outH: r.canvas.height, letter: true });
    r.stats.layers = this.report.layers;
    r.stats.effectHits = this.report.fxHit;
    r.stats.effectMiss = this.report.fxMiss;
    r.stats.missing = this.missing.size;
    this.report.missing = [...this.missing];
    return this.report;
  }
}

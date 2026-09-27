/* gl/media.js — texture store.

   Three sources of pixels:
     - ImageBitmap  (decoded from an image Blob, or a poster frame of a video)
     - HTMLVideoElement (a live <video> the compositor samples per frame)
     - generated    (solid colour / checkerboard placeholder, no upload needed)

   Textures are keyed by media uri so a preset re-open reuses them, and every
   GL object created here is tracked for disposal.
*/

import { mulberry32, hashStr, isImageFile, isVideoFile } from '../core/util.js';

export class MediaStore {
  constructor(gl) {
    this.gl = gl;
    this.items = new Map();     // uri -> item
  }

  get(uri) { return this.items.get(uri) || null; }

  /** Create (or return) a texture. `source` may be null -> placeholder. */
  ensure(uri, { w = 0, h = 0 } = {}) {
    let it = this.items.get(uri);
    if (it) return it;
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const ph = placeholderDataURL(w || 720, h || 1280, hashStr(uri));
    it = { uri, tex, kind: 'empty', w: 0, h: 0, ready: false, source: null, poster: null, ph };
    this.items.set(uri, it);
    this.uploadPlaceholder(it);
    return it;
  }

  uploadPlaceholder(it) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, it.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
      new Uint8Array([90, 92, 110, 255]));
    it.w = 1; it.h = 1; it.ready = true; it.kind = 'placeholder';
  }

  /** Upload an ImageBitmap / HTMLImageElement. Returns true on success. */
  upload(it, source) {
    const gl = this.gl;
    try {
      gl.bindTexture(gl.TEXTURE_2D, it.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      it.w = source.width || source.videoWidth || 1;
      it.h = source.height || source.videoHeight || 1;
      it.ready = true;
      it.kind = 'bitmap';
      return true;
    } catch {
      return false;
    }
  }

  attachVideo(it, video) {
    it.source = video;
    it.kind = 'video';
    it.video = video;
  }

  /** Pull the current video frame into the texture. */
  syncVideo(it, tMs) {
    const v = it.video;
    if (!v || v.readyState < 2) return false;
    const gl = this.gl;
    try {
      gl.bindTexture(gl.TEXTURE_2D, it.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v);
      it.w = v.videoWidth || 1;
      it.h = v.videoHeight || 1;
      it.ready = true;
      return true;
    } catch {
      return false;
    }
  }

  dispose(it) {
    if (!it) return;
    this.gl.deleteTexture(it.tex);
    if (it.source && it.source.close) { try { it.source.close(); } catch { /* ignore */ } }
    if (it.video) { try { it.video.removeAttribute('src'); it.video.load(); } catch { /* ignore */ } }
    this.items.delete(it.uri);
  }

  clear() {
    for (const it of [...this.items.values()]) this.dispose(it);
  }
}

/**
 * Decode a File/Blob into an ImageBitmap and store it.
 * SVG/AVIF support varies; failures fall back to the placeholder.
 */
export async function loadImageBlob(store, uri, blob) {
  const it = store.ensure(uri);
  try {
    const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    if (store.upload(it, bmp)) {
      it.source = bmp;
      return it;
    }
  } catch { /* fall through */ }
  try {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.decoding = 'async';
    await new Promise((res, rej) => {
      img.onload = res; img.onerror = () => rej(new Error('decode gagal'));
      img.src = url;
    });
    if (store.upload(it, img)) { it.source = img; it.url = url; return it; }
  } catch { /* fall through */ }
  return it;
}

/** Create an off-DOM <video> for a media uri and wire it into the store. */
export function loadVideoBlob(store, uri, blob, { muted = true, loop = true } = {}) {
  const it = store.ensure(uri);
  const v = document.createElement('video');
  v.src = URL.createObjectURL(blob);
  v.muted = muted;
  v.loop = loop;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  store.attachVideo(it, v);
  it.url = v.src;
  v.load();
  return it;
}

export const guessKind = (name, type) => {
  if (isVideoFile({ name, type })) return 'video';
  if (isImageFile({ name, type })) return 'image';
  if (/^audio\//.test(type)) return 'audio';
  return 'unknown';
};

/**
 * Deterministic checkerboard data URL, used as the poster for empty media
 * slots so the user can see WHICH slot is missing instead of a black frame.
 */
export function placeholderDataURL(w, h, seed = 1) {
  const c = document.createElement('canvas');
  const S = 64;
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(seed);
  const hue = Math.floor(rnd() * 360);
  g.fillStyle = `hsl(${hue} 22% 26%)`;
  g.fillRect(0, 0, S, S);
  g.fillStyle = `hsl(${hue} 26% 34%)`;
  for (let y = 0; y < S; y += 16) {
    for (let x = 0; x < S; x += 16) {
      if (((x / 16) + (y / 16)) % 2) g.fillRect(x, y, 16, 16);
    }
  }
  g.strokeStyle = 'rgba(255,255,255,.30)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, S - 2, S - 2);
  g.fillStyle = 'rgba(255,255,255,.55)';
  g.font = 'bold 22px system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('?', S / 2, S / 2 + 1);
  return c.toDataURL('image/png');
}

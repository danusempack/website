/* gl/renderer.js — WebGL2 scene compositor.

   Pipeline per frame:
     1. clear the back FBO to the scene background colour
     2. walk layers bottom-to-top; each layer is one textured quad
          - NORMAL uses hardware premultiplied blending
          - other blend modes read the backdrop texture (ping-pong FBO)
     3. blit the result to the canvas, with contain-fit and letterbox bars

   Scene space is the preset's own pixel grid (e.g. 720x1280); the output
   resolution is independent, so a 1080p export and a 360p preview render the
   exact same geometry.
*/

import { VERT, FRAG, FRAG_BLEND } from './shaders.js';

const BLEND_MODES = {
  normal: 0, srcOver: 0, src_over: 0,
  multiply: 1, screen: 2, overlay: 3,
  darken: 4, lighten: 5, softLight: 6, softlight: 6, difference: 7,
};

export const blendModeId = (name) => BLEND_MODES[name] ?? 0;

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error('GLSL compile: ' + log);
  }
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  const v = compile(gl, gl.VERTEX_SHADER, vs);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v); gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v); gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(p);
    gl.deleteProgram(p);
    throw new Error('GLSL link: ' + log);
  }
  const uniforms = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u: uniforms };
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false, antialias: false, depth: false, stencil: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 tidak tersedia di browser ini.');
    this.gl = gl;
    this.canvas = canvas;

    this.main = program(gl, VERT, FRAG);
    this.blended = program(gl, VERT, FRAG_BLEND);
    this.copy = program(gl, VERT, `#version 300 es
precision highp float;
in vec2 vUV; in vec2 vScene;
uniform sampler2D uTex;
out vec4 fragColor;
void main() { fragColor = texture(uTex, vUV); }`);

    // unit quad
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.targets = [null, null];
    this.cur = 0;
    this.w = 0; this.h = 0;
    this.stats = { layers: 0, draws: 0, missing: 0, effectHits: 0, effectMiss: 0 };
    this.debug = false;
  }

  /* ---------------- framebuffer targets (ping-pong) ---------------- */

  makeTarget(w, h) {
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  resize(w, h) {
    w = Math.max(2, Math.round(w));
    h = Math.max(2, Math.round(h));
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    for (const t of this.targets) {
      if (!t) continue;
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    this.targets = [this.makeTarget(w, h), this.makeTarget(w, h)];
    this.w = w; this.h = h;
    this.cur = 0;
  }

  /* ---------------- helpers ---------------- */

  setCommon(prog, scene) {
    const gl = this.gl, u = prog.u;
    gl.useProgram(prog.p);
    if (u.uScene) gl.uniform2f(u.uScene, scene.w, scene.h);
    if (u.uTime) gl.uniform1f(u.uTime, scene.tSec || 0);
    gl.uniform1i(u.uTex, 0);
    if (u.uBack) gl.uniform1i(u.uBack, 1);
    if (u.uTex2) gl.uniform1i(u.uTex2, 2);
    return u;
  }

  bindTex(unit, tex) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
  }

  /** Build the mat3 that maps scene pixels to clip space, incl. letterbox. */
  xform(scene, tx) {
    const { w: sw, h: sh, outW, outH, letter } = scene;
    const ar = sw / sh, car = outW / outH;
    let vw = outW, vh = outH;
    if (letter) {
      if (ar > car) vh = outW / ar; else vw = outH * ar;
    }
    const s = Math.min(outW / sw, outH / sh);
    const cx = (outW - sw * s) / 2, cy = (outH - sh * s) / 2;
    const c = Math.cos((tx.rot || 0) * Math.PI / 180);
    const sn = Math.sin((tx.rot || 0) * Math.PI / 180);
    // clip = 2*(p*s)/out - 1, with origin at the scene centre
    const k = 2 * s / outH;   // uniform on both axes
    const ox = 2 * cx / outW - 1, oy = 2 * cy / outH - 1;
    const px = (tx.x || 0) - sw / 2, py = (tx.y || 0) - sh / 2;
    // column-major mat3: R*S then translate
    return new Float32Array([
      c * k, sn * k, 0,
      -sn * k, c * k, 0,
      ox + px * k, oy - py * k, 1,
    ]);
  }

  /* ---------------- layer draw ---------------- */

  /**
   * @param {object} o  { tex, hasTex, box:[w,h], center:[x,y], rot, opacity,
   *                      color:[r,g,b,a], blend, fillMode, mirror, effect, scene, tx }
   */
  drawLayer(o) {
    const gl = this.gl;
    const { scene } = o;
    const cur = this.targets[this.cur];
    const back = this.targets[1 - this.cur];
    const useBlendProg = o.blend !== 0;
    const prog = useBlendProg ? this.blended : this.main;

    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fb);
    gl.viewport(0, 0, this.w, this.h);
    const u = this.setCommon(prog, scene);

    this.bindTex(0, o.tex);
    gl.uniform1i(u.uHasTex, o.hasTex ? 1 : 0);
    gl.uniform1i(u.uBlendMode, o.blend);
    gl.uniform4f(u.uColor, o.color[0], o.color[1], o.color[2], o.color[3]);
    gl.uniform1f(u.uOpacity, o.opacity);
    gl.uniform2f(u.uBox, o.box[0] * 0.5, o.box[1] * 0.5);
    gl.uniform2f(u.uCenter, o.center[0], o.center[1]);
    gl.uniformMatrix3fv(u.uXform, false, this.xform(scene, { x: o.center[0], y: o.center[1], rot: o.rot }));

    const ar = o.texAR || 1;
    gl.uniform2f(u.uTexAspect, ar, 1 / ar);
    gl.uniform1i(u.uFillMode, o.fillMode ?? 0);
    gl.uniform1i(u.uMirror, o.mirror ?? 0);
    gl.uniform1f(u.uBlur, o.blur || 0);
    gl.uniform1i(u.uGrain, o.grain ? 1 : 0);
    gl.uniform1f(u.uGrainAmt, o.grainAmt || 0);
    gl.uniform1f(u.uVignette, o.vignette || 0);
    gl.uniform1f(u.uContrast, o.contrast ?? 1);
    gl.uniform1f(u.uSaturation, o.saturation ?? 1);
    gl.uniform1f(u.uBrightness, o.brightness || 0);
    gl.uniform1i(u.uInvert, o.invert ? 1 : 0);
    gl.uniform1i(u.uHasSecondTex, 0);
    gl.uniform1f(u.uMix2, 0);

    if (useBlendProg) {
      this.bindTex(1, back.tex);
      gl.disable(gl.BLEND);
    } else {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);

    if (useBlendProg) this.cur = 1 - this.cur;
    this.stats.draws++;
  }

  clearTo(color) {
    const gl = this.gl;
    const t = this.targets[this.cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, this.w, this.h);
    gl.disable(gl.BLEND);
    gl.clearColor(color[0], color[1], color[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  /** Present the composed target to the canvas. */
  present(scene) {
    const gl = this.gl;
    const t = this.targets[this.cur];
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);

    const u = this.setCommon(this.copy, { ...scene, outW: this.canvas.width, outH: this.canvas.height });
    this.bindTex(0, t.tex);
    // present quad covers the whole canvas
    gl.uniformMatrix3fv(u.uXform, false, new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]));
    gl.uniform4f(u.uBox, this.canvas.width, this.canvas.height, 0, 0);
    gl.uniform2f(u.uCenter, 0, 0);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose() {
    const gl = this.gl;
    for (const t of this.targets) {
      if (!t) continue;
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    this.targets = [null, null];
    gl.deleteProgram(this.main.p);
    gl.deleteProgram(this.blended.p);
    gl.deleteProgram(this.copy.p);
    gl.deleteVertexArray(this.vao);
  }
}

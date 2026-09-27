/* gl/shaders.js — GLSL ES 3.00 sources for the layer compositor.

   One program per blend mode would be wasteful; instead the blend mode is a
   #define in a preprocessed body, so we get 8 compiled programs total and
   the rest of the pipeline is shared.
*/

export const VERT = `#version 300 es
precision highp float;
layout(location=0) in vec2 aPos;         // unit quad -1..1
uniform mat3 uXform;                     // scene px -> clip space
uniform vec4 uBox;                       // half extents in scene px
uniform vec2 uCenter;                    // scene px

out vec2 vUV;
out vec2 vScene;

void main() {
  vec2 p = aPos * uBox + uCenter;
  vScene = p;
  vUV = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  vec3 clip = uXform * vec3(p, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}`;

const BLEND_BODY = `
const int BM_NORMAL = 0;
const int BM_MULTIPLY = 1;
const int BM_SCREEN = 2;
const int BM_OVERLAY = 3;
const int BM_DARKEN = 4;
const int BM_LIGHTEN = 5;
const int BM_SOFTLIGHT = 6;
const int BM_DIFFERENCE = 7;

vec3 blendPix(int mode, vec3 cb, vec3 cs) {
  if (mode == BM_MULTIPLY)   return cb * cs;
  if (mode == BM_SCREEN)     return 1.0 - (1.0 - cb) * (1.0 - cs);
  if (mode == BM_OVERLAY)    return mix(2.0*cb*cs, 1.0 - 2.0*(1.0-cb)*(1.0-cs), step(0.5, cb));
  if (mode == BM_DARKEN)     return min(cb, cs);
  if (mode == BM_LIGHTEN)    return max(cb, cs);
  if (mode == BM_SOFTLIGHT)  return mix(2.0*cb*cs + cb*cb*(1.0-2.0*cs),
                                        sqrt(cb) * (2.0*cs - 1.0) + 2.0*cb*(1.0-cs), step(0.5, cs));
  if (mode == BM_DIFFERENCE) return abs(cb - cs);
  return cs;                            // NORMAL
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vScene;

uniform sampler2D uTex;
uniform int   uHasTex;
uniform int   uBlendMode;
uniform vec4  uColor;          // tint RGBA (fillColor / shape color)
uniform float uOpacity;
uniform float uTime;           // seconds, for procedural effects
uniform vec2  uScene;          // scene size in px
uniform int   uFillMode;       // 0 = stretch, 1 = fit, 2 = crop, 3 = repeat
uniform vec2  uTexAspect;      // 1 = none, else (texAR / sceneAR)
uniform int   uMirror;         // 0 none, 1 horizontal, 2 vertical, 3 both
uniform float uBlur;
uniform int   uGrain;
uniform float uGrainAmt;
uniform int   uHasSecondTex;
uniform sampler2D uTex2;
uniform float uMix2;
uniform float uVignette;
uniform float uContrast;
uniform float uSaturation;
uniform float uBrightness;
uniform int   uInvert;

out vec4 fragColor;

${BLEND_BODY}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec4 srcColor() {
  if (uHasTex == 0) return uColor;

  vec2 uv = vUV;
  uv -= 0.5;
  if (uMirror == 1 || uMirror == 3) uv.x = -uv.x;
  if (uMirror == 2 || uMirror == 3) uv.y = -uv.y;
  uv += 0.5;

  if (uFillMode == 1) {                    // contain: keep aspect
    vec2 s = uTexAspect;
    if (s.x > s.y) uv.x = 0.5 + (uv.x - 0.5) / s.x;
    else           uv.y = 0.5 + (uv.y - 0.5) / s.y;
  } else if (uFillMode == 2) {             // crop: fill the box
    vec2 s = uTexAspect;
    if (s.x > s.y) uv.y = 0.5 + (uv.y - 0.5) * s.x;
    else           uv.x = 0.5 + (uv.x - 0.5) * s.y;
  }
  uv = fract(uv);                          // also covers REPEAT

  vec4 c = texture(uTex, uv);
  if (uHasSecondTex == 1) {
    vec4 c2 = texture(uTex2, uv);
    c.rgb = mix(c.rgb, c2.rgb, clamp(uMix2, 0.0, 1.0));
    c.a = mix(c.a, c2.a, clamp(uMix2, 0.0, 1.0));
  }
  return c * uColor;
}

void main() {
  vec4 c = srcColor();

  if (uBlur > 0.0001) {
    vec2 px = 1.0 / max(uScene, vec2(1.0)) * 0.75;
    vec4 sum = c * 0.294;
    sum += texture(uTex, clamp(vUV + vec2( px.x,  px.y), 0.001, 0.999)) * 0.124;
    sum += texture(uTex, clamp(vUV + vec2(-px.x,  px.y), 0.001, 0.999)) * 0.124;
    sum += texture(uTex, clamp(vUV + vec2( px.x, -px.y), 0.001, 0.999)) * 0.124;
    sum += texture(uTex, clamp(vUV + vec2(-px.x, -px.y), 0.001, 0.999)) * 0.124;
    sum += texture(uTex, clamp(vUV + vec2( px.x * 2.0, 0.0), 0.001, 0.999)) * 0.058;
    sum += texture(uTex, clamp(vUV + vec2(-px.x * 2.0, 0.0), 0.001, 0.999)) * 0.058;
    sum += texture(uTex, clamp(vUV + vec2(0.0,  px.y * 2.0), 0.001, 0.999)) * 0.058;
    sum += texture(uTex, clamp(vUV + vec2(0.0, -px.y * 2.0), 0.001, 0.999)) * 0.058;
    c = uHasTex == 1 ? sum : c;
  }

  if (uGrain == 1) {
    float n = hash(floor(vScene * 0.5) + floor(uTime * 24.0)) - 0.5;
    c.rgb += n * uGrainAmt;
  }
  if (uInvert == 1) c.rgb = 1.0 - c.rgb;
  if (uContrast != 1.0)   c.rgb = clamp((c.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
  if (uSaturation != 1.0) {
    float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    c.rgb = clamp(mix(vec3(l), c.rgb, uSaturation), 0.0, 1.0);
  }
  if (uBrightness != 0.0) c.rgb = clamp(c.rgb + uBrightness, 0.0, 1.0);
  if (uVignette > 0.0) {
    vec2 p = vUV - 0.5;
    c.rgb *= clamp(1.0 - uVignette * dot(p, p) * 2.2, 0.0, 1.0);
  }

  c *= uOpacity;
  if (c.a <= 0.0016) discard;

  fragColor = c;
  fragColor.rgb = mix(fragColor.rgb, vec3(0.0), 0.0);
}`;

/** Premultiplied-alpha "over" using the blend mode, done in-shader. */
export const FRAG_BLEND = `#version 300 es
precision highp float;
in vec2 vUV;
in vec2 vScene;
uniform sampler2D uTex;
uniform sampler2D uBack;
uniform int uHasTex;
uniform int uBlendMode;
uniform vec4 uColor;
uniform float uOpacity;
uniform float uTime;
uniform vec2 uScene;
uniform int uFillMode;
uniform vec2 uTexAspect;
uniform int uMirror;
uniform float uBlur;
uniform int uGrain;
uniform float uGrainAmt;
out vec4 fragColor;
${BLEND_BODY}
void main() {
  vec4 back = texture(uBack, vScene / uScene);
  vec4 src = uHasTex == 0 ? uColor
          : texture(uTex, fract(vUV * uTexAspect)) * uColor;
  src *= uOpacity;
  if (src.a <= 0.0016) { fragColor = back; return; }
  vec3 mixed = blendPix(uBlendMode, back.rgb, src.rgb);
  float a = src.a + back.a * (1.0 - src.a);
  vec3 rgb = a > 0.0 ? (mixed * src.a + back.rgb * back.a * (1.0 - src.a)) / a : vec3(0.0);
  fragColor = vec4(rgb, a);
}`;

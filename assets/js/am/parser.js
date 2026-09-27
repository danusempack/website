/* am/parser.js — Alight Motion preset (.xml) -> plain scene model.

   Verified against a real AM 5.0 export (138 KB, 46 shapes, 698 keyframes,
   175 effects, 1 group, 1 audio track). The real format is:

     <scene title=".." width="720" height="1280" exportWidth="1080"
            exportHeight="1920" bgcolor="#ff000000" totalTime="18482" fps="60">
       <media uri=".." type="image/png" duration="0" width="0" height="0"/>
       <bookmark t="6125"/>
       <audio id=".." startTime="0" endTime=".." src="am:....wav" outTime="..">
         <gain><kf t="0.99" v="0.0" e="cubicBezier 0 0 .58 1"/><kf t=".88" v="1.5"/></gain>
       </audio>
       <shape id=".." label=".." startTime="0" endTime="2115"
              fillType="media" fillImage="content://.." mediaFillMode="fill" s=".rect">
         <transform>
           <location value="360.2,640.4,0"/>
           <scale><kf t="3.88" v="0.66,0.66" e="cubicBezier 1 0 1 1"/>…</scale>
           <rotation><kf …/></rotation>
           <opacity><kf …/></opacity>
         </transform>
         <effect id="com.alightcreative.effects.tile" locallyApplied="false">
           <property name="mirror" type="bool" value="true"/>
           <property name="angle" type="float"><kf …/></property>
         </effect>
         <fillColor value="#ff000000"/>
         <property name="size" type="vec2" value="540,959.5"/>
       </shape>
       <embedScene id=".." label="Flash" startTime=".." endTime="..">
         <scene …>  …nested layers…  </scene>
       </embedScene>
     </scene>

   Gotchas this file handles:
     - keyframe `t` is in SECONDS, is not sorted in the file, and can be
       negative. We sort and clamp; times are absolute project time.
     - `e` on a <kf> describes the segment FROM that kf TO the next one.
     - effect identity lives in `id` ("com.alightcreative.effects.blur");
       there is no `type` attribute.
     - bgcolor/fillColor are #AARRGGBB, not #RRGGBB.
     - a static property is `value="…"`, an animated one has <kf> children.

   SECURITY: nothing here is ever evaluated. No `new Function`, no eval, no
   <script> execution, no fetch. This is the single biggest difference from
   the reference player, which ran the JavaScript embedded in the preset.
   Worker-safe: only DOMParser, never `document` or `window`.
*/

import { parseEasing, easingLabel } from './ease.js';
import { parseColor } from '../core/util.js';

export const LIMITS = {
  MAX_XML_BYTES: 32 * 1024 * 1024,
  MAX_LAYERS: 4000,
  MAX_NODES: 400000,
  MAX_KFS_PER_TRACK: 20000,
  MAX_DEPTH: 32,
};

const num = (v, d = 0) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
};
const list = (v) => (v == null || v === '' ? [] : String(v).split(',').map((s) => num(s)));
const isVecType = (t) => t === 'vec2' || t === 'vec3' || t === 'vec4';

/**
 * Normalise a raw comma-list into either a number (scalar types) or an array
 * of numbers (vec types). AM writes scalar properties as a bare `v="1.5"`, so
 * "is it an array" cannot be used to tell scalars from vectors.
 */
function shape(type, v) {
  return isVecType(type) ? v : num(v[0]);
}

let _dp = null;
const DParser = () => (_dp ||= new DOMParser());

const firstChild = (node, tag) => {
  for (let n = node.firstElementChild; n; n = n.nextElementSibling) {
    if (n.tagName === tag) return n;
  }
  return null;
};
const childrenOf = (node, tag) => {
  const out = [];
  for (let n = node.firstElementChild; n; n = n.nextElementSibling) {
    if (!tag || n.tagName === tag) out.push(n);
  }
  return out;
};

/**
 * Read a property-ish element into a track.
 *   <location value="x,y,z"/>          -> static
 *   <scale><kf/>…</scale>              -> animated
 *   <x v="…"/>  / attribute soup       -> tolerated legacy form
 */
function readTrack(node, type) {
  if (!node) return null;
  const kfNodes = childrenOf(node, 'kf');
  const staticVal = node.getAttribute('value') ?? node.getAttribute('v');

  if (!kfNodes.length) {
    if (staticVal == null) {
      return { kind: 'static', type, v: isVecType(type) ? [] : 0, missing: true };
    }
    return { kind: 'static', type, v: shape(type, list(staticVal)) };
  }

  const kfs = [];
  for (const k of kfNodes) {
    if (kfs.length >= LIMITS.MAX_KFS_PER_TRACK) break;
    const e = k.getAttribute('e') || 'linear';
    kfs.push({
      t: num(k.getAttribute('t'), 0),
      v: shape(type, list(k.getAttribute('v'))),
      e,
      fn: parseEasing(e),
      label: easingLabel(e),
    });
  }
  kfs.sort((a, b) => a.t - b.t);
  if (!kfs.length) return { kind: 'static', type, v: isVecType(type) ? [] : 0 };
  return { kind: 'kf', type, kfs, v: kfs[kfs.length - 1].v };
}

/** Parse an attribute-soup fragment like v="<kf …/><kf …/>" (older exports). */
function readTrackFromAttr(str, type) {
  if (!str) return null;
  if (!str.includes('<kf')) {
    return { kind: 'static', type, v: shape(type, list(str)) };
  }
  const doc = DParser().parseFromString(`<x>${str}</x>`, 'application/xml');
  if (doc.querySelector('parsererror')) {
    return { kind: 'static', type, v: isVecType(type) ? [] : 0 };
  }
  const kfs = [];
  for (const k of childrenOf(doc.documentElement, 'kf')) {
    if (kfs.length >= LIMITS.MAX_KFS_PER_TRACK) break;
    const e = k.getAttribute('e') || 'linear';
    kfs.push({
      t: num(k.getAttribute('t'), 0),
      v: shape(type, list(k.getAttribute('v'))),
      e, fn: parseEasing(e), label: easingLabel(e),
    });
  }
  kfs.sort((a, b) => a.t - b.t);
  return kfs.length
    ? { kind: 'kf', type, kfs, v: kfs[kfs.length - 1].v }
    : { kind: 'static', type, v: isVecType(type) ? [] : 0 };
}

/** Evaluate a track at `tSec` (seconds — AM keyframe times are seconds). */
export function sampleTrack(tr, tSec, out = []) {
  if (!tr) return null;
  if (tr.kind === 'static') return tr.v;

  const kfs = tr.kfs;
  if (!kfs || !kfs.length) return tr.v;
  if (tSec <= kfs[0].t) return kfs[0].v;
  if (tSec >= kfs[kfs.length - 1].t) return kfs[kfs.length - 1].v;

  let lo = 0, hi = kfs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kfs[mid].t <= tSec) lo = mid; else hi = mid;
  }
  const a = kfs[lo], b = kfs[hi];
  const span = b.t - a.t;
  const u = span > 1e-9 ? (tSec - a.t) / span : 1;
  const e = a.fn ? a.fn(u) : u;

  // The declared type decides scalar vs vector — a scalar <kf> still parses
  // its v="1.5" into a one-element list.
  if (!isVecType(tr.type)) return num(a.v) + (num(b.v) - num(a.v)) * e;

  const n = Math.max(a.v.length, b.v.length);
  for (let i = 0; i < n; i++) {
    const av = num(a.v[i]), bv = num(b.v[i]);
    out[i] = av + (bv - av) * e;
  }
  return out;
}

/* --------------------------------------------------------------- structures */

/* AM is not consistent about effect ids. Most are
 * "com.alightcreative.effects.<name>", but a real export also contained
 * "com.alightcreative.fourcolorgradient" with no `effects.` segment. Strip
 * whichever prefix is present so a lookup never misses on the namespace alone;
 * the name after it is what identifies the effect. */
const EFFECT_PREFIXES = ['com.alightcreative.effects.', 'com.alightcreative.'];

const shortFxName = (id) => {
  for (const p of EFFECT_PREFIXES) {
    if (id.startsWith(p)) return id.slice(p.length);
  }
  return id;
};

const KIND_BY_NODE = {
  shape: 'shape',
  image: 'image',
  video: 'video',
  audio: 'audio',
  embedScene: 'group',
};

function readProps(node, ctx) {
  const props = new Map();
  for (const p of childrenOf(node, 'property')) {
    const name = p.getAttribute('name');
    if (!name) continue;
    const type = p.getAttribute('type') || 'float';
    const track = readTrack(p, type);
    props.set(name, {
      type,
      track,
      value: track?.kind === 'static' ? track.v : null,
      raw: p.getAttribute('value'),
      hasKF: track?.kind === 'kf',
    });
  }
  return props;
}

function readEffects(node) {
  const out = [];
  for (const ef of childrenOf(node, 'effect')) {
    const id = ef.getAttribute('id') || ef.getAttribute('type') || 'effect';
    out.push({
      id,
      kind: shortFxName(id),
      full: id,
      locallyApplied: ef.getAttribute('locallyApplied') === 'true',
      props: readProps(ef),
      xml: ef.outerHTML.slice(0, 3000),
    });
  }
  return out;
}

function readTransform(node) {
  if (!node) return { loc: null, scale: null, rot: null, opacity: null };
  return {
    loc: readTrack(firstChild(node, 'location'), 'vec3'),
    scale: readTrack(firstChild(node, 'scale'), 'vec2'),
    rot: readTrack(firstChild(node, 'rotation'), 'float'),
    opacity: readTrack(firstChild(node, 'opacity'), 'float'),
  };
}

function parseLayer(node, ctx, depth) {
  if (ctx.nodes++ > LIMITS.MAX_NODES) {
    ctx.notes.push('Batas node XML tercapai; sebagian layer dipotong.');
    return null;
  }
  if (depth > LIMITS.MAX_DEPTH) {
    ctx.notes.push('Kedalaman grup melebihi batas; grup dipotong.');
    return null;
  }

  const tag = node.tagName;
  const kind = KIND_BY_NODE[tag] || 'unknown';
  const start = num(node.getAttribute('startTime'), 0);
  const label = node.getAttribute('label') || node.getAttribute('name') || tag;

  // A group embeds a whole <scene>; a legacy export may nest layers directly.
  let children = [];
  let inner = null;
  if (kind === 'group') {
    const sub = firstChild(node, 'scene');
    if (sub) {
      inner = readSceneAttrs(sub);
      for (const kid of sub.children) {
        if (KIND_BY_NODE[kid.tagName]) {
          const l = parseLayer(kid, ctx, depth + 1);
          if (l) children.push(l);
        }
      }
    } else {
      for (const kid of node.children) {
        if (KIND_BY_NODE[kid.tagName]) {
          const l = parseLayer(kid, ctx, depth + 1);
          if (l) children.push(l);
        }
      }
    }
  }

  const props = readProps(node, ctx);
  const transform = readTransform(firstChild(node, 'transform'));
  // Legacy attribute-soup transforms, if present.
  if (!transform.loc) transform.loc = readTrackFromAttr(node.getAttribute('loc'), 'vec3');
  if (!transform.scale) transform.scale = readTrackFromAttr(node.getAttribute('scale'), 'vec2');
  if (!transform.rot) transform.rot = readTrackFromAttr(node.getAttribute('rot'), 'float');
  if (!transform.opacity) transform.opacity = readTrackFromAttr(node.getAttribute('opacity'), 'float');

  const fillColorEl = firstChild(node, 'fillColor');
  const fillColorRaw = fillColorEl
    ? (fillColorEl.getAttribute('value') ?? fillColorEl.getAttribute('v'))
    : node.getAttribute('fillColor');

  const fillType = node.getAttribute('fillType') || '';
  const isMediaKind = kind === 'image' || kind === 'video' || kind === 'audio';

  return {
    id: node.getAttribute('id') || `L${ctx.id++}`,
    label,
    kind,
    start,
    end: Math.max(num(node.getAttribute('endTime'), start), start),
    uri: isMediaKind || fillType === 'media'
      ? node.getAttribute('fillImage') || node.getAttribute('src') || node.getAttribute('uri') || ''
      : '',
    shapePath: node.getAttribute('s') || '',
    fillType,
    fillColor: fillColorRaw || '',
    mediaFillMode: node.getAttribute('mediaFillMode') || '',
    transform,
    size: props.get('size') ? (props.get('size').value || null) : null,
    color: fillColorRaw ? parseColor(fillColorRaw) : null,
    props,
    effects: readEffects(node),
    children,
    innerScene: inner,
    xml: node.outerHTML.slice(0, 20000),
  };
}

function readSceneAttrs(node) {
  return {
    title: node.getAttribute('title') || '',
    w: num(node.getAttribute('width'), 720),
    h: num(node.getAttribute('height'), 1280),
    expW: num(node.getAttribute('exportWidth'), 0),
    expH: num(node.getAttribute('exportHeight'), 0),
    totalTime: num(node.getAttribute('totalTime'), 0),
    fps: num(node.getAttribute('fps'), 30),
  };
}

/* -------------------------------------------------------------------- entry */

/** Parse preset XML text into a scene model. Throws Error with .code set. */
export function parsePresetXML(text, { name = 'preset.xml' } = {}) {
  if (typeof text !== 'string' || !text.trim()) {
    const e = new Error('File XML kosong.');
    e.code = 'EMPTY';
    throw e;
  }
  if (text.length > LIMITS.MAX_XML_BYTES) {
    const e = new Error('Ukuran XML melebihi batas yang diizinkan.');
    e.code = 'TOO_LARGE';
    throw e;
  }

  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch (err) {
    const e = new Error('XML tidak bisa dibaca: ' + String(err?.message || err).slice(0, 140));
    e.code = 'BAD_XML';
    throw e;
  }
  const perr = doc.querySelector('parsererror');
  if (perr) {
    const msg = (perr.textContent || 'struktur tidak dikenali').replace(/\s+/g, ' ').slice(0, 150);
    const e = new Error('XML tidak valid — ' + msg);
    e.code = 'BAD_XML';
    throw e;
  }

  const root = doc.documentElement;
  const ctx = { notes: [], id: 1, nodes: 0 };
  const attrs = readSceneAttrs(root);

  const media = {};
  for (const m of doc.getElementsByTagName('media')) {
    const uri = m.getAttribute('uri');
    if (!uri) continue;
    media[uri] = {
      uri,
      type: m.getAttribute('type') || '',
      filename: m.getAttribute('filename') || '',
      title: m.getAttribute('title') || '',
      duration: num(m.getAttribute('duration'), 0),
      w: num(m.getAttribute('width'), 0),
      h: num(m.getAttribute('height'), 0),
      size: num(m.getAttribute('size'), 0),
    };
  }

  // Audio TRACKS are direct children of <scene> and carry `outTime`.
  // Audio LAYERS live alongside shapes and have no <gain> child.
  const audio = [];
  for (const a of childrenOf(root, 'audio')) {
    if (!a.getAttribute('outTime')) continue;
    audio.push({
      id: a.getAttribute('id') || `A${audio.length + 1}`,
      start: num(a.getAttribute('startTime'), 0),
      end: num(a.getAttribute('endTime'), 0),
      src: a.getAttribute('src') || '',
      outTime: num(a.getAttribute('outTime'), 0),
      gain: readTrack(firstChild(a, 'gain'), 'float'),
    });
  }

  const bookmarks = [];
  for (const b of childrenOf(root, 'bookmark')) {
    bookmarks.push(num(b.getAttribute('t'), 0));
  }
  bookmarks.sort((a, b) => a - b);

  const layers = [];
  for (const node of root.children) {
    if (!KIND_BY_NODE[node.tagName]) continue;
    if (layers.length >= LIMITS.MAX_LAYERS) {
      ctx.notes.push('Batas jumlah layer tercapai.');
      break;
    }
    const l = parseLayer(node, ctx, 0);
    if (l) layers.push(l);
  }

  if (!layers.length) {
    ctx.notes.push('Tidak ada layer shape/image/video/embedScene yang bisa dibaca.');
  }

  // A legacy <AMFML> wrapper puts the layers one level deeper.
  if (!layers.length) {
    const inner = doc.getElementsByTagName('scene')[0];
    if (inner) {
      for (const node of inner.children) {
        if (!KIND_BY_NODE[node.tagName]) continue;
        const l = parseLayer(node, ctx, 0);
        if (l) layers.push(l);
      }
    }
  }

  return {
    name,
    title: attrs.title,
    w: attrs.w || 720,
    h: attrs.h || 1280,
    expW: attrs.expW || attrs.w,
    expH: attrs.expH || attrs.h,
    duration: attrs.totalTime,
    fps: attrs.fps,
    bgcolor: root.getAttribute('bgcolor') || '#ff000000',
    precompose: root.getAttribute('precompose') || '',
    media,
    audio,
    bookmarks,
    layers,
    notes: ctx.notes,
  };
}

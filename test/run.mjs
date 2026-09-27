/* Parser + easing tests. Run: node test/run.mjs
   Uses the minimal DOM shim, not a browser. */

import fs from 'node:fs';
import { installDOMParser } from './domshim.mjs';
import { stageApp, hasRef, readRef, REF_XML, ASSETS } from './paths.mjs';

installDOMParser();

// The site ships no package.json (it is a static, build-free app), so Node
// would treat its .js files as CommonJS. stageApp() copies the app into a temp
// dir marked as ESM rather than polluting the shipped tree with a package.json.
const { mod } = stageApp();

const { parsePresetXML, sampleTrack, LIMITS } = await mod('assets/js/am/parser.js');
const { parseEasing, cubicBezier } = await mod('assets/js/am/ease.js');

let pass = 0, fail = 0, skip = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  \x1b[32mPASS\x1b[0m ' + name); }
  else { fail++; console.log('  \x1b[31mFAIL\x1b[0m ' + name + (extra ? '  \u2014 ' + extra : '')); }
};
const section = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');

/* ---------------------------------------------------- easing */
section('easing');
ok('linear is identity', parseEasing('linear')(0.37) === 0.37);
const ease = parseEasing('cubicBezier 0.42 0 0.58 1');
ok('cubicBezier anchors', Math.abs(ease(0)) < 1e-6 && Math.abs(ease(1) - 1) < 1e-6,
  `${ease(0)}, ${ease(1)}`);
ok('cubicBezier monotone-ish at 0.5', ease(0.5) > 0.4 && ease(0.5) < 0.6, String(ease(0.5)));
ok('cubicBezier handles x1=x2=y1=y2 as identity',
  cubicBezier(0.3, 0.3, 0.7, 0.7)(0.42) === 0.42);
ok('unknown easing degrades to linear', parseEasing('wat 1 2 3')(0.6) === 0.6);
const el = parseEasing('elastic 0.5 1.0 0.0 1.0');
ok('elastic anchors', Math.abs(el(0)) < 1e-6 && Math.abs(el(1) - 1) < 1e-6, `${el(0)}, ${el(1)}`);
ok('elastic overshoots', el(0.7) > 1 || el(0.7) < 0, String(el(0.7)));
const rev = parseEasing('reverse elastic 0.5 1.0 0.0 1.0');
ok('reverse elastic is the inverse', Math.abs((rev(0.3) - (1 - el(0.7)))) < 1e-9,
  `${rev(0.3)} vs ${1 - el(0.7)}`);
ok('empty easing -> linear', parseEasing('')(0.25) === 0.25);
// cubicBezier(1,0,1,1): X(t)=3t-3t^2+3t^3, Y(t)=3t^2-2t^3.
// At t=0.5 -> x=0.875, y=0.5.
const holdish = parseEasing('cubicBezier 1.0 0.0 1.0 1.0');
ok('cubicBezier 1 0 1 1 matches closed-form math',
  Math.abs(holdish(0.875) - 0.5) < 1e-4, String(holdish(0.875)));
ok('cubicBezier solves the inverse correctly across the range',
  [0.1, 0.3, 0.5, 0.7, 0.9].every((x) => {
    // forward-map Y at the parameter where X == x
    // X(t) = t^3 - 3t^2 + 3t, Y(t) = 3t^2 - 2t^3 for control points (1,0,1,1)
    const X = (t) => t*t*t - 3*t*t + 3*t;
    const Y = (t) => 3*t*t - 2*t*t*t;
    let lo = 0, hi = 1;
    for (let i = 0; i < 40; i++) { const m = (lo+hi)/2; X(m) < x ? lo = m : hi = m; }
    return Math.abs(holdish(x) - Y((lo+hi)/2)) < 1e-4;
  }));

if (hasRef) {
  /* ------------------------------------------------- real preset */
  section(`real Alight Motion export (${REF_XML.split('/').pop()})`);
  const refText = readRef();
  let scene;
  try {
    scene = parsePresetXML(refText, { name: 'Beraksi.xml' });
    ok('parses without throwing', true);
  } catch (e) {
    ok('parses without throwing', false, e.message);
    console.log(e.stack);
  }

  if (scene) {
    ok('root is <scene> 720x1280', scene.w === 720 && scene.h === 1280, `${scene.w}x${scene.h}`);
    ok('export size read', scene.expW === 1080 && scene.expH === 1920, `${scene.expW}x${scene.expH}`);
    ok('duration 18482 ms', scene.duration === 18482, String(scene.duration));
    ok('fps 60', scene.fps === 60, String(scene.fps));
    ok('title read', scene.title.includes('Beraksi'), scene.title);
    // 46 <shape> + 1 <embedScene> + 1 <audio> layer at scene level
    ok('48 top-level layer nodes', scene.layers.length === 48, String(scene.layers.length));
    ok('46 shapes + 1 group + 1 audio layer',
      scene.layers.filter((l) => l.kind === 'shape').length === 46 &&
      scene.layers.filter((l) => l.kind === 'group').length === 1 &&
      scene.layers.filter((l) => l.kind === 'audio').length === 1,
      JSON.stringify(scene.layers.reduce((a, l) => (a[l.kind] = (a[l.kind] || 0) + 1, a), {})));
    ok('6 media entries', Object.keys(scene.media).length === 6, String(Object.keys(scene.media).length));
    ok('27 bookmarks, sorted',
      scene.bookmarks.length === 27 && scene.bookmarks.every((b, i, a) => i === 0 || a[i - 1] <= b),
      String(scene.bookmarks.length));
    ok('1 audio track with gain track',
      scene.audio.length === 1 && scene.audio[0].gain?.kind === 'kf',
      JSON.stringify(scene.audio.map((a) => a.gain?.kind)));
    ok('audio track src is am: blob', scene.audio[0].src.startsWith('am:'), scene.audio[0].src);
    ok('bgcolor is AARRGGBB', /^#[0-9a-f]{8}$/i.test(scene.bgcolor), scene.bgcolor);

    const group = scene.layers.find((l) => l.kind === 'group');
    ok('group layer found', !!group);
    if (group) {
      ok('group has 8 nested layers', group.children.length === 8, String(group.children.length));
      ok('nested children are shapes', group.children.every((l) => l.kind === 'shape'));
      ok('group carries its own scene size', group.innerScene?.w === 730 && group.innerScene?.h === 1280,
        JSON.stringify(group.innerScene));
    }

    const shapes = scene.layers.filter((l) => l.kind === 'shape');
    ok('every layer declares a mediaFillMode',
      scene.layers.every((l) => !!l.mediaFillMode),
      [...new Set(scene.layers.map((l) => l.mediaFillMode))].join(','));
    ok('mediaFillMode values are AM fill modes',
      scene.layers.every((l) => ['fill', 'stretch', 'crop', 'fit', 'tile'].includes(l.mediaFillMode)),
      [...new Set(scene.layers.map((l) => l.mediaFillMode))].join(','));

    const withScale = shapes.filter((l) => l.transform.scale?.kind === 'kf');
    ok('most shapes have animated scale', withScale.length >= 20 && withScale.length <= 46,
      String(withScale.length));
    ok('shapes with static scale use value=',
      shapes.filter((l) => l.transform.scale?.kind === 'static').length > 0);

    const s0 = withScale[0];
    ok('keyframes are sorted by t', (() => {
      const t = s0.transform.scale.kfs.map((k) => k.t);
      return t.every((v, i) => i === 0 || t[i - 1] <= v);
    })());
    ok('9 scale keyframes on the first shape', s0.transform.scale.kfs.length === 9,
      String(s0.transform.scale.kfs.length));
    ok('negative keyframe times tolerated',
      withScale.some((l) => l.transform.scale.kfs.some((k) => k.t < 0)),
      withScale.flatMap((l) => l.transform.scale.kfs.map((k) => k.t)).filter((t) => t < 0).slice(0, 5).join(','));
    ok('easing label carried through',
      s0.transform.scale.kfs.some((k) => k.label.startsWith('cubicBezier')),
      s0.transform.scale.kfs[0].label);

    const totalKf = (() => {
      let n = 0;
      const walk = (ls) => ls.forEach((l) => {
        for (const tr of Object.values(l.transform)) n += tr?.kind === 'kf' ? tr.kfs.length : 0;
        for (const e of l.effects) {
          for (const p of e.props.values()) if (p.track?.kind === 'kf') n += p.track.kfs.length;
        }
        if (l.children.length) walk(l.children);
      });
      walk(scene.layers);
      for (const a of scene.audio) n += a.gain?.kind === 'kf' ? a.gain.kfs.length : 0;
      return n;
    })();
    const rawKf = (refText.match(/<kf /g) || []).length;
    ok('reads every <kf> in the file', totalKf === rawKf, `${totalKf} of ${rawKf}`);
    ok('audio gain keyframes read', scene.audio[0].gain?.kfs.length === 2,
      String(scene.audio[0].gain?.kfs.length));

    const totalFx = (() => {
      let n = 0;
      const walk = (ls) => ls.forEach((l) => {
        n += l.effects.length;
        if (l.children.length) walk(l.children);
      });
      walk(scene.layers);
      return n;
    })();
    ok('reads 175 effects', totalFx === 175, String(totalFx));

    // AM is not consistent: most ids are "com.alightcreative.effects.<name>" but
    // this export also contains "com.alightcreative.fourcolorgradient" with no
    // `effects.` segment. `full` keeps whatever AM wrote; `kind` must be reduced
    // to the bare name either way, or a registry lookup misses on the namespace.
    const allEffects = [];
    (function collect(ls) {
      ls.forEach((l) => { l.effects.forEach((e) => allEffects.push(e)); collect(l.children || []); });
    })(scene.layers);
    ok('effect ids keep the name AM wrote',
      allEffects.every((e) => e.full.startsWith('com.alightcreative.')),
      allEffects.map((e) => e.full).filter((f) => !f.startsWith('com.alightcreative.')).slice(0, 3).join(' '));
    ok('kind is always the bare effect name, with no namespace left',
      allEffects.every((e) => !e.kind.includes('.') && e.kind.length > 0),
      allEffects.map((e) => e.kind).filter((k) => k.includes('.')).slice(0, 3).join(' '));
    ok('both AM prefixes normalise to the same short name',
      allEffects.some((e) => e.full === 'com.alightcreative.fourcolorgradient' && e.kind === 'fourcolorgradient')
      && allEffects.some((e) => e.full === 'com.alightcreative.effects.tile' && e.kind === 'tile'),
      'tile + fourcolorgradient');
    ok('short effect name derived',
      shapes[0].effects.some((e) => e.kind === 'tile'),
      shapes[0].effects.map((e) => e.kind).join(','));

    ok('size property is vec2 full dims',
      shapes[0].size?.length === 2 && shapes[0].size[0] > 0,
      JSON.stringify(shapes[0].size));
    const colourShape = shapes.find((l) => l.fillType === 'color' && l.fillColor);
    ok('a fillType="color" layer carries fillColor', !!colourShape,
      colourShape?.fillColor || 'none found');
    ok('AARRGGBB fillColor parsed to rgba with alpha 1',
      colourShape && Math.abs(colourShape.color[3] - 1) < 0.02,
      JSON.stringify(colourShape?.color));
    ok('media layers have no fillColor', shapes.filter((l) => l.fillType === 'media')
      .every((l) => !l.color));
    ok('no parser warnings on a valid file', scene.notes.length === 0, scene.notes.join(' | '));

    section('sampling the real preset');
    const orb = shapes[0];
    const t0 = orb.transform.scale;
    ok('sample before first kf clamps to first value',
      Math.abs(sampleTrack(t0, -99)[0] - t0.kfs[0].v[0]) < 1e-9);
    ok('sample after last kf clamps to last value',
      Math.abs(sampleTrack(t0, 9999)[0] - t0.kfs[t0.kfs.length - 1].v[0]) < 1e-9);
    const mid = (t0.kfs[3].t + t0.kfs[4].t) / 2;
    const sv = sampleTrack(t0, mid);
    ok('sample between kfs is between their values',
      sv[0] > Math.min(t0.kfs[3].v[0], t0.kfs[4].v[0]) - 1e-6 &&
      sv[0] < Math.max(t0.kfs[3].v[0], t0.kfs[4].v[0]) + 1e-6,
      JSON.stringify(sv));
    const rotSample = sampleTrack(orb.transform.rot, 1.5);
    ok('animated scalar track returns a number, not an array',
      typeof rotSample === 'number' && Number.isFinite(rotSample),
      `${typeof rotSample} ${String(rotSample)}`);
    const statics = scene.layers.filter((l) =>
      ['rot', 'opacity'].some((k) => l.transform[k]?.kind === 'static'));
    ok('this file has at least one static scalar transform', statics.length > 0,
      String(statics.length));
    if (statics.length) {
      const l = statics[0];
      const key = l.transform.rot?.kind === 'static' ? 'rot' : 'opacity';
      const v = sampleTrack(l.transform[key], 1000);
      ok('static scalar track returns a number, not an array',
        typeof v === 'number' && Number.isFinite(v), `${typeof v} ${String(v)}`);
    }
    const missing = scene.layers.filter((l) => !l.transform.opacity);
    ok('layers with no <opacity> element report null, not garbage',
      missing.every((l) => l.transform.opacity === null), String(missing.length));
    const vecLoc = sampleTrack(orb.transform.loc, 0);
    ok('vec track still returns an array', Array.isArray(vecLoc) && vecLoc.length === 3,
      JSON.stringify(vecLoc));
    ok('static location returns 3 numbers',
      sampleTrack(orb.transform.loc, 0).length === 3,
      JSON.stringify(sampleTrack(orb.transform.loc, 0)));
    const locs = new Set();
    for (let ms = 0; ms <= scene.duration; ms += 137) {
      const L = sampleTrack(orb.transform.loc, ms / 1000);
      if (L) locs.add(L.map((v) => v.toFixed(2)).join(','));
    }
    ok('location is static across the timeline (as authored)', locs.size === 1, `${locs.size} distinct`);
  }

  /* --------------------------------------------------------- demo */
} else {
  section('real Alight Motion export');
  skip += 2;
  console.log('  \x1b[33mSKIP\x1b[0m no reference export available. Set AM_REF_XML=/path/to/export.xml');
  console.log('  \x1b[33mSKIP\x1b[0m or drop one at test/fixtures/Beraksi.xml to enable these groups');
}

section('bundled demo preset');
const demo = JSON.parse(fs.readFileSync(new URL('../assets/data/demo.json', import.meta.url), 'utf8'));
let d;
try { d = parsePresetXML(demo.xml, { name: demo.name }); ok('demo parses', true); }
catch (e) { ok('demo parses', false, e.message); }

if (d) {
  ok('demo 720x1280 / 6000 ms / 30 fps',
    d.w === 720 && d.h === 1280 && d.duration === 6000 && d.fps === 30,
    `${d.w}x${d.h} ${d.duration}ms ${d.fps}fps`);
  ok('8 top-level layer nodes (7 + 1 group)', d.layers.length === 8, String(d.layers.length));
  ok('one group with 3 children',
    d.layers.filter((l) => l.kind === 'group').length === 1 &&
    d.layers.find((l) => l.kind === 'group').children.length === 3);
  ok('one image layer with a media slot',
    d.layers.some((l) => l.kind === 'image' && l.uri === 'my_photo.jpg'));
  ok('one audio track', d.audio.length === 1 && d.audio[0].src === 'my_bed.mp3');
  ok('3 bookmarks', d.bookmarks.length === 3, String(d.bookmarks.length));
  ok('unknown effect neonGlowUltra is read, not dropped',
    d.layers.some((l) => l.effects.some((e) => e.kind === 'neonGlowUltra')));
  ok('no warnings', d.notes.length === 0, d.notes.join(' | '));
  const orb = d.layers.find((l) => l.label === 'Orb');
  ok('elastic scale keyframes survive',
    orb.transform.scale.kfs.some((k) => k.e.includes('elastic')));
  const s = sampleTrack(orb.transform.scale, 3.0);
  ok('orb scale at 3s is finite', Number.isFinite(s[0]) && Number.isFinite(s[1]), JSON.stringify(s));
  const st = sampleTrack(orb.transform.opacity, 1.0);
  ok('static opacity 0.9 read as a scalar', typeof st === 'number' && Math.abs(st - 0.9) < 1e-9, String(st));
  const anim = d.layers.find((l) => l.label === 'Accent Bar');
  const op0 = sampleTrack(anim.transform.opacity, 0);
  const opMid = sampleTrack(anim.transform.opacity, 3.0);
  const opEnd = sampleTrack(anim.transform.opacity, 6000);
  ok('accent bar opacity animates 0 -> 1 -> 0',
    op0 === 0 && Math.abs(opMid - 1) < 1e-6 && opEnd === 0,
    `${op0}, ${opMid}, ${opEnd}`);
  const kids = d.layers.find((l) => l.kind === 'group').children;
  ok('all three nested group layers have an animated rotation',
    kids.every((k) => k.transform.rot?.kind === 'kf'),
    kids.map((k) => k.transform.rot?.kind).join(','));
  const chipRot = sampleTrack(kids[0].transform.rot, 4.0);
  ok('nested group layer rotation samples to a finite number',
    typeof chipRot === 'number' && Number.isFinite(chipRot), `${typeof chipRot} ${String(chipRot)}`);
  const chipLoc = sampleTrack(kids[0].transform.loc, 4.0);
  ok('nested group layer location is a 3-vector',
    Array.isArray(chipLoc) && chipLoc.length === 3, JSON.stringify(chipLoc));
  const chipOp = sampleTrack(kids[0].transform.opacity, 2.9); // between kfs at 2.6s and 3.2s
  ok('nested group layer opacity interpolates', chipOp > 0 && chipOp < 1, String(chipOp));
}

/* ------------------------------------------------------- errors */
section('error handling');
const expectFail = (name, text, code) => {
  try { parsePresetXML(text); ok(name, false, 'did not throw'); }
  catch (e) { ok(name, e.code === code, `code=${e.code} msg=${e.message}`); }
};
expectFail('empty file rejected', '', 'EMPTY');
expectFail('whitespace-only rejected', '   \n  ', 'EMPTY');
expectFail('malformed XML rejected', '<scene><shape></scene>', 'BAD_XML');
expectFail('unclosed tag rejected', '<scene><shape id="1">', 'BAD_XML');
expectFail('oversized input rejected', 'x'.repeat(33 * 1024 * 1024), 'TOO_LARGE');

/* --------------------------------------------------- size cap */
section('limits');
ok('XML cap is 32 MB', LIMITS.MAX_XML_BYTES === 32 * 1024 * 1024, String(LIMITS.MAX_XML_BYTES));
ok('layer cap exists', LIMITS.MAX_LAYERS > 0 && LIMITS.MAX_LAYERS <= 10000, String(LIMITS.MAX_LAYERS));

/* ------------------------------------------------- no eval */
section('security');
const js = fs.readFileSync(new URL('../assets/js/am/parser.js', import.meta.url), 'utf8');
ok('parser.js has no eval/new Function', !/\beval\s*\(|new\s+Function\s*\(/.test(js));
const evil = `<?xml version="1.0"?><scene width="720" height="1280" totalTime="1000">
<shape id="1" label="evil" startTime="0" endTime="1000" fillType="color">
<script>globalThis.__pwned = true</script>
<property name="size" type="vec2" value="10,10"/>
</shape></scene>`;
let e2 = null;
try { e2 = parsePresetXML(evil); } catch { /* fine */ }
ok('preset containing <script> still parses', !!e2);
ok('script tag is not executed', globalThis.__pwned === undefined);
ok('the app never reads a script body',
  !/scriptEl|textContent.*script/i.test(js.replace(/\/\*[\s\S]*?\*\//g, '')),
  'parser references script nodes');

console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
process.exit(fail ? 1 : 0);

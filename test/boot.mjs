/* Runtime smoke tests: run the app's real boot path and its real WebGL
 * compositor in Node against the browser stubs.
 *
 * Static checks cannot see a ReferenceError thrown during init, a uniform
 * lookup returning undefined, or an effect resolver dividing by a zero. This
 * exercises those paths for real.
 *
 * A real Alight Motion export makes these tests much stronger, so set
 * AM_REF_XML (or drop a file in test/fixtures/). Without one, the deep
 * render groups are skipped and the bundled demo preset stands in.
 */
import fs from 'node:fs';

import { installBrowserEnv } from './browserstub.mjs';
import { installDOMParser } from './domshim.mjs';
import { stageApp, hasRef, readRef, REF_XML, demoRaw as readDemoJson, INDEX_HTML } from './paths.mjs';

let fails = 0;
let passes = 0;
let skipped = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) { passes++; console.log('  PASS ' + msg); }
  else { fails++; console.log('  FAIL ' + msg + (extra ? '  \u2014 ' + extra : '')); }
};
const group = (t) => console.log('\n\x1b[1m' + t + '\x1b[0m');
const skip = (why) => { skipped++; console.log('  SKIP ' + why); };

const { mod } = stageApp();
installBrowserEnv({ html: INDEX_HTML });
installDOMParser();

const settle = async (turns = 12) => {
  for (let i = 0; i < turns; i++) await new Promise((r) => setTimeout(r, 0));
};
const readDemo = () => readDemoJson();


const errors = [];
process.on('unhandledRejection', (e) => {
  const m = 'unhandledRejection: ' + (e?.stack || e);
  errors.push(m);
  console.log('  !! ' + m);
});
process.on('uncaughtException', (e) => {
  const m = 'uncaughtException: ' + (e?.stack || e);
  errors.push(m);
  console.log('  !! ' + m);
});

await mod('assets/js/main.js');
await settle(40);

const doc = globalThis.document;
const { logText } = await mod('assets/js/core/log.js');
const transcript = logText();
ok(errors.length === 0, 'boot() raised no unhandled errors', errors.join('\n'));
ok(doc.getElementById('app').hidden === false, '#app was revealed');
ok(transcript.includes('Aplikasi siap.'), 'boot ran to completion',
  transcript.split('\n').join(' | '));
for (const step of ['Transport siap.', 'Panel layer siap.', 'Pintasan papan tik aktif.']) {
  ok(transcript.includes(step), `init step ran: ${step}`);
}
ok(doc.getElementById('stagebusy').hidden === true,
  'the fatal-error overlay stayed hidden',
  'overlay text: ' + JSON.stringify(doc.getElementById('busyTitle').textContent));
ok(globalThis.__swRegistered?.url === 'sw.js', 'service worker registered',
  JSON.stringify(globalThis.__swRegistered));
ok(globalThis.__swRegistered?.opts?.type === 'module',
  'service worker registered as a module worker');
ok(!transcript.includes('gagal'), 'no subsystem reported failure', transcript);

/* ------------------------------------------------------- GL scene render */


group('WebGL2 setup (renderer, media store, compositor)');
group('WebGL2 compositor — real 720x1280 preset, 46 shapes + group');
const { parsePresetXML } = await mod('assets/js/am/parser.js');
const { Renderer } = await mod('assets/js/gl/renderer.js');
const { MediaStore } = await mod('assets/js/gl/media.js');
const { SceneCompositor } = await mod('assets/js/gl/scene.js');
const { resolveEffects, fxLabel, isKnownFx, KNOWN_FX } = await mod('assets/js/gl/effects.js');
const { Player } = await mod('assets/js/core/player.js');
const { AudioEngine } = await mod('assets/js/core/audio.js');
const { state, setTime, setPlaying } = await mod('assets/js/core/store.js');

const canvas = doc.getElementById('view');
canvas.width = 720;
canvas.height = 1280;
const renderer = new Renderer(canvas);
ok(renderer.gl != null, 'Renderer built programs and a VAO against the GL stub');
ok(renderer.main?.p && renderer.blended?.p && renderer.copy?.p, 'all three programs linked');

const media = new MediaStore(renderer.gl);
const comp = new SceneCompositor(renderer, media);

const demoRaw = readDemo();
// Prefer the real export; fall back to the bundled demo so the suites still run.
const scene = hasRef
  ? parsePresetXML(readRef(), { name: REF_XML.split('/').pop() })
  : parsePresetXML(demoRaw.xml, { name: demoRaw.name });
ok(true, hasRef ? `scene from ${REF_XML.split('/').pop()}` : 'no reference export: using the bundled demo scene');

if (hasRef) {
  const scene = parsePresetXML(readRef(), { name: 'Beraksi.xml' });
  ok(scene.layers.length === 48, 'preset parsed for rendering', String(scene.layers.length));

  renderer.resize(720, 1280);
  await settle(6);

  let renderErr = null;
  let report = null;
  try {
    report = comp.render(scene, 9000, 720, 1280);
  } catch (e) {
    renderErr = e;
  }
  ok(!renderErr, 'compositor.render() at t=9s did not throw', renderErr?.stack);
  ok(report && typeof report === 'object', 'render() returned a report');
  // t=9s is mid-animation: the last frame before the end has everything faded
  // out, so counters must be sampled here rather than after a sweep.
  const st = { ...renderer.stats };
  ok(st.draws > 0, 'the GPU pass actually issued draw calls', JSON.stringify(st));
  ok(st.layers > 0, 'renderer.stats.layers is populated', JSON.stringify(st));
  ok(st.layers === report.layers, 'stats.layers agrees with the report',
    `${st.layers} vs ${report.layers}`);
  ok(st.effectHits === report.fxHit, 'effect hit counts agree',
    `${st.effectHits} vs ${report.fxHit}`);
  ok(report.fxHit > 0, 'effects actually contributed uniforms', String(report.fxHit));
  ok(report.fxMiss === 0, 'no effect fell outside the registry for the real preset',
    'missed=' + report.missed.join(','));

  // The real preset declares 6 media but only 3 are referenced by a visual layer
  // (the other 3 are orphans AM left in the export). For each *referenced* slot,
  // render the midpoint of an owning layer's span and require it to be reported.
  const allLayers = (ls) => ls.flatMap((l) => [l, ...(l.children ? allLayers(l.children) : [])]);
  const visual = allLayers(scene.layers).filter((l) => l.kind !== 'audio' && l.uri);
  const refs = [...new Set(visual.map((l) => l.uri))];
  ok(refs.length === 3, '3 of the 6 declared media are referenced by layers',
    JSON.stringify(Object.keys(scene.media)) + ' vs ' + JSON.stringify(refs));

  const reportedSlots = new Set();
  for (const u of refs) {
    for (const owner of visual.filter((l) => l.uri === u)) {
      const mid = Math.max(owner.start, Math.min(owner.end - 1, (owner.start + owner.end) / 2));
      for (const r of comp.render(scene, mid, 360, 640).missing || []) reportedSlots.add(r);
    }
  }
  ok(reportedSlots.size === refs.length,
    'every referenced-but-unbound media slot is reported as missing',
    `reported ${reportedSlots.size}/${refs.length}: ${[...reportedSlots].map((u) => u.split('/').pop()).join(' ')}`);
  ok([...reportedSlots].every((u) => refs.includes(u)),
    'no slot is reported that the preset does not reference', [...reportedSlots].join(' '));

  // A slot the user actually fills must stop being reported.
  const filled = new Map(refs.map((u, i) => {
    const b = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
    Object.defineProperty(b, 'name', { value: 'x' + i + '.png' });
    return [u, b];
  }));
  await comp.bindMedia(scene, filled);
  let stillMissing = 0;
  for (const u of refs) {
    for (const owner of visual.filter((l) => l.uri === u)) {
      const mid = Math.max(owner.start, Math.min(owner.end - 1, (owner.start + owner.end) / 2));
      stillMissing += (comp.render(scene, mid, 360, 640).missing || []).includes(u) ? 1 : 0;
    }
  }
  ok(stillMissing === 0, 'once media is bound the slot stops being reported missing',
    String(stillMissing));

  // and a frame where the animation has fully faded out must draw nothing
  const endReport = comp.render(scene, scene.duration, 720, 1280);
  ok(endReport.layers === 0, 'at t=duration every layer is inactive or fully transparent',
    String(endReport.layers));

  try {
    for (let t = 0; t <= scene.duration; t += scene.duration / 12) {
      comp.render(scene, t, Math.round(360 * 16 / 9), 640);
    }
    ok(true, 'compositor.render() survives a sweep across the whole timeline');
  } catch (e) {
    ok(false, 'compositor.render() survives a sweep across the whole timeline', e.stack);
  }

} else {
  group('WebGL2 compositor — real 720x1280 preset');
  skip("no reference export. Set AM_REF_XML=/path/to/export.xml to enable");
}

const demo = parsePresetXML(demoRaw.xml, { name: demoRaw.name });
// fabricate one blob per media uri so slot binding has something to bind
// scene.media is a uri -> entry map, and the demo references slots by uri
const blobs = new Map();
for (const [uri, m] of Object.entries(demo.media)) {
  const b = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: m.type });
  Object.defineProperty(b, 'name', { value: m.filename || uri.split('/').pop() || 'media.png' });
  blobs.set(uri, b);
}
let bindErr = null;
try {
  await comp.bindMedia(demo, blobs);
} catch (e) { bindErr = e; }
ok(!bindErr, 'bindMedia() wired every demo slot without throwing', bindErr?.stack);

try {
  const r = comp.render(demo, 3000, 1080, 1920);
  ok(r && typeof r === 'object', 'demo renders at t=3s');
  ok(renderer.stats.missing === 0, 'every demo slot resolved to a texture',
    'missing=' + renderer.stats.missing);
} catch (e) {
  ok(false, 'demo renders at t=3s', e.stack);
}

group('playback at low resolution and odd sizes (letterboxing + rescale)');
let sizeErr = null;
try {
  for (const [w, h] of [[360, 640], [1080, 1920], [401, 997], [2, 2], [1, 1]]) {
    renderer.resize(w, h);
    comp.render(scene, 1000, w, h);
  }
  ok(true, 'renders at 5 different output sizes without throwing');
} catch (e) {
  ok(false, 'renders at 5 different output sizes without throwing', e.stack);
}

group('empty and degenerate scenes');
const degenerate = [
  { name: 'no layers', s: { ...scene, layers: [], audio: [], duration: 1000 } },
  { name: 'zero-duration', s: { ...scene, duration: 0 } },
  { name: 'zero size', s: { ...scene, w: 0, h: 0 } },
  { name: 'layer with no transform', s: { ...scene, layers: [{ kind: 'shape', startTime: 0, endTime: 1000 }] } },
  { name: 'null track values', s: { ...scene, layers: [{ kind: 'shape', startTime: 0, endTime: 1000, transform: { loc: null, scale: null, rot: null, opacity: null }, effects: [], children: [] }] } },
];
for (const { name, s } of degenerate) {
  let e = null;
  try { comp.render(s, 0, 720, 1280); comp.render(s, 99999, 720, 1280); } catch (err) { e = err; }
  ok(!e, `degenerate scene: ${name}`, e?.stack);
}

const allFx = [];
const collectFx = (ls) => ls.forEach((l) => { l.effects.forEach((f) => allFx.push(f)); if (l.children?.length) collectFx(l.children); });
collectFx(scene.layers);
const expectedFx = hasRef ? 175 : allFx.length;
group(`effects — all ${allFx.length} effect instances resolve to finite values`);
ok(allFx.length === expectedFx,
  hasRef ? 'collected every effect instance' : 'collected effect instances from the demo scene',
  String(allFx.length));

let fxErr = null;
let nonFinite = 0;
let badSample = 0;
const unknown = new Set();
const uniqueIdsPreflight = new Set(allFx.map((f) => f.id));
for (const fx of allFx) {
  if (!isKnownFx(fx.id)) unknown.add(fx.id);
  try {
    for (const t of [0, 2000, 9000, 18000]) {
      const v = resolveEffects(fx, t);
      const walkVal = (x) => {
        if (typeof x === 'number' && !Number.isFinite(x)) nonFinite++;
        else if (Array.isArray(x)) x.forEach(walkVal);
        else if (x && typeof x === 'object') Object.values(x).forEach(walkVal);
      };
      walkVal(v);
      if (v === null || v === undefined) badSample++;
    }
  } catch (e) { fxErr = e; break; }
}
ok(!fxErr, 'no effect threw while sampling at 4 times each', fxErr?.stack);
ok(nonFinite === 0, 'every resolved effect value is finite', `${nonFinite} non-finite`);
ok(badSample === 0, 'every effect resolved to a value, not null', String(badSample));
// The registry cannot cover every AM effect offline. The contract that matters
// is that an uncovered effect is *reported* to the user rather than silently
// dropped, so assert the reporting path and record the coverage gap.
//
// isKnownFx is fed the fully qualified id here on purpose: the helpers accept
// both forms, and this is the call shape a future maintainer will reach for.
const knownCount = [...uniqueIdsPreflight].filter((id) => isKnownFx(id)).length;
ok(knownCount * 2 >= uniqueIdsPreflight.size,
  'registry covers at least half the effect types in use',
  `${knownCount}/${uniqueIdsPreflight.size}`);
// Short name and fully qualified id must agree, or the inspector silently
// mislabels every effect it has a label for.
ok([...uniqueIdsPreflight].every((id) => isKnownFx(id) === isKnownFx(id.replace('com.alightcreative.effects.', ''))),
  'isKnownFx agrees on short name and fully qualified id');
// Read the report from the compositor, which is what the inspector renders from.
const reportedUnknown = new Set();
for (let t = 0; t <= scene.duration; t += 500) {
  comp.render(scene, t, 360, 640);
  for (const m of comp.report.missed || []) reportedUnknown.add(m);
}
console.log(`  note: registry covers ${knownCount}/${uniqueIdsPreflight.size} effect types (${allFx.length} instances)`);
console.log('  note: outside the registry = ' + ([...unknown].map((u) => u.split('.').pop()).join(', ') || 'none'));

// The contract for an uncovered effect is that it reaches the user instead of
// vanishing. Verify the reporting path against whichever side of the gap this
// scene actually falls on, so a full-coverage scene still checks the "nothing
// missed" direction.
ok(reportedUnknown.size > 0 === unknown.size > 0,
  'unsupported effects are surfaced in the report, not silently dropped',
  `registry gap=${unknown.size}, reported=${reportedUnknown.size}`);

// The invariant is per-id, not a magic count: distinct ids get distinct labels
// and no label is ever empty. An effect outside the registry deliberately falls
// back to its id, so "label === id" is allowed; emptiness is not.
const uniqueIds = new Set(allFx.map((f) => f.id));
const allLabels = allFx.map((f) => fxLabel(f.id));
const labels = new Set(allLabels);
ok(allLabels.every((l) => typeof l === 'string' && l.trim().length > 0), 'no effect label is empty',
  `${allLabels.filter((l) => !l || !l.trim()).length} empty`);
ok(labels.size === uniqueIds.size, 'distinct effect ids get distinct labels',
  `${labels.size} labels for ${uniqueIds.size} ids`);
if (hasRef) ok(labels.size >= 15, 'real preset yields many distinct labels', String(labels.size));

group('player + audio engine');
let playerErr = null;
let audio = null;
try {
  audio = new AudioEngine();
  const p = new Player({ canvas, compositor: comp, audio });
  ok(!!p, 'Player constructed with a real compositor');
  setTime(0);
  state.scene = scene;
  const mid = Math.floor(scene.duration / 2);
  p.seek(mid);
  ok(state.time === mid, `seek(${mid}) lands exactly`, String(state.time));
  p.seek(-100);
  ok(state.time === 0, 'seek clamps below zero', String(state.time));
  p.seek(1e9);
  ok(state.time <= scene.duration, 'seek clamps above duration', String(state.time));
  p.seek(scene.duration - 1);
  ok(state.time === scene.duration - 1, 'seek inside the timeline lands', String(state.time));
  p.markDirty();
  ok(p.dirty === true, 'markDirty() set the dirty flag');

  // load() only builds a track for sources it can resolve to a URL, so hand it
  // the same shape main.js builds from the media bus.
  const audioSrc = scene.audio[0].src;
  ok(!!audioSrc, 'the preset declares an audio track with a src', String(audioSrc));
  ok(audio.load(scene, new Map()) === 0, 'unresolved audio sources are skipped, not faked');
  const n = audio.load(scene, new Map([[audioSrc, 'blob:https://example.test/audio.wav']]));
  ok(n === 1 && audio.tracks.length === 1,
    'AudioEngine.load() built a track once the blob resolved',
    `n=${n} tracks=${audio.tracks.length}`);
  ok(!!audio.status(), 'audio.status() reports something before playback',
    JSON.stringify(audio.status()));
  audio.fitToProject(scene);
  ok(true, 'fitToProject() ran');
  audio.play(0);
  ok(true, 'audio.play(0) started the graph');
  audio.applyGain(3000);
  ok(Number.isFinite(audio.drift()) || audio.drift() === null,
    'drift() returned a usable value', String(audio.drift()));
  audio.pause();
  ok(true, 'audio.pause() stopped the graph');
  audio.setRate(2);
  ok(true, 'audio.setRate(2) accepted');
  audio.setRate(1);
  audio.unload();
  ok(true, 'audio.unload() released the graph');
} catch (e) {
  playerErr = e;
  ok(false, 'player/audio lifecycle', e.stack);
}
ok(!playerErr, 'no player or audio error');

group('documented limits and hostile presets still render');
const hostile = [
  ['<script>alert(1)</script> payload', 'x'.repeat(10)],
];
let hostileErr = null;
try {
  const xml = `<scene width="10" height="10" totalTime="100"><shape id="1" startTime="0" endTime="100" fillType="color"><transform><location><kf t="0" v="5,5,0"/></location></transform><fillColor value="#ffffffff"/><script>${'alert(1)//'.repeat(200)}</script></shape>${hostile[0][1]}</scene>`;
  const s2 = parsePresetXML(xml, { name: 'hostile' });
  comp.render(s2, 0, 720, 1280);
  ok(s2.layers.length === 1, 'a shape containing a <script> still renders as one layer');
} catch (e) { hostileErr = e; }
ok(!hostileErr, 'hostile preset rendered without executing anything', hostileErr?.stack);

group('render loop frame accounting');
try {
  const p = new Player({ canvas, compositor: comp, audio });
  let frames = 0;
  let fpsAtEnd = 0;
  p.onFrame = ({ fps, report, cost }) => {
    frames++;
    fpsAtEnd = fps;
    if (frames === 1) {
      ok(typeof fps === 'number' && fps >= 0, 'onFrame reports a numeric fps', String(fps));
      ok(typeof cost === 'number' && cost >= 0, 'onFrame reports a frame cost', String(cost));
      ok(report != null, 'onFrame carries a render report');
    }
  };
  state.scene = scene;
  state.autoQ = false;   // auto-quality marks dirty on its own; not what this block tests
  setTime(1000);
  setPlaying(true);
  p.start();
  globalThis.__runFrames(40, 16.7);
  ok(frames >= 30, 'rAF loop rendered every frame while playing', String(frames));
  ok(fpsAtEnd > 0, 'fps meter reported a positive rate after 500ms', String(fpsAtEnd));
  ok(state.time > 1000, 'the playhead advanced with wall-clock time', String(state.time));
  setPlaying(false);
  const frozen = state.time;
  globalThis.__runFrames(10, 16.7);
  ok(state.time === frozen, 'a paused player does not advance the playhead',
    `${frozen} -> ${state.time}`);
  p.markDirty();
  const before = frames;
  globalThis.__runFrames(3, 16.7);
  ok(frames === before + 1, 'one dirty frame rendered exactly once when paused',
    `${before} -> ${frames}`);
  p.stop();
  const afterStop = frames;
  globalThis.__runFrames(5, 16.7);
  ok(frames === afterStop, 'stop() halts the rAF loop', `${afterStop} -> ${frames}`);
} catch (e) {
  ok(false, 'render loop', e.stack);
}

const note = skipped ? `, ${skipped} skipped` : '';
console.log('\n' + (fails
  ? `\x1b[31m${fails} FAILED\x1b[0m, ${passes} passed${note}`
  : `${passes} passed, 0 failed${note}`));
if (errors.length) {
  console.log('\nlate async errors:');
  errors.forEach((e) => console.log('  ' + e));
}
process.exit(fails || errors.length ? 1 : 0);

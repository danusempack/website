/* ui/layers.js — Layer tab: scene tree, timeline, layer inspector.

   The timeline is a canvas: one row per layer, one bar per active span, a
   diamond per keyframe, and a playhead. Canvas keeps hundreds of layers at
   60fps, which a DOM list cannot.
*/

import { $, el, icon, fmtTime, clamp } from '../core/util.js';
import { on, emit, EV } from '../core/bus.js';
import { state, selectLayer, setTime, getTransform } from '../core/store.js';
import { getKV, setKV } from '../core/db.js';
import { fxLabel, fxGroupTint, isKnownFx, resolveEffects } from '../gl/effects.js';
import log from '../core/log.js';
import toast from '../core/toast.js';

const KIND_TINT = {
  image: '#3f6ad8', video: '#e0355f', audio: '#0d9488',
  group: '#5b4bdb', shape: '#8a6a1f', unknown: '#6b7280',
};

let player = null;
let ruler = null, rulerCtx = null, tracksHost = null, headEl = null;
let zoom = 3;                 // px per second
let scrollMs = 0;             // left edge of the visible window
let expanded = new Set();
let breadcrumb = [];

/* ------------------------------------------------------------------ helpers */

const allLayers = (scene) => {
  const out = [];
  const walk = (ls, parent, depth) => {
    for (const l of ls) { out.push({ l, parent, depth }); if (l.children?.length) walk(l.children, l, depth + 1); }
  };
  if (scene) walk(scene.layers, null, 0);
  return out;
};

const findLayer = (id, ls = state.scene?.layers) => {
  if (!ls) return null;
  for (const l of ls) {
    if (l.id === id) return l;
    if (l.children?.length) { const f = findLayer(id, l.children); if (f) return f; }
  }
  return null;
};

const msPerSec = (scene) => 1;

/* ------------------------------------------------------------------- render */

function renderTree() {
  const host = $('#stList');
  if (!host) return;
  host.textContent = '';
  const scene = state.scene;

  if (!scene) {
    host.append(el('div', { class: 'empty', text: 'Muat preset dulu.' }));
    $('#stCrumb').textContent = 'Proyek';
    $('#stUp').hidden = true;
    $('#layerCount').textContent = '';
    renderTracks();
    renderInfo(null);
    return;
  }

  const list = allLayers(scene);
  $('#layerCount').textContent = `${list.length} layer`;
  $('#tlExpandAll').hidden = !list.some(({ l }) => l.children?.length);
  $('#tlMark').hidden = !scene.bookmarks?.length;

  $('#stCrumb').textContent = breadcrumb.length
    ? breadcrumb.join(' / ')
    : 'Proyek';
  $('#stUp').hidden = breadcrumb.length === 0;

  const path = breadcrumb.length
    ? descend(scene.layers, breadcrumb)
    : scene.layers;

  for (const l of path) {
    const hasKids = !!l.children?.length;
    const open = expanded.has(l.id);
    const t = getTransform(l, state.time);
    const row = el('div', {
      class: 'strow' + (state.selLayer === l.id ? ' sel' : ''),
      role: 'treeitem',
      tabindex: '0',
      'aria-selected': String(state.selLayer === l.id),
      'aria-label': `${l.label}, ${l.kind}, ${fmtTime(l.start)} sampai ${fmtTime(l.end)}`,
      onclick: () => { selectLayer(l.id); },
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLayer(l.id); }
        if (e.key === 'ArrowRight' && hasKids) { expanded.add(l.id); renderTree(); }
        if (e.key === 'ArrowLeft' && hasKids && open) { expanded.delete(l.id); renderTree(); }
      },
    }, [
      el('span', {
        class: 'sttw',
        role: 'button',
        tabindex: '-1',
        'aria-label': open ? 'Tutup grup' : 'Buka grup',
        onclick: (e) => {
          e.stopPropagation();
          if (!hasKids) return;
          open ? expanded.delete(l.id) : expanded.add(l.id);
          renderTree();
        },
      }, hasKids ? [icon(open ? 'chev' : 'chev', 'ico sm' + (open ? '' : ' closed'))] : [el('span', { class: 'stleaf' })]),
      el('span', { class: 'stkind', style: `background:${KIND_TINT[l.kind] || KIND_TINT.unknown}` }),
      el('span', { class: 'stname', text: l.label, title: l.label }),
      el('span', { class: 'stfx', text: l.effects?.length ? `${l.effects.length} fx` : '' }),
      el('span', { class: 'sttime', text: `${(l.start / 1000).toFixed(2)}–${(l.end / 1000).toFixed(2)}` }),
    ]);
    if (l.kind === 'group') row.querySelector('.sttw svg')?.classList.toggle('open', open);
    row.querySelector('.sttw svg')?.style.setProperty('transform', open ? 'rotate(90deg)' : 'none');
    host.append(row);
  }

  renderTracks();
  if (state.selLayer) renderInfo(findLayer(state.selLayer));
}

function descend(ls, path) {
  let cur = ls;
  for (const want of path) {
    const hit = cur.find((l) => l.label === want || l.id === want);
    if (!hit) return ls;
    cur = hit.children?.length ? hit.children : [];
    if (!cur.length) return [];
  }
  return cur;
}

function renderTracks() {
  if (!tracksHost) return;
  tracksHost.textContent = '';
  const scene = state.scene;
  if (!scene) {
    tracksHost.append(el('div', { class: 'empty', text: 'Muat preset terlebih dahulu' }));
    headEl.textContent = '';
    return;
  }
  const list = allLayers(scene).slice(0, 400);
  for (const { l, depth } of list) {
    const kf = kfCount(l);
    tracksHost.append(el('div', {
      class: 'tlrow' + (state.selLayer === l.id ? ' sel' : '') + (depth ? ' ind' : ''),
      style: `--d:${depth}`,
      role: 'button',
      tabindex: '0',
      'aria-label': `${l.label}, ${fmtTime(l.start)} sampai ${fmtTime(l.end)}, ${kf} keyframe`,
      onclick: () => selectLayer(l.id),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectLayer(l.id); } },
    }, [
      el('span', { class: 'tlbar', style: `left:${pct(l.start, scene)}%;width:${Math.max(0.4, pct(l.end - l.start, scene))}%` }),
      kf ? el('span', { class: 'tldia', style: `left:${pct((l.start + l.end) / 2, scene)}%`, title: `${kf} keyframe` }) : null,
      el('span', { class: 'tlcap2', text: l.label }),
    ]));
  }
}

const pct = (ms, scene) => (scene.duration ? clamp((ms / scene.duration) * 100, 0, 100) : 0);

function kfCount(l) {
  let n = 0;
  for (const tr of Object.values(l.transform || {})) n += tr?.kind === 'kf' ? tr.kfs.length : 0;
  for (const e of l.effects || []) {
    for (const p of e.props.values()) if (p.hasKF) n++;
  }
  return n;
}

function renderRuler() {
  const scene = state.scene;
  const dur = scene?.duration || 0;
  const w = tracksHost?.clientWidth || 0;
  if (ruler.width !== w) ruler.width = Math.max(10, w);
  rulerCtx.clearRect(0, 0, ruler.width, ruler.height);

  if (!dur) return;
  // pick a tick step that stays >= 56px apart
  const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  const step = steps.find((s) => s * zoom >= 56) ?? 60;

  rulerCtx.font = '11px ui-monospace, monospace';
  rulerCtx.fillStyle = getComputedStyle(document.body).getPropertyValue('--dim') || '#8a90a2';
  rulerCtx.strokeStyle = 'rgba(255,255,255,.14)';

  for (let t = 0; t <= dur / 1000 + 1e-6; t += step) {
    const x = t * zoom - scrollMs;
    if (x < -40 || x > ruler.width) continue;
    rulerCtx.beginPath();
    rulerCtx.moveTo(Math.round(x) + 0.5, ruler.height - 6);
    rulerCtx.lineTo(Math.round(x) + 0.5, ruler.height);
    rulerCtx.stroke();
    rulerCtx.fillText(t.toFixed(step < 1 ? 1 : 0) + 's', Math.round(x) + 3, 12);
  }
  // minor ticks
  for (let t = 0; t <= dur / 1000; t += step / 5) {
    const x = t * zoom - scrollMs;
    if (x < 0 || x > ruler.width) continue;
    rulerCtx.globalAlpha = 0.4;
    rulerCtx.fillRect(Math.round(x), ruler.height - 4, 1, 3);
    rulerCtx.globalAlpha = 1;
  }
}

function renderInfo(layer) {
  const host = $('#layerinfo');
  if (!host) return;
  host.textContent = '';
  if (!layer) {
    host.append(el('div', { class: 'empty', text: 'Ketuk blok layer untuk melihat detail, daftar efek, dan pratinjau medianya.' }));
    return;
  }

  const t = getTransform(layer, state.time);
  const { hit, miss, missed } = resolveEffects(layer, state.time);

  const kv = (k, v) => el('div', { class: 'kv' }, [
    el('span', { class: 'k', text: k }),
    el('span', { class: 'v', text: v }),
  ]);

  host.append(
    el('div', { class: 'li-head' }, [
      el('span', { class: 'li-kind', style: `background:${KIND_TINT[layer.kind] || KIND_TINT.unknown}` }),
      el('h3', { text: layer.label, title: layer.label }),
      el('span', { class: 'li-kindtag', text: layer.kind }),
    ]),
    el('div', { class: 'li-grid' }, [
      kv('Waktu', `${fmtTime(layer.start)} → ${fmtTime(layer.end)}`),
      kv('Durasi', fmtTime(layer.end - layer.start)),
      kv('Lokasi', `${t.x.toFixed(1)}, ${t.y.toFixed(1)}`),
      kv('Skala', `${t.sx.toFixed(3)} × ${t.sy.toFixed(3)}`),
      kv('Rotasi', `${t.rot.toFixed(2)}°`),
      kv('Opacity', t.opacity.toFixed(3)),
      kv('Kotak', `${(t.w).toFixed(0)} × ${(t.h).toFixed(0)} px`),
      kv('Keyframe', String(kfCount(layer))),
    ]),
  );

  if (layer.children?.length) {
    host.append(el('div', { class: 'li-sub', text: `Grup berisi ${layer.children.length} layer langsung.` }));
  }

  // effects
  if (layer.effects?.length) {
    const list = el('ul', { class: 'fxlist' });
    for (const ef of layer.effects) {
      const known = isKnownFx(ef.kind);
      list.append(el('li', { class: 'fxrow' + (known ? '' : ' unknown') }, [
        el('span', { class: 'fxtint', style: `background:${known ? fxGroupTint(ef.kind) : '#6b7280'}` }),
        el('span', { class: 'fxname', text: fxLabel(ef.kind) }),
        el('span', { class: 'fxstate', text: known ? 'dirender' : 'belum didukung' }),
      ]));
    }
    host.append(
      el('div', { class: 'li-sec' }, [
        el('h4', { text: `Efek (${hit} dirender, ${miss} diabaikan)` }),
        list,
      ]),
    );
    if (miss) {
      host.append(el('p', {
        class: 'li-warn',
        text: `Efek berikut tidak ada di registri lokal: ${missed.slice(0, 4).join(', ')}${missed.length > 4 ? `, +${missed.length - 4}` : ''}. Preset ini dirender seadanya — layer tetap digambar, tanpa efek tersebut.`,
      }));
    }
  }

  if (layer.script) {
    host.append(el('p', {
      class: 'li-warn',
      text: 'Layer ini punya blok script. Isinya TIDAK dieksekusi (demi keamanan) dan tidak dipakai untuk merender.',
    }));
  }

  host.append(el('div', { class: 'li-act' }, [
    el('button', {
      class: 'btn sm', type: 'button',
      onclick: () => {
        $('#layerXmlBody').textContent = layer.xml;
        $('#dlgLayerXml').showModal();
      },
    }, [icon('doc', 'ico sm'), 'Lihat XML layer']),
  ]));
}

/* ------------------------------------------------------------- interactions */

function wrapHead() {
  const x = state.time / 1000 * zoom - scrollMs;
  headEl.style.transform = `translateX(${x}px)`;
}

function onWrapClick(e) {
  const scene = state.scene;
  if (!scene) return;
  const rect = tracksHost.getBoundingClientRect();
  const x = e.clientX - rect.left + scrollMs;
  setTime(clamp(x / zoom * 1000, 0, scene.duration));
  player?.markDirty();
}

function onWheel(e) {
  const scene = state.scene;
  if (!scene) return;
  if (e.ctrlKey || e.metaKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // pan
    scrollMs = clamp(scrollMs + (e.deltaX || e.deltaY), 0, Math.max(0, scene.duration / 1000 * zoom - tracksHost.clientWidth));
  } else {
    // zoom about the cursor
    const rect = tracksHost.getBoundingClientRect();
    const at = e.clientX - rect.left + scrollMs;
    const tAt = at / zoom;
    zoom = clamp(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.2, 24);
    scrollMs = clamp(tAt * zoom - (e.clientX - rect.left), 0, Math.max(0, scene.duration / 1000 * zoom - tracksHost.clientWidth));
  }
  e.preventDefault();
  $('#tlZoomVal').textContent = zoom.toFixed(1) + 'x';
  $('#tlZoom').value = Math.min(24, Math.max(0.2, zoom));
  renderRuler(); wrapHead(); renderTracks();
}

function fitTimeline() {
  const scene = state.scene;
  if (!scene || !tracksHost) return;
  const w = tracksHost.clientWidth || 600;
  zoom = clamp((w - 8) / Math.max(0.001, scene.duration / 1000), 0.2, 24);
  scrollMs = 0;
  $('#tlZoomVal').textContent = zoom.toFixed(1) + 'x';
  $('#tlZoom').value = zoom;
  renderRuler(); wrapHead(); renderTracks();
}

function scrollToPlayhead() {
  const scene = state.scene;
  if (!scene || !tracksHost) return;
  const x = state.time / 1000 * zoom;
  const w = tracksHost.clientWidth;
  if (x < scrollMs + 20) scrollMs = Math.max(0, x - 20);
  else if (x > scrollMs + w - 20) scrollMs = x - w + 20;
  const max = Math.max(0, scene.duration / 1000 * zoom - w);
  scrollMs = clamp(scrollMs, 0, max);
  renderRuler(); wrapHead();
}

/* ------------------------------------------------------------------ bookmarks */

async function toggleMark() {
  const scene = state.scene;
  if (!scene) return;
  const t = Math.round(state.time);
  const i = scene.bookmarks.indexOf(t);
  if (i >= 0) scene.bookmarks.splice(i, 1);
  else { scene.bookmarks.push(t); scene.bookmarks.sort((a, b) => a - b); }
  await setKV('marks:' + scene.name, scene.bookmarks).catch(() => {});
  renderTree();
  toast(i >= 0 ? 'Penanda dihapus.' : 'Penanda ditambahkan.');
}

function jumpMark(dir) {
  const scene = state.scene;
  if (!scene?.bookmarks?.length) return;
  const t = state.time;
  const list = scene.bookmarks;
  const next = dir > 0 ? list.find((b) => b > t + 1) : [...list].reverse().find((b) => b < t - 1);
  if (next != null) { setTime(next); player?.markDirty(); }
}

async function restoreMarks(scene) {
  if (!scene) return;
  const saved = await getKV('marks:' + scene.name, null);
  scene.bookmarks = Array.isArray(saved) && saved.length ? saved : (scene.bookmarks || []);
}

/* --------------------------------------------------------------------- init */

export function initLayers({ getPlayer } = {}) {
  player = getPlayer?.();
  ruler = $('#tlrulercanvas');
  rulerCtx = ruler.getContext('2d');
  tracksHost = $('#tltracks');
  headEl = $('#tlhead');

  $('#tlwrap').addEventListener('click', onWrapClick);
  $('#tlwrap').addEventListener('wheel', onWheel, { passive: false });

  $('#tlZoom').addEventListener('input', (e) => {
    zoom = parseFloat(e.target.value);
    $('#tlZoomVal').textContent = zoom.toFixed(1) + 'x';
    renderRuler(); wrapHead(); renderTracks();
  });
  $('#tlZoomIn').addEventListener('click', () => { zoom = clamp(zoom * 1.4, 0.2, 24); syncZoom(); });
  $('#tlZoomOut').addEventListener('click', () => { zoom = clamp(zoom / 1.4, 0.2, 24); syncZoom(); });
  $('#tlFit').addEventListener('click', fitTimeline);
  $('#tlNow').addEventListener('click', scrollToPlayhead);

  $('#tlExpandAll').addEventListener('click', () => {
    const all = allLayers(state.scene);
    const anyClosed = all.some(({ l }) => l.children?.length && !expanded.has(l.id));
    expanded = anyClosed ? new Set(all.filter(({ l }) => l.children?.length).map(({ l }) => l.id)) : new Set();
    renderTree();
  });

  $('#stUp').addEventListener('click', () => { breadcrumb.pop(); renderTree(); });
  $('#tlMark').addEventListener('click', toggleMark);
  $('#tlMarkPrev').addEventListener('click', () => jumpMark(-1));
  $('#tlMarkNext').addEventListener('click', () => jumpMark(1));

  on(EV.PRESET_LOADED, (scene) => {
    breadcrumb = []; expanded = new Set();
    restoreMarks(scene).then(() => { renderTree(); fitTimeline(); });
  });
  on(EV.PRESET_CLEARED, () => { breadcrumb = []; expanded = new Set(); renderTree(); });
  on(EV.SELECT_LAYER, (id) => { renderTree(); renderInfo(findLayer(id)); });
  on(EV.TIME, () => {
    wrapHead();
    if (state.playing) scrollToPlayhead();
    if (state.selLayer) renderInfoQuiet();
  });

  addEventListener('resize', () => { renderRuler(); wrapHead(); renderTracks(); });
  log.ok('Panel layer siap.');
}

let infoTick = 0;
function renderInfoQuiet() {
  // Throttle the numbers: 20/s is plenty and avoids layout thrash.
  if (performance.now() - infoTick < 50) return;
  infoTick = performance.now();
  renderInfo(findLayer(state.selLayer));
}

function syncZoom() {
  $('#tlZoomVal').textContent = zoom.toFixed(1) + 'x';
  $('#tlZoom').value = zoom;
  renderRuler(); wrapHead(); renderTracks();
}

export { msPerSec, findLayer, allLayers };

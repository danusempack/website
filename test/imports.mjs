import fs from 'node:fs';
import path from 'node:path';

import { ROOT, ASSETS, INDEX_HTML } from './paths.mjs';

const JS = path.join(ASSETS, 'js');

let fails = 0;
const fail = (m) => { console.log('  FAIL ' + m); fails++; };
const pass = (m) => console.log('  PASS ' + m);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

/** Strip comments only. Deliberately does NOT strip strings or template
 *  literals: an unbalanced backtick or a `${...}` containing a brace made an
 *  earlier string-stripping regex swallow whole regions of real code (it ate
 *  the `export function initMedia` line in media.js). Comments are the only
 *  place a line-anchored `^\s*export` realistically appears falsely. */
const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1 ');

/** Collect exported binding names from source, without executing it. */
function exportsOf(src) {
  const names = new Set();
  let hasDefault = false;
  let hasStar = false;
  const clean = stripComments(src);

  for (const m of clean.matchAll(/^\s*export\s+default\b/gm)) hasDefault = true;
  for (const m of clean.matchAll(/^\s*export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of clean.matchAll(/^\s*export\s+(?:class)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of clean.matchAll(/^\s*export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);

  // export { a, b as c }
  for (const m of clean.matchAll(/^\s*export\s*\{([^}]*)\}/gm)) {
    for (let part of m[1].split(',')) {
      part = part.trim();
      if (!part) continue;
      const as = part.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  // export * from './x.js'
  if (/^\s*export\s+\*\s+from/gm.test(clean)) hasStar = true;

  return { names, hasDefault, hasStar };
}

/** Collect (source, importedNames) for every static import in src. */
function importsOf(src) {
  const out = [];
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const re = /import\s+(?:([\s\S]*?)\s+from\s+)?['"]([^'"]+)['"]/g;
  for (const m of clean.matchAll(re)) {
    const clause = (m[1] || '').trim();
    const spec = m[2];
    const rec = { spec, names: [], def: false, ns: false };
    if (/^\*\s+as\s+/.test(clause)) rec.ns = true;
    const braced = clause.match(/\{([\s\S]*)\}/);
    if (braced) {
      for (let part of braced[1].split(',')) {
        part = part.trim();
        if (!part) continue;
        rec.names.push(part.split(/\s+as\s+/)[0].trim());
      }
    }
    if (/^[A-Za-z_$][\w$]*\s*(,|$)/.test(clause) && !clause.startsWith('{') && !clause.startsWith('*')) {
      rec.def = true;
    }
    out.push(rec);
  }
  // dynamic import('...')
  for (const m of clean.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push({ spec: m[1], names: [], def: false, ns: false, dynamic: true });
  }
  return out;
}

const files = walk(JS);
const cache = new Map();
function resolve(from, spec) {
  if (!spec.startsWith('.')) return { external: true };
  const p = path.resolve(path.dirname(from), spec);
  if (!fs.existsSync(p)) return { missing: true };
  if (!cache.has(p)) cache.set(p, exportsOf(fs.readFileSync(p, 'utf8')));
  return { path: p, exp: cache.get(p) };
}

console.log('\n[1] every static import resolves to a real file');
let bad = 0;
for (const f of files) {
  for (const imp of importsOf(fs.readFileSync(f, 'utf8'))) {
    if (imp.spec.startsWith('.') && imp.spec.endsWith('.js')) {
      const r = resolve(f, imp.spec);
      if (r.missing) { fail(`${path.relative(ROOT, f)} -> ${imp.spec} (no such file)`); bad++; }
    } else if (!imp.spec.startsWith('.')) {
      const allowed = imp.spec.startsWith('node:') || imp.spec.startsWith('data:') || imp.spec.startsWith('blob:');
      if (!allowed) { fail(`${path.relative(ROOT, f)} imports bare specifier "${imp.spec}"`); bad++; }
    }
  }
}
if (!bad) pass(`${files.length} modules, all relative specifiers resolve, no bare/bundler specifiers`);

console.log('\n[2] every named import is actually exported by its target');
bad = 0;
let checked = 0;
for (const f of files) {
  for (const imp of importsOf(fs.readFileSync(f, 'utf8'))) {
    const r = resolve(f, imp.spec);
    if (r.missing || r.external) continue;
    if (imp.ns || imp.dynamic) continue;
    for (const n of imp.names) {
      checked++;
      if (!r.exp.names.has(n) && !r.exp.hasStar) {
        fail(`${path.relative(ROOT, f)}: { ${n} } not exported by ${path.relative(ROOT, r.path)}`);
        bad++;
      }
    }
    if (imp.def) {
      checked++;
      if (!r.exp.hasDefault) {
        fail(`${path.relative(ROOT, f)}: default import from ${path.relative(ROOT, r.path)} but it has no default export`);
        bad++;
      }
    }
  }
}
if (!bad) pass(`${checked} bindings checked, all present`);

console.log('\n[3] index.html script/preload graph');
const html = INDEX_HTML;
bad = 0;
const htmlRefs = [...html.matchAll(/(?:src|href)="([^"#][^"]*)"/g)]
  .map((m) => m[1])
  .filter((u) => !/^(https?:|data:|mailto:|#|\/\/)/.test(u));
for (const u of new Set(htmlRefs)) {
  const p = path.join(ROOT, u.split('?')[0].split('#')[0]);
  if (!fs.existsSync(p)) { fail(`index.html references missing ${u}`); bad++; }
}
if (!bad) pass(`${new Set(htmlRefs).size} local refs in index.html all exist`);

console.log('\n[4] service worker precache list');
bad = 0;
// root sw.js is a 1-line re-export; the SHELL list lives in core/sw.js
const swSrc = fs.readFileSync(path.join(JS, 'core', 'sw.js'), 'utf8');
const shellBlock = swSrc.slice(swSrc.indexOf('SHELL'), swSrc.indexOf('];', swSrc.indexOf('SHELL')));
const precached = new Set([...shellBlock.matchAll(/'([^']+)'/g)].map((m) => m[1]));
for (const u of precached) {
  if (!fs.existsSync(path.join(ROOT, u))) { fail(`core/sw.js precaches missing ${u}`); bad++; }
}
if (!/register\([^)]*type:\s*'module'/.test(swSrc)) fail('sw.js is not registered with { type: "module" }');
else pass('root sw.js registered as a module worker');
if (!bad) pass(`all ${precached.size} precached files exist`);

console.log('\n[5] manifest icons');
bad = 0;
const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
const icons = [...(man.icons || []), ...(man.shortcuts || []).flatMap((s) => s.icons || [])];
for (const i of icons) {
  if (!fs.existsSync(path.join(ROOT, i.src))) { fail(`manifest icon missing ${i.src}`); bad++; }
}
if (!bad) pass(`${icons.length} manifest icons exist`);

console.log('\n[6] no executable-string sinks in shipped JS');
bad = 0;
const SINK = /\beval\s*\(|\bnew\s+Function\s*\(|\bsetTimeout\s*\(\s*['"`]|\bsetInterval\s*\(\s*['"`]/;
for (const f of files) {
  if (SINK.test(stripComments(fs.readFileSync(f, 'utf8')))) { fail(`${path.relative(ROOT, f)} uses an executable-string sink`); bad++; }
}
if (!bad) pass('no eval/new Function/string-timer in any module');

console.log('\n[7] template and event wiring has handlers');
bad = 0;
const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\$\('#([A-Za-z0-9_-]+)'\)/g)) {
    if (!ids.has(m[1])) { fail(`${path.relative(ROOT, f)} queries #${m[1]} which index.html lacks`); bad++; }
  }
  for (const m of src.matchAll(/getElementById\(\s*'([A-Za-z0-9_-]+)'\s*\)/g)) {
    if (!ids.has(m[1])) { fail(`${path.relative(ROOT, f)} getElementById('${m[1]}') not in index.html`); bad++; }
  }
}
if (!bad) pass(`all queried element ids exist (${ids.size} ids in index.html)`);

console.log('\n[8] every shipped module is precached by the service worker');
const shippedAbs = walk(JS);
const shipped = shippedAbs.map((f) => path.relative(ROOT, f));
const notCached = shipped.filter((f) => !precached.has(f));
for (const f of notCached) fail(`${f} is not in the precache list — offline boot would fail`);
if (!notCached.length) pass(`${shipped.length} modules, all in the precache list`);
for (const abs of shippedAbs) {
  const f = path.relative(ROOT, abs);
  if (!precached.has(f)) continue;
  const src = stripComments(fs.readFileSync(abs, 'utf8'));
  for (const m of src.matchAll(/from\s*['"](\.\.?\/[^'"]+)['"]/g)) {
    if (!m[1].startsWith('.')) continue;
    const dep = path.relative(ROOT, path.resolve(path.dirname(abs), m[1]));
    if (!precached.has(dep) && !notCached.includes(dep)) {
      fail(`${f} imports ${dep}, which is not precached`);
    }
  }
}

console.log('\n[9] every URL the page references resolves to a real file');
bad = 0;
const refs = new Set();
for (const m of html.matchAll(/(?:href|src)=["']([^"']+)["']/gi)) {
  const u = m[1];
  if (/^(?:https?:|data:|mailto:|#)/i.test(u)) continue;
  refs.add(u.replace(/^\.\//, '').split('#')[0] || 'index.html');
}
for (const m of stripComments(fs.readFileSync(path.join(JS, 'core', 'sw.js'), 'utf8'))
  .matchAll(/['"]([^'"]+\.(?:js|css|html|json|svg|webmanifest|png))['"]/g)) {
  refs.add(m[1].replace(/^\.\//, ''));
}
for (const r of [...refs].sort()) {
  if (!fs.existsSync(path.join(ROOT, r))) { fail(`${r} is referenced but missing`); bad++; }
}
if (!bad) pass(`${refs.size} referenced paths exist, so nothing 404s after deploy`);

console.log('\n[10] Content-Security-Policy is present and satisfiable');
bad = 0;
// The CSP value is double-quoted and full of single quotes, so the content
// capture must exclude only the double quote.
const cspTag = html.match(/<meta\s+http-equiv=["']Content-Security-Policy["']\s+content="([^"]+)"/i);
if (!cspTag) {
  fail('index.html has no parseable Content-Security-Policy meta tag');
} else {
  const dirs = {};
  for (const d of cspTag[1].split(';').map((x) => x.trim()).filter(Boolean)) {
    const sp = d.indexOf(' ');
    dirs[d.slice(0, sp < 0 ? d.length : sp)] = (sp < 0 ? '' : d.slice(sp + 1)).trim().split(/\s+/).filter(Boolean);
  }
  const has = (k, v) => Array.isArray(dirs[k]) && dirs[k].includes(v);

  if (!has('default-src', "'none'")) { fail("default-src is not 'none'"); bad++; }
  for (const need of ['script-src', 'style-src', 'img-src', 'media-src', 'connect-src',
    'worker-src', 'manifest-src', 'base-uri', 'object-src']) {
    if (!dirs[need]) { fail(`CSP is missing ${need}`); bad++; }
  }
  if (dirs['frame-ancestors']) {
    fail('frame-ancestors is ignored in a <meta> CSP and only logs a browser warning');
    bad++;
  } else pass('frame-ancestors omitted from <meta> (documented in README instead)');
  if (has('script-src', "'unsafe-inline'")) { fail("script-src allows 'unsafe-inline'"); bad++; }
  if (has('script-src', "'unsafe-eval'")) { fail("script-src allows 'unsafe-eval'"); bad++; }
  if (has('style-src', "'unsafe-inline'")) { fail("style-src allows 'unsafe-inline'"); bad++; }
  if (!bad) pass('no unsafe-inline and no unsafe-eval in script-src or style-src');
  if (has('object-src', "'none'") && has('base-uri', "'none'")) pass("object-src and base-uri are 'none'");
  else { fail("object-src and base-uri must be 'none'"); bad++; }
  // A strict connect-src would break the service worker; same-origin is enough.
  if (dirs['connect-src']?.some((v) => !v.startsWith("'self'") && !['blob:', 'data:'].includes(v))) {
    fail('connect-src grants a third-party origin'); bad++;
  } else pass('connect-src is same-origin only');
  if (!bad) pass(`CSP parsed: ${Object.keys(dirs).length} directives, all satisfiable by this page`);
}

// The strict script/style policy is only honest if the markup has nothing inline,
// and if no module can reintroduce an inline style at runtime.
bad = 0;
const tags = [...html.matchAll(/<[a-zA-Z][^>]*>/g)].map((m) => m[0]);
for (const t of tags) {
  if (/\son[a-z]+\s*=/i.test(t)) { fail(`inline event handler in markup: ${t.slice(0, 70)}`); bad++; }
  if (/\sstyle\s*=\s*"/i.test(t)) { fail(`style="" attribute in markup, which style-src self blocks: ${t.slice(0, 70)}`); bad++; }
  if (/^<style[\s>]/i.test(t)) { fail('inline <style> block in markup'); bad++; }
}
for (const m of html.matchAll(/<script([^>]*)>/gi)) {
  const attrs = m[1] || '';
  if (!/\ssrc\s*=/i.test(attrs)) { fail(`<script> without src: ${m[0].slice(0, 70)}`); bad++; }
  const end = html.indexOf('</script>', m.index);
  if (end > 0 && html.slice(m.index + m[0].length, end).trim()) { fail('<script> has an inline body'); bad++; }
}
if (!bad) pass('markup has no inline script body, event handler, <style> or style attribute');

bad = 0;
for (const f of walk(JS)) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  const rel = path.relative(ROOT, f);
  if (/setAttribute\(\s*['"`]style['"`]/.test(src)) { fail(`${rel} calls setAttribute('style')`); bad++; }
  if (/\.cssText\s*=/.test(src)) { fail(`${rel} assigns cssText`); bad++; }
  if (/insertAdjacentHTML/.test(src)) { fail(`${rel} uses insertAdjacentHTML`); bad++; }
}
if (!bad) pass('no module writes an inline style, so style-src self holds at runtime');

bad = 0;
for (const f of walk(JS)) {
  const src = stripComments(fs.readFileSync(f, 'utf8'));
  if (/\bfetch\(\s*['"`]https?:/.test(src)) { fail(`${path.relative(ROOT, f)} fetches an absolute remote URL`); bad++; }
  if (/new\s+WebSocket\(/.test(src)) { fail(`${path.relative(ROOT, f)} opens a WebSocket`); bad++; }
  if (/navigator\.sendBeacon/.test(src)) { fail(`${path.relative(ROOT, f)} uses sendBeacon`); bad++; }
  if (/XMLHttpRequest/.test(src)) { fail(`${path.relative(ROOT, f)} uses XMLHttpRequest`); bad++; }
}
if (!bad) pass('no module talks to a remote origin (no fetch/http, WebSocket, sendBeacon, XHR)');

console.log('\n' + (fails ? `\x1b[31m${fails} FAILED\x1b[0m` : 'all import/export checks passed'));
process.exit(fails ? 1 : 0);

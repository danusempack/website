/* Runs every suite and exits non-zero if anything fails.
 *
 *   node test/all.mjs
 *   AM_REF_XML=/path/to/real-export.xml node test/all.mjs
 *
 * The app itself is a static, build-free site; this needs nothing but Node
 * (tested on v20) and no dependencies.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { stageApp } from './paths.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const node = process.execPath;

const SUITES = [
  ['parser + easing', 'run.mjs'],
  ['import graph + CSP', 'imports.mjs'],
  ['runtime smoke', 'boot.mjs'],
];

/* A syntax error in any shipped module is a hard boot failure in a browser, and
 * it is the one thing a static import check cannot see.
 *
 * The check runs against the staged copy, not the repo: the site ships no
 * package.json, so `node --check` on a repo-relative .js would parse it as
 * CommonJS and reject every `export`. */
function syntaxCheck() {
  const { dir } = stageApp();
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) files.push(p);
    }
  };
  walk(path.join(dir, 'assets', 'js'));
  // The served entry point for the service worker is the root sw.js, not
  // assets/js/core/sw.js, so both need to parse.
  fs.copyFileSync(path.join(HERE, '..', 'sw.js'), path.join(dir, 'sw.js'));
  files.push(path.join(dir, 'sw.js'));

  const bad = [];
  for (const f of files) {
    const r = spawnSync(node, ['--check', f], { encoding: 'utf8' });
    if (r.status !== 0) {
      const msg = (r.stderr || '').split('\n').find((l) => /Error/.test(l)) || 'parse error';
      bad.push(`${path.relative(dir, f)}: ${msg.trim()}`);
    }
  }
  return { files, bad };
}

let failed = 0;

console.log('\x1b[1m== syntax ==\x1b[0m');
const { files, bad } = syntaxCheck();
if (bad.length) {
  failed++;
  bad.forEach((b) => console.log('  \x1b[31mFAIL\x1b[0m ' + b));
} else {
  console.log(`  \x1b[32mPASS\x1b[0m ${files.length} shipped modules parse as ESM`);
}

for (const [label, file] of SUITES) {
  console.log(`\n\x1b[1m== ${label} ==\x1b[0m`);
  const r = spawnSync(node, [path.join(HERE, file)], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed++;
    console.log(`  \x1b[31m== ${label} FAILED ==\x1b[0m`);
  }
}

console.log('');
if (failed) {
  console.log(`\x1b[31m${failed} of ${SUITES.length + 1} suite(s) failed\x1b[0m`);
  process.exit(1);
}
console.log(`\x1b[32mall ${SUITES.length + 1} suites passed\x1b[0m`);

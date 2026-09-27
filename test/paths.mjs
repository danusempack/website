/* Shared paths for the test suites.
 *
 * Tests run against the repository itself, so the location is derived from this
 * file rather than hard-coded.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ASSETS = path.join(ROOT, 'assets');
export const INDEX_HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/* A real Alight Motion export is the strongest fixture available, but it is not
 * ours to publish, so it is optional. Point AM_REF_XML at one, or drop it at
 * test/fixtures/Beraksi.xml. Suites that need it skip with a notice. */
const REF_CANDIDATES = [
  process.env.AM_REF_XML,
  path.join(ROOT, 'test', 'fixtures', 'Beraksi.xml'),
].filter(Boolean);

export const REF_XML = REF_CANDIDATES.find((p) => fs.existsSync(p)) || null;
export const hasRef = !!REF_XML;
export const readRef = () => fs.readFileSync(REF_XML, 'utf8');

/** Copy the app into a temp dir that has a module package.json, so Node treats
 *  the .js files as ESM exactly as a browser would. */
export function stageApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-test-'));
  fs.cpSync(ASSETS, path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
  return {
    dir,
    mod: (rel) => import('file://' + path.join(dir, rel)),
  };
}

export const demoRaw = () => JSON.parse(fs.readFileSync(path.join(ASSETS, 'data', 'demo.json'), 'utf8'));

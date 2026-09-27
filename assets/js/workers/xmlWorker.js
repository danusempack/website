/* workers/xmlWorker.js — parses presets off the main thread so a 30 MB XML
   never freezes the UI. Module worker so it can import ../am/parser.js.

   Protocol:  { id, xml, name }  ->  { id, ok:true, scene } | { id, ok:false, error, code }
*/

import { parsePresetXML, LIMITS } from '../am/parser.js';

self.onmessage = (ev) => {
  const { id, xml, name } = ev.data || {};
  try {
    const scene = parsePresetXML(xml, { name });
    self.postMessage({ id, ok: true, scene, limits: LIMITS });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      code: err?.code || 'PARSE_FAIL',
      error: err?.message || String(err),
    });
  }
};

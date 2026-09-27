/* Minimal XML DOM shim — TEST HARNESS ONLY, not shipped.
   Implements just enough of the DOM surface that assets/js/am/parser.js
   touches, so the real parser can be exercised in Node without a browser. */

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x?[0-9a-fA-F]+|\w+);/g, (m, g) => {
  if (g[0] === '#') {
    const code = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  }
  return ENT[g] ?? m;
});
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

class El {
  constructor(tag) {
    this.tagName = tag;
    this.attrs = new Map();
    this.childNodes = [];
  }
  get children() { return this.childNodes.filter((n) => n instanceof El); }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() {
    const p = this.parentNode;
    if (!p) return null;
    const sib = p.childNodes;
    const i = sib.indexOf(this);
    for (let j = i + 1; j < sib.length; j++) if (sib[j] instanceof El) return sib[j];
    return null;
  }
  get parentNode() { return this._parent || null; }
  set parentNode(v) { this._parent = v; }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  get textContent() { return this.childNodes.map((n) => (n instanceof El ? n.textContent : n.data)).join(''); }
  get outerHTML() {
    const a = [...this.attrs].map(([k, v]) => ` ${k}="${esc(v)}"`).join('');
    if (!this.childNodes.length) return `<${this.tagName}${a} />`;
    return `<${this.tagName}${a}>${this.childNodes.map((n) => (n instanceof El ? n.outerHTML : n.data)).join('')}</${this.tagName}>`;
  }
  getElementsByTagName(tag) {
    const out = [];
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (!(c instanceof El)) continue;
        if (c.tagName === tag) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  querySelector(sel) {
    return sel === 'parsererror' ? (this.getElementsByTagName('parsererror')[0] || null) : null;
  }
}

class Text { constructor(data) { this.data = data; } }

class Doc {
  constructor(root, err) {
    if (err) {
      // Real browsers surface XML errors as a <parsererror> ELEMENT INSIDE the
      // document, not as the documentElement — mirror that so querySelector
      // finds it the way the app expects.
      const html = new El('html');
      const pe = new El('parsererror');
      pe.parentNode = html;
      pe.childNodes.push(new Text(err));
      html.childNodes.push(pe);
      this.documentElement = html;
    } else {
      this.documentElement = root;
    }
  }
  getElementsByTagName(t) { return this.documentElement.getElementsByTagName(t); }
  querySelector(s) { return this.documentElement.querySelector(s); }
}

function parseXML(text) {
  let i = 0;
  const n = text.length;
  const stack = [];
  let root = null;
  let lastText = null;

  const fail = (msg) => { throw new Error(msg); };

  const flushText = () => {
    if (lastText && lastText.data.trim()) stack[stack.length - 1]?.childNodes.push(lastText);
    else if (lastText && stack[stack.length - 1] && !lastText.data.trim()) { /* drop ws */ }
    lastText = null;
  };

  while (i < n) {
    if (text[i] === '<') {
      if (text.startsWith('<?', i)) { const j = text.indexOf('?>', i); if (j < 0) fail('bad PI'); i = j + 2; continue; }
      if (text.startsWith('<!--', i)) { const j = text.indexOf('-->', i); if (j < 0) fail('bad comment'); i = j + 3; continue; }
      if (text.startsWith('<![CDATA[', i)) {
        const j = text.indexOf(']]>', i); if (j < 0) fail('bad CDATA');
        lastText = lastText || new Text('');
        lastText.data += text.slice(i + 9, j);
        i = j + 3; continue;
      }
      if (text.startsWith('<!', i)) { const j = text.indexOf('>', i); if (j < 0) fail('bad decl'); i = j + 1; continue; }

      if (text[i + 1] === '/') {
        flushText();
        const j = text.indexOf('>', i); if (j < 0) fail('bad close');
        const name = text.slice(i + 2, j).trim();
        const top = stack.pop();
        if (!top || top.tagName !== name) fail(`mismatched tag: expected </${top?.tagName}>, got </${name}>`);
        i = j + 1; continue;
      }

      // open tag
      flushText();
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_.:\-]/.test(text[j])) j++;
      const tag = text.slice(i + 1, j);
      if (!tag) fail(`bad tag at ${i}`);
      const el = new El(tag);
      // attributes
      while (j < n) {
        while (j < n && /\s/.test(text[j])) j++;
        if (text[j] === '>' || text.startsWith('/>', j)) break;
        let k = j;
        while (k < n && !/[\s=/>]/.test(text[k])) k++;
        const name = text.slice(j, k);
        while (k < n && /\s/.test(text[k])) k++;
        if (text[k] !== '=') fail(`expected = after ${name}`);
        k++;
        while (k < n && /\s/.test(text[k])) k++;
        const q = text[k];
        if (q !== '"' && q !== "'") fail(`unquoted value for ${name}`);
        const e = text.indexOf(q, k + 1);
        if (e < 0) fail(`unterminated value for ${name}`);
        el.attrs.set(name, unesc(text.slice(k + 1, e)));
        j = e + 1;
      }
      const selfClose = text.startsWith('/>', j);
      i = selfClose ? j + 2 : j + 1;

      if (stack.length) {
        el.parentNode = stack[stack.length - 1];
        stack[stack.length - 1].childNodes.push(el);
      } else if (root) {
        fail('multiple roots');
      } else {
        root = el;
      }
      if (!selfClose) stack.push(el);
      continue;
    }

    const next = text.indexOf('<', i);
    const chunk = text.slice(i, next < 0 ? n : next);
    lastText = lastText || new Text('');
    lastText.data += chunk;
    i = next < 0 ? n : next;
  }
  flushText();
  if (stack.length) fail(`unclosed <${stack[stack.length - 1].tagName}>`);
  if (!root) fail('no root element');
  return new Doc(root);
}

export function installDOMParser() {
  globalThis.DOMParser = class {
    parseFromString(text) {
      try { return parseXML(text); }
      catch (err) { return new Doc(null, err.message); }
    }
  };
}

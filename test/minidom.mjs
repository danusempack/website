/* A small but real DOM, built by parsing index.html.
 *
 * Auto-vivifying elements on demand would hide exactly the class of bug this
 * harness exists to catch (a selector that matches nothing), so instead the
 * tree is parsed from the shipped markup and selectors only match what is
 * really there.
 */

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT = new Set(['script', 'style']);

class ClassList {
  constructor() { this.set = new Set(); }
  add(...c) { c.forEach((x) => x && this.set.add(x)); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); }
  toggle(c, on) { (on === undefined ? !this.set.has(c) : !!on) ? this.set.add(c) : this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  get value() { return [...this.set].join(' '); }
  toString() { return this.value; }
  [Symbol.iterator]() { return this.set[Symbol.iterator](); }
}

class DNode {
  constructor(type, tag, doc) {
    this.nodeType = type;           // 1 element, 3 text, 8 comment
    this.tagName = tag ? tag.toUpperCase() : null;
    this.nodeName = this.tagName || (type === 3 ? '#text' : '#comment');
    this.ownerDocument = doc;
    this.childNodes = [];
    this.parentNode = null;
    this.parentElement = null;
    this.attrs = {};
    this._text = '';
    if (type === 1) {
      this.classList = new ClassList();
      this.dataset = new Proxy({}, {
        get: (t, k) => this.attrs['data-' + camel(k)] ?? t[k],
        set: (t, k, v) => { this.attrs['data-' + camel(k)] = String(v); t[k] = v; return true; },
        has: (t, k) => ('data-' + camel(k)) in this.attrs,
      });
      this.style = new Proxy({}, {
        get: (t, k) => (k === 'setProperty' || k === 'removeProperty' ? () => {} : (k in t ? t[k] : '')),
        set: (t, k, v) => { t[k] = v; return true; },
      });
      this.listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      this.checked = false;
      this._value = undefined;
      this._gl = null;
      this._2d = null;
      this.scrollTop = 0;
      this.scrollLeft = 0;
    }
  }

  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this) + 1] || null;
  }
  get previousElementSibling() {
    if (!this.parentNode) return null;
    const c = this.parentNode.children;
    return c[c.indexOf(this) - 1] || null;
  }

  get id() { return this.attrs.id || ''; }
  set id(v) { this.attrs.id = String(v); }
  get className() { return this.attrs.class || ''; }
  set className(v) {
    this.attrs.class = String(v);
    this.classList = new ClassList();
    String(v).split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
  }
  get textContent() {
    if (this.nodeType === 3 || this.nodeType === 8) return this._text;
    return this.childNodes.map((c) => c.textContent).join('');
  }
  set textContent(v) { this.childNodes = []; this._text = String(v ?? ''); }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) { this.childNodes = []; this._html = String(v ?? ''); }

  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') {
      const o = this.querySelector('option[selected]') || this.querySelector('option');
      return o ? o.attrs.value ?? o.textContent : '';
    }
    return this.attrs.value ?? '';
  }
  set value(v) { this._value = String(v); }
  get type() { return this.attrs.type || ''; }
  set type(v) { this.attrs.type = String(v); }
  get src() { return this.attrs.src || ''; }
  set src(v) { this.attrs.src = String(v); if (this.tagName === 'IMG') this._markLoaded(); }
  // Real canvas/element dimensions are reflected attributes: assigning
  // `el.width = n` overwrites the attribute and reading it back returns n.
  // (A plain field here made syncResolution() believe it resized every frame,
  // because the write never stuck.)
  get width() { return Number(this.attrs.width ?? 300); }
  set width(v) { this.attrs.width = String(Math.round(Number(v) || 0)); }
  get height() { return Number(this.attrs.height ?? 150); }
  set height(v) { this.attrs.height = String(Math.round(Number(v) || 0)); }
  get scrollWidth() { return this.width; }
  get scrollHeight() { return this.height; }
  get clientWidth() { return this.width; }
  get clientHeight() { return this.height; }
  get files() { return this._files || []; }

  appendChild(c) {
    if (!c) return c;
    c.parentNode = this;
    c.parentElement = this.nodeType === 1 ? this : null;
    if (c.nodeType === 1 && this.nodeType === 1) c.className = c.className;
    this.childNodes.push(c);
    return c;
  }
  append(...cs) {
    for (const c of cs) {
      if (c && c.nodeType) this.appendChild(c);
      else this.appendChild(this.ownerDocument.createTextNode(String(c)));
    }
  }
  prepend(c) {
    if (!c) return;
    c.parentNode = this;
    this.childNodes.unshift(c);
  }
  insertBefore(c) { return this.appendChild(c); }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) { this.childNodes.splice(i, 1); c.parentNode = null; }
    return c;
  }
  replaceChildren(...cs) { this.childNodes = []; cs.forEach((c) => this.appendChild(c)); }
  remove() { this.parentNode && this.parentNode.removeChild(this); }
  contains(n) { return n === this || this.childNodes.some((c) => c.contains && c.contains(n)); }

  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'class') this.className = v;
    if (k === 'style' && this.style) Object.assign(this.style, parseStyle(String(v)));
  }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  getAttributeNames() { return Object.keys(this.attrs); }
  get datasetKeys() { return Object.keys(this.attrs).filter((k) => k.startsWith('data-')); }

  addEventListener(t, fn, opts) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t).add(fn);
    if (opts && opts.once) this.listeners.get(t).once = true;
  }
  removeEventListener(t, fn) { this.listeners.get(t)?.delete(fn); }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    let n = this;
    while (n) {
      for (const fn of [...(n.listeners.get(ev.type) || [])]) {
        fn.call(n, ev);
        if (ev._stopped) return true;
      }
      if (n.listeners.get(ev.type)?.once) n.listeners.get(ev.type).clear();
      n = n.parentNode;
    }
    return true;
  }
  fire(type, detail = {}) {
    return this.dispatchEvent({
      type, target: this, detail, currentTarget: this,
      preventDefault() {}, stopPropagation() { this._stopped = true; },
      stopImmediatePropagation() { this._stopped = true; },
    });
  }
  _markLoaded() { setTimeout(() => this.onload && this.onload({ target: this }), 0); }

  querySelector(sel) { return querySelectorAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return querySelectorAll(this, sel); }
  matches(sel) { return sel.split(',').some((s) => matchOne(this, s.trim())); }
  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) {
      if (n.matches(sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  click() { this.fire('click'); }
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: this.width, bottom: this.height, width: this.width, height: this.height, toJSON() {} };
  }
  getRootNode() { return this; }
  showModal() { this.open = true; this.attrs.open = ''; }
  close() { this.open = false; delete this.attrs.open; }
  get open() { return 'open' in this.attrs; }
  set open(v) { if (v) this.attrs.open = ''; else delete this.attrs.open; }
  get openOrClosed() { return this.open; }
  getContext(kind) {
    if (kind === 'webgl2' || kind === 'webgl' || kind === 'experimental-webgl') {
      if (!this._gl) this._gl = this.ownerDocument._makeGL();
      return this._gl;
    }
    if (kind === '2d') {
      if (!this._2d) { this._2d = this.ownerDocument._make2D(); this._2d.canvas = this; }
      return this._2d;
    }
    return null;
  }
  toDataURL() { return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='; }
  captureStream() { return { getAudioTracks: () => [], getVideoTracks: () => [] }; }
  getBoundingClientRectTop() { return 0; }
}

class DText extends DNode {
  constructor(t, doc) { super(3, null, doc); this._text = String(t); }
}

const camel = (s) => String(s).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const parseStyle = (s) => {
  const o = {};
  for (const part of String(s).split(';')) {
    const i = part.indexOf(':');
    if (i > 0) o[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return o;
};

/* ------------------------------ selector engine ----------------------------- */

function matchSimple(el, sel) {
  sel = sel.trim();
  if (!sel) return false;
  // tag
  let m = sel.match(/^([a-zA-Z][\w-]*|\*)/);
  if (m) {
    if (m[1] !== '*' && el.tagName !== m[1].toUpperCase()) return false;
    sel = sel.slice(m[0].length);
  }
  // #id .class [attr] [attr=val] [attr^=val]
  for (;;) {
    m = sel.match(/^(#[-\w]+|\.[-\w]+|\[[^\]]+\])/);
    if (!m) break;
    const tok = m[0];
    if (tok[0] === '#') {
      if (el.id !== tok.slice(1)) return false;
    } else if (tok[0] === '.') {
      if (!el.classList.contains(tok.slice(1))) return false;
    } else {
      const am = tok.slice(1, -1).match(/^([-\w]+)(?:([~^$*|]?=)"?'?([^"']*)"?'?)?$/);
      if (!am) return false;
      const [, name, op, val] = am;
      if (!(name in el.attrs)) return false;
      if (op) {
        const have = el.attrs[name];
        if (op === '=' && have !== val) return false;
        else if (op === '^=' && !have.startsWith(val)) return false;
        else if (op === '$=' && !have.endsWith(val)) return false;
        else if (op === '*=' && !have.includes(val)) return false;
        else if (op === '~=' && !have.split(/\s+/).includes(val)) return false;
        else if (op === '|=' && have !== val && !have.startsWith(val + '-')) return false;
      }
    }
    sel = sel.slice(tok.length);
  }
  return sel === '';
}

function matchComplex(el, complex) {
  const parts = complex.trim().split(/\s+/);
  if (!matchSimple(el, parts[parts.length - 1])) return false;
  let n = el.parentNode;
  let i = parts.length - 2;
  while (i >= 0) {
    let found = false;
    while (n) {
      if (n.nodeType === 1 && matchSimple(n, parts[i])) { found = true; n = n.parentNode; i--; break; }
      n = n.parentNode;
    }
    if (!found) return false;
  }
  return true;
}

function querySelectorAll(root, selector) {
  const out = [];
  for (const complex of String(selector).split(',')) {
    if (!complex.trim()) continue;
    const walk = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType !== 1) continue;
        if (matchComplex(c, complex)) out.push(c);
        walk(c);
      }
    };
    walk(root);
  }
  return out;
}

/* --------------------------------- parser --------------------------------- */

function parseHTML(html, doc) {
  const root = new DNode(1, 'html', doc);
  let cur = root;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      const t = html.slice(i);
      if (t.trim()) cur.appendChild(new DText(t, doc));
      break;
    }
    if (lt > i) {
      const t = html.slice(i, lt);
      if (t.trim()) cur.appendChild(new DText(t, doc));
    }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) { const end = html.indexOf('>', lt); i = end < 0 ? html.length : end + 1; continue; }
    if (html.startsWith('</', lt)) {
      const end = html.indexOf('>', lt);
      const name = html.slice(lt + 2, end).trim().toLowerCase();
      // pop up to the matching open tag
      let n = cur;
      while (n && n.nodeType === 1 && n.tagName.toLowerCase() !== name) n = n.parentNode;
      if (n && n !== root) cur = n.parentNode || root;
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    const tagMatch = html.slice(lt).match(/^<([a-zA-Z][\w:-]*)/);
    if (!tagMatch) { i = lt + 1; continue; }
    const tag = tagMatch[1].toLowerCase();
    // find the end of the open tag, honouring quoted attribute values
    let j = lt + tagMatch[0].length;
    let quote = null;
    while (j < html.length) {
      const ch = html[j];
      if (quote) { if (ch === quote) quote = null; }
      else if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '>') break;
      j++;
    }
    const attrText = html.slice(lt + tagMatch[0].length, j);
    const selfClose = attrText.trimEnd().endsWith('/');
    const el = new DNode(1, tag, doc);
    for (const m of attrText.matchAll(/([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
      el.attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
      if (m[1].toLowerCase() === 'class') el.className = el.attrs.class;
    }
    if (el.attrs.hasOwnProperty('style')) el.style = parseStyle(el.attrs.style);
    if ('hidden' in el.attrs) el.hidden = true;
    if ('checked' in el.attrs) el.checked = true;
    if ('selected' in el.attrs) el.checked = true;
    cur.appendChild(el);
    i = j + 1;
    if (VOID.has(tag) || selfClose) continue;
    if (RAW_TEXT.has(tag)) {
      const close = html.toLowerCase().indexOf('</' + tag, i);
      const end = close < 0 ? html.length : close;
      const text = html.slice(i, end);
      if (tag === 'style' || tag === 'script') el.appendChild(new DText(text, doc));
      i = close < 0 ? html.length : html.indexOf('>', close) + 1;
      continue;
    }
    cur = el;
  }
  return root;
}

export function buildDocument(html, { makeGL, make2D }) {
  const doc = {
    _makeGL: makeGL,
    _make2D: make2D,
    readyState: 'complete',
    _listeners: new Map(),
    createElement: (t) => { const e = new DNode(1, t, doc); e.className = ''; return e; },
    createElementNS: (_n, t) => doc.createElement(t),
    createTextNode: (t) => new DText(t, doc),
    createDocumentFragment: () => doc.createElement('#fragment'),
    getElementById(id) { return parseHTML ? rootOf(doc).querySelector('#' + id) : null; },
    querySelector: (s) => rootOf(doc).querySelector(s),
    querySelectorAll: (s) => rootOf(doc).querySelectorAll(s),
    addEventListener(t, fn) {
      if (!doc._listeners.has(t)) doc._listeners.set(t, new Set());
      doc._listeners.get(t).add(fn);
    },
    removeEventListener(t, fn) { doc._listeners.get(t)?.delete(fn); },
    dispatchEvent(ev) {
      for (const fn of doc._listeners.get(ev.type) || []) fn(ev);
      return true;
    },
    elementFromPoint: () => null,
    caretPositionFromPoint: () => null,
    fonts: { ready: Promise.resolve(), check: async () => true, load: async () => [], addEventListener() {} },
  };

  const root = parseHTML(html, doc);
  const body = root.children.find((c) => c.tagName === 'BODY') || root;
  const head = root.children.find((c) => c.tagName === 'HEAD');
  doc.documentElement = root;
  doc.body = body;
  doc.head = head || doc.createElement('head');
  doc.activeElement = body;
  doc.title = 'doc';
  Object.defineProperty(doc, '__root', { value: root });
  doc.__ids = root.querySelectorAll('[id]').map((e) => e.id);
  return doc;
}

const rootOf = (doc) => doc.__root;

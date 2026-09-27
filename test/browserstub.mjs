/* Minimal browser environment for running the app's real boot path in Node.
 *
 * This is NOT a DOM implementation. It is a set of stubs shaped like the APIs
 * the app touches, faithful enough that `boot()` in main.js runs to completion
 * and every init function wires itself up. Its job is to catch runtime
 * ReferenceErrors and init-time logic faults that a static import graph cannot
 * see (a missing default export, a typo'd identifier, a bad element access).
 */

import { buildDocument } from './minidom.mjs';

let idCounter = 0;

/* ------------------------------- IndexedDB ------------------------------- */

function makeIDB() {
  const stores = new Map(); // name -> Map(keyPathValue -> record)
  const keyPaths = new Map();

  const later = (fn) => setTimeout(fn, 0);

  const makeRequest = (resultFn) => {
    const req = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
      readyState: 'pending',
    };
    later(() => {
      try {
        req.result = resultFn();
        req.readyState = 'done';
        req.onsuccess && req.onsuccess({ target: req });
      } catch (err) {
        req.error = err;
        req.readyState = 'done';
        req.onerror && req.onerror({ target: req });
      }
    });
    return req;
  };

  const makeStore = (name) => ({
    name,
    index() { return {}; },
    createIndex() { return {}; },
    get: (k) => makeRequest(() => stores.get(name).get(k)),
    getAll: () => makeRequest(() => [...stores.get(name).values()]),
    getAllKeys: () => makeRequest(() => [...stores.get(name).keys()]),
    count: () => makeRequest(() => stores.get(name).size),
    put: (rec) => makeRequest(() => {
      const kp = keyPaths.get(name);
      const k = kp ? rec[kp] : rec;
      stores.get(name).set(k, rec);
      return k;
    }),
    add: (rec) => makeRequest(() => {
      const kp = keyPaths.get(name);
      const k = kp ? rec[kp] : rec;
      if (stores.get(name).has(k)) throw new Error('ConstraintError');
      stores.get(name).set(k, rec);
      return k;
    }),
    delete: (k) => makeRequest(() => { stores.get(name).delete(k); return undefined; }),
    clear: () => makeRequest(() => { stores.get(name).clear(); return undefined; }),
    openCursor: () => makeRequest(() => null),
  });

  const db = {
    objectStoreNames: {
      contains: (n) => stores.has(n),
      get length() { return stores.size; },
    },
    createObjectStore(name, opts) {
      stores.set(name, new Map());
      keyPaths.set(name, opts && opts.keyPath);
      return makeStore(name);
    },
    deleteObjectStore(name) { stores.delete(name); keyPaths.delete(name); },
    transaction(names) {
      const list = Array.isArray(names) ? names : [names];
      for (const n of list) if (!stores.has(n)) stores.set(n, new Map());
      const t = {
        error: null,
        oncomplete: null,
        onerror: null,
        onabort: null,
        objectStore: (n) => makeStore(n),
        abort() { this.onabort && this.onabort({ target: this }); },
      };
      // Real IDB fires oncomplete only after every request in the tx settles.
      later(() => later(() => t.oncomplete && t.oncomplete({ target: t })));
      return t;
    },
    close() {},
  };

  const makeOpenRequest = () => {
    const req = {
      result: db,
      error: null,
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
    };
    // Fire per open() call, not at construction: the real IndexedDB dispatches
    // these in response to open(), so a handler attached a tick later still runs.
    later(() => req.onupgradeneeded && req.onupgradeneeded({
      target: req, oldVersion: 0, newVersion: 1,
    }));
    later(() => later(() => req.onsuccess && req.onsuccess({ target: req })));
    return req;
  };

  return {
    open() { return makeOpenRequest(); },
    deleteDatabase() {
      const r = { onsuccess: null, onerror: null };
      later(() => r.onsuccess && r.onsuccess({ target: r }));
      return r;
    },
    databases: async () => [],
  };
}

/* --------------------------------- WebGL2 -------------------------------- */

/** WebGL enum constants the app reads. Values are arbitrary but must be truthy
 *  where the code branches on them, and distinct where compared. */
const GL_ENUM_TARGET = Object.create(null);
const GL_ENUMS = new Proxy(GL_ENUM_TARGET, {
  get(target, name) {
    if (typeof name !== 'string') return undefined;
    if (!(name in target)) target[name] = nextEnum++;
    return target[name];
  },
});
let nextEnum = 1;

function makeGL() {
  // Known entry points with behaviour that matters. Everything else is either a
  // GL enum constant (ALL_CAPS) or a void* no-op.
  const overrides = {
    getShaderParameter: () => true,
    getProgramParameter: (_p, pname) => {
      // ACTIVE_UNIFORMS must be a count; LINK_STATUS/COMPILE_STATUS a boolean.
      if (pname === GL_ENUMS.ACTIVE_UNIFORMS) return 0;
      if (pname === GL_ENUMS.ACTIVE_ATTRIBUTES) return 0;
      if (pname === GL_ENUMS.SHADER_TYPE || pname === GL_ENUMS.LINK_STATUS
        || pname === GL_ENUMS.COMPILE_STATUS || pname === GL_ENUMS.VALIDATE_STATUS) return true;
      return 0;
    },
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getActiveUniform: () => null,
    getActiveAttrib: () => null,
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    getParameter: () => 4096,
    getExtension: (n) => (/lose_context|debug_renderer_info/.test(n) ? null : {}),
    getSupportedExtensions: () => [],
    checkFramebufferStatus: () => GL_ENUMS.FRAMEBUFFER_COMPLETE,
    getError: () => 0,
    isContextLost: () => false,
    createShader: () => ({}),
    createProgram: () => ({}),
    createBuffer: () => ({}),
    createVertexArray: () => ({}),
    createTexture: () => ({}),
    createFramebuffer: () => ({}),
    createRenderbuffer: () => ({}),
  };

  const isEnumName = (p) => typeof p === 'string' && /^[A-Z][A-Z0-9_]*$/.test(p);
  return new Proxy({}, {
    get(_t, prop) {
      if (typeof prop === 'symbol') return undefined;
      if (prop in overrides) return overrides[prop];
      if (isEnumName(prop)) return GL_ENUMS[prop];
      return () => undefined;   // void* no-op; returning undefined is correct
    },
  });
}

function make2D() {
  const gradient = { addColorStop() {} };
  return new Proxy({
    measureText: (s) => ({ width: String(s).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    createPattern: () => ({}),
    getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }),
    putImageData() {},
    canvas: null,
  }, {
    get(t, prop) {
      if (prop in t) return t[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => undefined;
    },
    set(t, prop, v) { t[prop] = v; return true; },
  });
}

/* -------------------------------- globals -------------------------------- */

class StubEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.defaultPrevented = false;
    this.cancelable = !!init.cancelable;
    this.detail = init.detail;
    this.target = init.target || null;
    this.key = init.key;
    this.code = init.code;
    this.button = init.button ?? 0;
    this.buttons = init.buttons ?? 0;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.deltaY = init.deltaY ?? 0;
    this.ctrlKey = !!init.ctrlKey;
    this.metaKey = !!init.metaKey;
    this.shiftKey = !!init.shiftKey;
    this.altKey = !!init.altKey;
    this.pointerId = init.pointerId ?? 1;
    this.dataTransfer = init.dataTransfer;
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
  stopImmediatePropagation() { this.stopped = true; }
}

class StubAudioNode {
  constructor(ctx) {
    this.context = ctx;
    this.gain = { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} };
    this.pan = { value: 0 };
  }
  connect() { return this; }
  disconnect() {}
}

class StubAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 48000;
    this.state = 'running';
    this.destination = new StubAudioNode(this);
    this.listener = { positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 }, setOrientation() {} };
    this._nodes = new Set();
  }
  _node(kind, extra = {}) {
    const n = Object.assign(new StubAudioNode(this), { kind }, extra);
    this._nodes.add(n);
    return n;
  }
  createGain() { return this._node('gain'); }
  createMediaElementSource(el) { return this._node('mediaelement', { mediaElement: el, playbackRate: { value: 1, setValueAtTime() {} } }); }
  createBufferSource() {
    return this._node('buffersource', {
      buffer: null, loop: false, playbackRate: { value: 1, setValueAtTime() {} },
      start() { this.started = true; }, stop() { this.stopped = true; },
      connect(dest) { this.connected = dest; return dest; },
    });
  }
  createAnalyser() {
    return this._node('analyser', {
      fftSize: 2048, frequencyBinCount: 1024,
      getByteFrequencyData(a) { a.fill(0); }, getByteTimeDomainData(a) { a.fill(128); },
      getFloatFrequencyData(a) { a.fill(-100); }, getFloatTimeDomainData(a) { a.fill(0); },
    });
  }
  createBiquadFilter() { return this._node('biquad', { frequency: { value: 350 }, Q: { value: 1 }, type: 'lowpass', detune: { value: 0 } }); }
  createStereoPanner() { return this._node('panner', { pan: { value: 0 } }); }
  createDynamicsCompressor() { return this._node('comp'); }
  createDelay() { return this._node('delay', { delayTime: { value: 0 } }); }
  createBuffer(ch, len, rate) { return { length: len, numberOfChannels: ch, sampleRate: rate, duration: len / rate, getChannelData: () => new Float32Array(len) }; }
  async decodeAudioData() { return this.createBuffer(2, 48000, 48000); }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  async close() { this.state = 'closed'; }
}

/** Requests already issued, so the test can wait for them to settle. */
const microtasks = [];

export function installBrowserEnv({ raf = true, html } = {}) {
  const g = globalThis;

  if (!html) throw new Error('installBrowserEnv needs the real index.html to build a faithful DOM');
  const doc = buildDocument(html, { makeGL, make2D });
  g.document = doc;
  g.DNode = doc.documentElement.constructor;
  g.DText = doc.createTextNode('').constructor;
  g.Element = doc.documentElement.constructor;
  g.HTMLElement = doc.documentElement.constructor;

  g.Event = StubEvent;
  g.CustomEvent = class extends StubEvent {};
  g.KeyboardEvent = StubEvent;
  g.MouseEvent = StubEvent;
  g.PointerEvent = StubEvent;
  g.WheelEvent = StubEvent;
  g.DragEvent = StubEvent;
  g.FocusEvent = StubEvent;
  g.InputEvent = StubEvent;
  g.MessageEvent = StubEvent;
  g.ErrorEvent = StubEvent;
  g.DOMException = class DOMException extends Error {
    constructor(msg, name = 'Error') { super(msg); this.name = name; }
  };

  g.window = g;
  g.self = g;

  // window-level event target (the app calls bare addEventListener/addEventListener)
  const winListeners = new Map();
  g.addEventListener = (type, fn) => {
    if (!winListeners.has(type)) winListeners.set(type, new Set());
    winListeners.get(type).add(fn);
  };
  g.removeEventListener = (type, fn) => { winListeners.get(type)?.delete(fn); };
  g.dispatchEvent = (ev) => {
    for (const fn of [...(winListeners.get(ev.type) || [])]) fn(ev);
    return true;
  };
  g.__fireWindow = (type, detail = {}) =>
    g.dispatchEvent({ type, target: g, detail, preventDefault() {}, stopPropagation() {} });
  g.__windowListenerCount = (type) => (winListeners.get(type)?.size ?? 0);
  g.navigator = {
    userAgent: 'node-harness',
    language: 'id-ID',
    languages: ['id-ID', 'en'],
    platform: 'Linux armv8l',
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 5,
    clipboard: { writeText: async () => {}, readText: async () => '' },
    storage: { estimate: async () => ({ usage: 1024, quota: 64 * 1024 * 1024 }) },
    permissions: { query: async () => ({ state: 'granted' }) },
    mediaDevices: { enumerateDevices: async () => [] },
    serviceWorker: {
      controller: null,
      ready: Promise.resolve(),
      register: async (url, opts) => {
        globalThis.__swRegistered = { url, opts };
        return {
          scope: opts?.scope || './',
          updateViaCache: 'imports',
          unregister: async () => true,
          addEventListener() {}, removeEventListener() {},
          update: async () => {},
        };
      },
      getRegistration: async () => null,
      getRegistrations: async () => [],
      addEventListener() {}, removeEventListener() {},
    },
  };
  g.location = new URL('https://example.test/index.html');
  g.history = { replaceState() {}, pushState() {}, state: null };

  g.innerWidth = 1280;
  g.innerHeight = 900;
  g.outerWidth = 1280;
  g.outerHeight = 900;
  g.devicePixelRatio = 2;
  g.screen = { width: 1280, height: 900, availWidth: 1280, availHeight: 860 };

  g.matchMedia = (q) => ({
    media: q,
    matches: /prefers-reduced-motion:\s*no-preference/.test(q),
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {}, onchange: null,
  });
  g.getComputedStyle = (el) => new Proxy({
    getPropertyValue: (name) => '',
    removeProperty: () => '',
  }, { get: (t, k) => (k in t ? t[k] : '') });
  g.scrollTo = () => {};
  g.scrollBy = () => {};
  g.alert = () => {};
  g.confirm = () => true;
  g.prompt = () => null;
  g.open = () => null;
  g.print = () => {};

  // rAF is driven manually so the test decides how many frames run.
  const frameQueue = [];
  g.requestAnimationFrame = raf ? (fn) => { frameQueue.push(fn); return frameQueue.length; } : () => 0;
  g.cancelAnimationFrame = () => {};
  // rAF hands out a monotonically increasing timestamp starting from now, like a
  // real display clock. Passing a fixed 16.7 instead made every dt negative and
  // the player's fps meter read 0.
  g.__runFrames = (n, ms = 16.7) => {
    let t = performance.now();
    for (let i = 0; i < n; i++) {
      const batch = frameQueue.splice(0, frameQueue.length);
      if (!batch.length) break;
      t += ms;
      for (const fn of batch) fn(t);
    }
  };
  g.__frameCount = () => frameQueue.length;

  g.indexedDB = makeIDB();
  g.IDBKeyRange = {
    only: (v) => ({ type: 'only', value: v }),
    lower: (v) => ({ type: 'lower', value: v }),
    upper: (v) => ({ type: 'upper', value: v }),
    lowerBound: (v) => ({ type: 'lowerBound', value: v }),
    upperBound: (v) => ({ type: 'upperBound', value: v }),
    bound: (a, b) => ({ type: 'bound', value: [a, b] }),
  };

  const store = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(String(k)) ? m.get(String(k)) : null),
      setItem: (k, v) => { m.set(String(k), String(v)); },
      removeItem: (k) => { m.delete(String(k)); },
      clear: () => m.clear(),
      key: (i) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
  };
  g.localStorage = store();
  g.sessionStorage = store();

  g.Worker = class {
    constructor() { this.onmessage = null; this.onerror = null; }
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
  };
  g.SharedWorker = g.Worker;
  g.WorkletNode = class { constructor() { this.port = { postMessage() {}, onmessage: null }; } };

  g.AudioContext = StubAudioContext;
  g.webkitAudioContext = StubAudioContext;
  g.OfflineAudioContext = class extends StubAudioContext {
    constructor(ch, len, rate) { super(); this.length = len; this.sampleRate = rate; }
    startRendering() { return Promise.resolve(this.createBuffer(2, this.length, this.sampleRate)); }
  };
  g.AudioBuffer = class {};
  g.MediaRecorder = class {
    constructor() { this.state = 'inactive'; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.ondataavailable && this.ondataavailable({ data: new Blob([]) }); this.onstop && this.onstop(); }
    addEventListener() {}
    static isTypeSupported() { return true; }
  };
  g.AudioDecoder = undefined;
  g.VideoDecoder = undefined;
  g.VideoEncoder = undefined;
  g.VideoFrame = class {};
  g.ImageDecoder = undefined;

  g.OffscreenCanvas = class {
    constructor(w = 1, h = 1) { this.width = w; this.height = h; }
    getContext(kind) { return this._c || (this._c = new Node('canvas').getContext(kind)); }
    convertToBlob() { return Promise.resolve(new Blob([])); }
  };
  g.createImageBitmap = async (src) => {
    if (src instanceof Blob) return { width: 2, height: 2, close() {} };
    return { width: 2, height: 2, close() {} };
  };
  g.Image = class {
    constructor() { this.width = 2; this.height = 2; }
    set src(v) { this._src = v; setTimeout(() => this.onload && this.onload(), 0); }
    get src() { return this._src; }
    addEventListener() {}
    removeEventListener() {}
    decode() { return Promise.resolve(); }
  };
  g.HTMLImageElement = g.Image;
  g.HTMLCanvasElement = doc.documentElement.constructor;
  g.HTMLVideoElement = class extends g.HTMLCanvasElement {
    constructor() {
      super('video');
      this.readyState = 4;
      this.paused = true;
      this.currentTime = 0;
      this.duration = 10;
      this.videoWidth = 720;
      this.videoHeight = 1280;
      this.playbackRate = 1;
      this.muted = false;
      this.volume = 1;
    }
    play() { this.paused = false; this._playing = true; return Promise.resolve(); }
    pause() { this.paused = true; this._playing = false; }
    load() {}
    addEventListener(t, fn) { if (t === 'loadeddata') setTimeout(fn, 0); super.addEventListener(t, fn); }
    captureStream() { return { getAudioTracks: () => [], getVideoTracks: () => [] }; }
  };
  g.HTMLMediaElement = g.HTMLVideoElement;
  g.Audio = class extends g.HTMLVideoElement {
    constructor() {
      super();
      this.tagName = 'AUDIO';
      this.volume = 1;
      this.muted = false;
      this.loop = false;
      this.preload = 'none';
      this.playsInline = false;
      this.duration = 18.482;
      this.error = null;
    }
    load() {}
    removeAttribute(n) { delete this.attrs[n]; }
    canPlayType() { return 'probably'; }
  };
  g.HTMLAudioElement = g.Audio;

  const objUrls = new Map();
  let urlN = 0;
  g.URL.createObjectURL = (b) => { const u = `blob:https://example.test/${++urlN}`; objUrls.set(u, b); return u; };
  g.URL.revokeObjectURL = (u) => objUrls.delete(u);
  g.URL.createObjectURLs = objUrls;

  g.MediaStream = class { constructor(tracks = []) { this.getTracks = () => tracks; } };
  g.MediaStreamTrack = class { constructor(kind = 'video') { this.kind = kind; this.enabled = true; this.readyState = 'live'; } stop() { this.readyState = 'ended'; } };
  g.MediaStreamAudioDestinationNode = class extends StubAudioNode {
    constructor(ctx) { super(ctx); this.stream = new g.MediaStream(); }
  };
  g.AudioContext.prototype.createMediaStreamDestination = function () {
    return new g.MediaStreamAudioDestinationNode(this);
  };

  g.requestIdleCallback = (fn) => setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 12 }), 0);
  g.cancelIdleCallback = (h) => clearTimeout(h);
  g.structuredClone = g.structuredClone || ((v) => JSON.parse(JSON.stringify(v)));
  g.queueMicrotask = g.queueMicrotask || queueMicrotask;
  g.reportError = (e) => { throw e; };
  g.crossOriginIsolated = false;
  g.isSecureContext = true;
  g.origin = 'https://example.test';
  g.CSS = { supports: () => false, escape: (s) => String(s) };

  g.fetch = async () => new Response('', { status: 404 });
  g.Response = globalThis.Response;
  g.Request = globalThis.Request;
  g.Headers = globalThis.Headers;

  g.DOMParser = class {
    parseFromString() { throw new Error('DOMParser stub: install the real one via domshim'); }
  };
  g.XMLSerializer = class { serializeToString() { return ''; } };

  g.CryptoKey = class {};
  g.SubtleCrypto = class {
    async digest() { return new ArrayBuffer(0); }
    async encrypt() { return new ArrayBuffer(0); }
    async importKey() { return {}; }
  };
  // Node exposes `crypto` as a getter-only global, so define rather than assign.
  if (!g.crypto) {
    Object.defineProperty(g, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (a) => { for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 256) | 0; return a; },
        randomUUID: () => '00000000-0000-4000-8000-000000000000',
        subtle: new g.SubtleCrypto(),
      },
    });
  }

  g.__doc = doc;
  g.__flush = async (ms = 0) => { await new Promise((r) => setTimeout(r, ms)); };
  return g;
}

export { StubEvent, StubAudioContext, makeGL, make2D, makeIDB, microtasks };

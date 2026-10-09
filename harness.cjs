// Harness: load the REAL app.js with a stubbed DOM/window, then exercise
// the actual parsing pipeline (importRows & friends via window.__probe).
// Used by test-import.cjs.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(),
    style: {}, dataset: {}, children: [], classList: {
      _s: new Set(),
      add(...c) { c.forEach(x => this._s.add(x)); },
      remove(...c) { c.forEach(x => this._s.delete(x)); },
      toggle(c, on) { if (on === undefined) on = !this._s.has(c); on ? this._s.add(c) : this._s.delete(c); return on; },
      contains(c) { return this._s.has(c); },
    },
    _text: '', _html: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v == null ? '' : v); },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v == null ? '' : v); },
    value: '', files: null, checked: false, hidden: false,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { return c; }, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    focus() {}, blur() {}, click() {}, insertAdjacentHTML() {},
    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, bottom: 600, right: 800 }; },
    closest() { return null; }, contains() { return false; },
    scrollIntoView() {}, animate() { return { finished: Promise.resolve() }; },
  };
  return el;
}

const elCache = new Map();
function getEl(id) {
  if (!elCache.has(id)) elCache.set(id, makeEl('div'));
  return elCache.get(id);
}

const store = new Map();
const localStorage = {
  getItem(k) { return store.has(k) ? store.get(k) : null; },
  setItem(k, v) { store.set(k, String(v)); },
  removeItem(k) { store.delete(k); },
  clear() { store.clear(); },
  key(i) { return Array.from(store.keys())[i] ?? null; },
  get length() { return store.size; },
};

const documentStub = {
  documentElement: makeEl('html'),
  body: makeEl('body'),
  head: makeEl('head'),
  visibilityState: 'visible',
  activeElement: null,
  getElementById: getEl,
  querySelector(sel) {
    // return a generic element for any selector so app.js init doesn't crash
    if (!elCache.has('sel:' + sel)) elCache.set('sel:' + sel, makeEl('div'));
    return elCache.get('sel:' + sel);
  },
  querySelectorAll() { return []; },
  createElement: makeEl,
  createDocumentFragment: () => makeEl('fragment'),
  addEventListener() {}, removeEventListener() {},
  cookie: '',
};

const windowStub = {
  innerWidth: 1440, innerHeight: 900,
  devicePixelRatio: 1,
  location: { href: 'https://jadwal-kampus.vercel.app/', search: '', hash: '', origin: 'https://jadwal-kampus.vercel.app', pathname: '/' },
  localStorage,
  sessionStorage: localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  addEventListener() {}, removeEventListener() {},
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
  requestAnimationFrame: cb => setTimeout(cb, 0),
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval: () => 0, clearInterval() {},
  navigator: { userAgent: 'node', onLine: true, clipboard: { writeText: async () => {} }, serviceWorker: { register: async () => {}, addEventListener() {}, controller: null, ready: Promise.resolve({}) } },
  screen: { width: 1440, height: 900 },
  alert() {}, confirm: () => true, prompt: () => null,
  fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  Blob: class { constructor() {} },
  FileReader: class { readAsArrayBuffer() {} readAsText() {} },
  XLSX: require('./node_modules/xlsx.full.min.js'),
  console,
  scrollTo() {},
  history: { pushState() {}, replaceState() {} },
  File: class {}, FormData: class {},
  TextDecoder, TextEncoder,
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  structuredClone: o => JSON.parse(JSON.stringify(o)),
  crypto: { randomUUID: () => 'uuid-' + Math.random().toString(36).slice(2) },
  IntersectionObserver: class { observe() {} disconnect() {} unobserve() {} },
  MutationObserver: class { observe() {} disconnect() {} },
  ResizeObserver: class { observe() {} disconnect() {} },
  CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
  Event: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
  performance: { now: () => Date.now() },
  isSecureContext: true,
  Element: class {}, HTMLElement: class {}, Node: class {},
};
windowStub.window = windowStub;
windowStub.self = windowStub;
windowStub.document = documentStub;
windowStub.globalThis = windowStub;

const ctx = vm.createContext(windowStub);
ctx.window = windowStub;
ctx.document = documentStub;
ctx.localStorage = localStorage;
ctx.navigator = windowStub.navigator;

const src = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

// Expose internals for probing: append a shim that captures top-level bindings.
const shim = `
;window.__probe = {
  importRows, normTipe, normDay, normTime, splitTimes, cellText, detectHeader, aliasIdx, parseCSVText, inferTipe, dayInCell, HARI,
  COLS, getData: () => data, setData: (d) => { data = d; },
  getMaster: () => master, setMaster: (m) => { master = m; },
  getProcessed: () => processedFiles, fileKey, hashBytes, importJadwalMulti, readFileRows, saveProcessed,
};
`;
try {
  vm.runInContext(src + shim, ctx, { filename: 'app.js' });
} catch (e) {
  console.error('LOAD ERROR:', e.message);
  console.error(e.stack.split('\n').slice(0, 6).join('\n'));
  process.exit(1);
}
module.exports = { probe: windowStub.__probe, windowStub, getEl, elCache, localStorage };

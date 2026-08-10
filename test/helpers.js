'use strict';

// ============================================================
// Test helpers — stub minimi del DOM e di localStorage
// Necessari per caricare i moduli renderer (src/*.js) in Node
// dove document/window/localStorage non esistono.
// ============================================================

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function createStubElement() {
  let textContent = '';
  const el = {
    value: '',
    style: {},
    dataset: {},
    title: '',
    className: '',
    _children: [],
    _html: '',
    classList: {
      add() {}, remove() {}, toggle() {}, contains() { return false; }
    },
    addEventListener() {},
    appendChild(child) { this._children.push(child); return child; },
    removeChild() {},
    remove() {},
    setAttribute() {},
    removeAttribute() {},
    getAttribute() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    set textContent(v) { textContent = String(v); },
    get textContent() { return textContent; },
    set innerHTML(v) { this._html = String(v); },
    get innerHTML() { return escapeHtml(textContent); }
  };
  return el;
}

function installRenderStubs() {
  global.document = {
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement: () => createStubElement(),
    addEventListener() {},
    body: createStubElement()
  };

  global.localStorage = {
    _data: {},
    getItem(k) {
      return Object.prototype.hasOwnProperty.call(this._data, k) ? this._data[k] : null;
    },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; },
    clear() { this._data = {}; }
  };
}

module.exports = { installRenderStubs, createStubElement, escapeHtml };

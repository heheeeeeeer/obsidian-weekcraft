const { test } = require('node:test');
const assert = require('node:assert/strict');
const { suppressHoverHints } = require('../src/hover-hints');

test('hover hints lose tooltip attributes while keeping accessible names, including later edits', () => {
    let notify, disconnected = false;
    class Element {
        constructor(doc) { this.ownerDocument = doc; this.attrs = {}; this.children = []; this.nodeType = 1; }
        getAttribute(name) { return this.attrs[name] || null; }
        setAttribute(name, value) { this.attrs[name] = value; }
        removeAttribute(name) { delete this.attrs[name]; }
        appendChild(child) { this.children.push(child); }
        querySelectorAll() { return this.children.flatMap(child => [child, ...child.querySelectorAll()]).filter(child => child.getAttribute('aria-label') || child.getAttribute('title')); }
    }
    const doc = { defaultView: { MutationObserver: class { constructor(fn) { notify = fn; } observe() {} disconnect() { disconnected = true; } } }, createElement() { return new Element(doc); } };
    const root = new Element(doc), time = new Element(doc);
    time.setAttribute('aria-label', '编辑时间 20:30–21:30'); time.setAttribute('title', 'Edit'); root.appendChild(time);
    const stop = suppressHoverHints(root);
    assert.equal(time.getAttribute('aria-label'), null);
    assert.equal(time.getAttribute('title'), null);
    const label = root.children.find(child => child.id === time.getAttribute('aria-labelledby'));
    assert.equal(label.textContent, '编辑时间 20:30–21:30'); assert.equal(label.hidden, true);
    time.setAttribute('aria-label', '编辑时间 21:30–22:30');
    notify([{ type: 'attributes', target: time }]);
    assert.equal(label.textContent, '编辑时间 21:30–22:30');
    assert.equal(time.getAttribute('aria-label'), null);
    const tag = new Element(doc); tag.setAttribute('aria-label', '切换类别'); root.appendChild(tag);
    notify([{ type: 'childList', addedNodes: [tag] }]);
    assert.equal(tag.getAttribute('aria-label'), null); assert.ok(tag.getAttribute('aria-labelledby'));
    stop(); assert.ok(disconnected);
});

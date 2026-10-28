const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture(initial = null, scale = 1) {
    const handlers = new Map();
    const view = {
        addEventListener(type, fn) { handlers.set(type, fn); },
        removeEventListener(type, fn) { if (handlers.get(type) === fn) handlers.delete(type); },
    };
    const doc = { defaultView: view };
    let viewport;
    class Element {
        constructor(options = {}) { this.cls = options.cls; this.children = []; this.events = {}; this.ownerDocument = doc; this.scrollTop = 0; this.style = { setProperty() {} }; this.classList = { toggle() {} }; }
        createDiv(options) { const e = new Element(options); this.children.push(e); if (options.cls === 'wk-time-scroll') viewport = e; return e; }
        addEventListener(type, fn) { this.events[type] = fn; }
        contains(target) { return this.children.some(e => e === target || e.contains(target)); }
        getBoundingClientRect() { return { top: 100 - viewport.scrollTop * scale, height: 1344 * scale }; }
        find(cls) { if (this.cls === cls) return this; return this.children.map(e => e.find(cls)).find(Boolean); }
    }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/kanban-form'), 'utf8'), {
        module, require: name => name === 'obsidian' ? { Modal: class {} } : require('../src/' + name.slice(2)),
    });
    const form = new module.exports.TaskForm({}, {}, 'mon', []);
    const parent = new Element();
    let range = initial;
    const api = form.buildTimeline(parent, { getRange: () => range, setRange: value => { range = value; } });
    const grid = parent.find('wk-time-grid'), selection = parent.find('wk-time-selection');
    const event = (minutes, target, offset = 0) => ({ button: 0, clientY: 100 + (minutes / 60 * 56 - viewport.scrollTop) * scale + offset, target, preventDefault() {} });
    const fire = (type, e) => handlers.get(type)?.(e);
    return { form, api, parent, viewport, grid, selection, event, fire, handlers, range: () => range };
}

test('clicks at the same time agree before and after scrolling, including scaled coordinates', () => {
    for (const scale of [1, 1.25]) for (const scroll of [0, 400, 760]) {
        const f = fixture(null, scale); f.viewport.scrollTop = scroll;
        const e = f.event(780, f.grid); f.grid.events.mousedown(e); f.fire('mouseup', e);
        assert.equal(f.range().start, 780); assert.equal(f.range().end, 840);
        assert.equal(f.selection.style.top, '728px');
    }
});

test('both resize handles track snapped mouse coordinates and preserve the grab offset', () => {
    const f = fixture({ start: 480, end: 600 }); f.viewport.scrollTop = 400;
    const top = f.parent.find('wk-time-handle is-start');
    const down = f.event(480, top, 6); f.selection.events.mousedown(down);
    f.fire('mousemove', f.event(527, top, 6));
    assert.equal(f.range().start, 525); assert.equal(f.range().end, 600);
    f.fire('mouseup', f.event(527, top, 6));
    const bottom = f.parent.find('wk-time-handle is-end');
    f.selection.events.mousedown(f.event(600, bottom, -5));
    f.fire('mousemove', f.event(678, bottom, -5));
    assert.equal(f.range().end, 675); assert.equal(f.range().start, 525);
    f.fire('mouseup', f.event(678, bottom, -5));
    assert.equal(f.handlers.size, 0);
});

test('scrolling during resize updates the range at the stationary pointer', () => {
    const f = fixture({ start: 480, end: 600 }); f.viewport.scrollTop = 400;
    const bottom = f.parent.find('wk-time-handle is-end');
    const down = f.event(600, bottom); f.selection.events.mousedown(down);
    f.viewport.scrollTop += 56; f.fire('scroll', {});
    assert.equal(f.range().end, 660);
    f.fire('mouseup', down); assert.equal(f.handlers.size, 0);
});

test('selection creation is live, supports upward drags and clips the final hour at midnight', () => {
    const f = fixture(); f.viewport.scrollTop = 400;
    f.grid.events.mousedown(f.event(600, f.grid));
    f.fire('mousemove', f.event(542, f.grid));
    assert.equal(f.range().start, 540); assert.equal(f.range().end, 600);
    f.fire('mouseup', f.event(542, f.grid));
    f.grid.events.mousedown(f.event(1425, f.grid)); f.fire('mouseup', f.event(1425, f.grid));
    assert.equal(f.range().start, 1425); assert.equal(f.range().end, 1440);
});

test('body dragging keeps duration, resize keeps minimum duration, and closing cleans up listeners', () => {
    const f = fixture({ start: 480, end: 600 }); f.viewport.scrollTop = 400;
    f.selection.events.mousedown(f.event(510, f.selection)); f.fire('mousemove', f.event(571, f.selection));
    assert.equal(f.range().start, 540); assert.equal(f.range().end, 660);
    f.fire('mouseup', f.event(571, f.selection));
    const bottom = f.parent.find('wk-time-handle is-end');
    f.selection.events.mousedown(f.event(660, bottom)); f.fire('mousemove', f.event(530, bottom));
    assert.equal(f.range().end, 555);
    f.form.contentEl = { empty() {} }; f.form.onClose();
    assert.equal(f.handlers.size, 0);
});

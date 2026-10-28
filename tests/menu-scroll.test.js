const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../src/board-panel'), 'utf8'), {
    module: moduleStub, require: name => name === 'obsidian' ? {} : name === './copy-task-form' ? { CopyTaskForm: class {} } : require('../src/' + name.slice(2)),
});
function fixture() {
    const handlers = new Set();
    const view = { addEventListener(type, fn, capture) { assert.equal(type, 'scroll'); assert.equal(capture, true); handlers.add(fn); }, removeEventListener(type, fn) { handlers.delete(fn); } };
    const anchor = { ownerDocument: { defaultView: view }, getBoundingClientRect() { return { left: 10, bottom: 50 }; } };
    const panel = Object.create(moduleStub.exports.BoardPanel.prototype);
    const menu = { hidden: 0, setUseNativeMenu(value) { this.native = value; }, onHide(fn) { this.cleanup = fn; }, hide() { this.hidden++; this.cleanup(); }, showAtPosition(pos) { assert.equal(pos.y, 50); assert.equal(this.native, false); } };
    return { handlers, view, anchor, panel, menu, scroll(target) { for (const fn of [...handlers]) fn({ target }); } };
}
test('scrolling the board dismisses its menu and removes the scroll listener', () => {
    const f = fixture(); f.panel.showMenu(f.menu, f.anchor);
    f.scroll({ contains: target => target === f.anchor });
    assert.equal(f.menu.hidden, 1); assert.equal(f.handlers.size, 0); assert.equal(f.panel.closeMenu, null);
});
test('scrolling within a long menu or another pane leaves the menu open; normal dismissal cleans up', () => {
    const f = fixture(); f.panel.showMenu(f.menu, f.anchor);
    f.scroll({ contains: () => false });
    assert.equal(f.menu.hidden, 0); assert.equal(f.handlers.size, 1);
    f.menu.hide(); assert.equal(f.handlers.size, 0);
});
test('opening another menu closes the previous one, without accumulating listeners', () => {
    const f = fixture(); f.panel.showMenu(f.menu, f.anchor);
    const next = { ...f.menu, hidden: 0 }; f.panel.showMenu(next, f.anchor);
    assert.equal(f.menu.hidden, 1); assert.equal(f.handlers.size, 1);
    f.scroll(f.view); assert.equal(next.hidden, 1); assert.equal(f.handlers.size, 0);
});

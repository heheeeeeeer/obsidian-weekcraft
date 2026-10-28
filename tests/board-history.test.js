const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BoardHistory, snapshot } = require('../src/board-history');
const { setTimestamp } = require('../src/timestamps');
function manager() { return { state: { children: [{ id: 'mon', data: { title: 'Mon' }, children: [{ id: 'a', data: { titleRaw: 'Task', checked: false, checkChar: ' ' } }] }] }, setState(value) { this.state = value; } }; }
function edit(history, m, fn) { const before = snapshot(m.state); const after = snapshot(m.state); fn(after); m.setState(after); history.record([{ manager: m, before, after }]); }
test('undo and redo restore completion state and the exact completion stamp', () => {
    const history = new BoardHistory(), m = manager();
    edit(history, m, board => { const item = board.children[0].children[0]; item.data.checked = true; item.data.titleRaw = setTimestamp('Task', true, { timestampFormat: 'HH:mm' }, new Date('2026-10-16T00:00Z')); });
    const raw = m.state.children[0].children[0].data.titleRaw;
    history.apply(m); assert.equal(m.state.children[0].children[0].data.checked, false); assert.equal(m.state.children[0].children[0].data.titleRaw, 'Task');
    history.apply(m, true); assert.equal(m.state.children[0].children[0].data.titleRaw, raw);
});
test('deletion is undoable and a new edit clears redo', () => {
    const history = new BoardHistory(), m = manager();
    edit(history, m, board => { board.children[0].children = []; });
    history.apply(m); assert.equal(m.state.children[0].children.length, 1);
    edit(history, m, board => { board.children[0].children[0].data.titleRaw = 'New text'; });
    assert.equal(history.apply(m, true), false);
});
test('cross-board transfer is one atomic undo/redo step from either participating board', () => {
    const history = new BoardHistory(), a = manager(), b = manager(); b.state.children[0].children = [];
    const beforeA = snapshot(a.state), beforeB = snapshot(b.state);
    b.state.children[0].children = a.state.children[0].children; a.state.children[0].children = [];
    history.record([{ manager: a, before: beforeA, after: a.state }, { manager: b, before: beforeB, after: b.state }]);
    history.apply(b); assert.equal(a.state.children[0].children.length, 1); assert.equal(b.state.children[0].children.length, 0);
    history.apply(a, true); assert.equal(a.state.children[0].children.length, 0); assert.equal(b.state.children[0].children.length, 1);
});
test('external modifications are never overwritten by undo', () => {
    const history = new BoardHistory(), m = manager();
    edit(history, m, board => { board.children[0].children[0].data.titleRaw = 'Changed'; });
    m.state.children[0].children[0].data.titleRaw = 'Edited on another device';
    assert.throws(() => history.apply(m)); assert.equal(m.state.children[0].children[0].data.titleRaw, 'Edited on another device');
});

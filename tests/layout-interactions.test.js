const { test } = require('node:test');
const assert = require('node:assert/strict');
const { dropPosition } = require('../src/drop-position');
const { captureViewPosition } = require('../src/view-position');
const { orderedTimeGroups, copyTask, cardInfo } = require('../src/board-model');
const task = (id, raw, checked = false) => ({ id, data: { titleRaw: raw, checked, checkChar: checked ? 'x' : ' ' } });

test('drop feedback and insertion IDs distinguish upper and lower halves, including the end of a group', () => {
    const row = { dataset: { wcItem: 'a' }, _weekcraftDrop: { laneId: 'mon', group: { range: '13:00–14:00', preserveCategory: true } }, matches: () => true, getBoundingClientRect: () => ({ top: 100, height: 60 }), nextElementSibling: { dataset: { wcItem: 'b' } } };
    assert.equal(dropPosition(row, 110).beforeId, 'a');
    assert.equal(dropPosition(row, 110).indicatorClass, 'weekcraft-drop-before');
    assert.equal(dropPosition(row, 150).beforeId, 'b');
    assert.equal(dropPosition(row, 150).indicatorClass, 'weekcraft-drop-after');
    row.nextElementSibling = null;
    assert.equal(dropPosition(row, 150).beforeId, null);
    const group = { matches: selector => selector.includes('.weekcraft-group'), querySelectorAll: () => [row] };
    assert.equal(dropPosition(group, 90).element, row);
    assert.equal(dropPosition(group, 90).beforeId, 'a');
});

test('move/copy time menus are chronological regardless of stored task order', () => {
    const lane = { children: [task('late', '**15:00–17:00**\nLate'), task('early', '**13:00–14:00**\nEarly'), task('none', 'No time'), task('early2', '**13:00–14:00**\nAnother')] };
    assert.deepEqual(orderedTimeGroups(lane).map(group => group.range), ['13:00–14:00', '15:00–17:00']);
    assert.equal(lane.children[0].id, 'late');
});

test('copy creates a separate unchecked task at the chosen date/time, leaving its source intact', () => {
    const { setTimestamp } = require('../src/timestamps');
    const source = task('source', setTimestamp('**13:00–14:00**\nRepeat #日程/科研', true, { timestampFormat: 'HH:mm' }), true);
    const manager = { state: { children: [{ id: 'mon', children: [source] }, { id: 'tue', children: [] }] }, getNewItem(raw, char) { return task('copy', raw, char === 'x'); }, setState(fn) { this.state = fn(this.state); } };
    const copy = copyTask(manager, 'source', 'tue', '15:00–16:00');
    assert.equal(copy.data.checked, false); assert.equal(cardInfo(copy).category, '科研');
    assert.equal(cardInfo(copy).range, '15:00–16:00'); assert.equal(cardInfo(copy).title, 'Repeat');
    assert.ok(!copy.data.titleRaw.includes('dayflow:stamp')); assert.equal(manager.state.children[0].children[0], source);
    assert.throws(() => copyTask(manager, 'source', 'missing', null));
});

test('redraw restores offsets and a surviving viewport anchor, excluding the task being moved', () => {
    const viewport = { parentElement: null, scrollTop: 300, scrollLeft: 7, scrollHeight: 1000, clientHeight: 200, getBoundingClientRect: () => ({ top: 0 }) };
    let shift = 0;
    const row = (id, y) => ({ dataset: { wcItem: id }, getBoundingClientRect: () => ({ top: y + shift - viewport.scrollTop, bottom: y + shift - viewport.scrollTop + 40 }) });
    const rows = [row('moving', 310), row('stable', 370)];
    const root = { parentElement: viewport, dataset: { wcMovingItem: 'moving' }, querySelectorAll: () => rows, ownerDocument: { defaultView: { innerHeight: 800 } } };
    const restore = captureViewPosition(root);
    viewport.scrollTop = 0; viewport.scrollLeft = 0; shift = -30;
    restore(); assert.equal(viewport.scrollTop, 270); assert.equal(viewport.scrollLeft, 7);
    assert.equal(rows[1].getBoundingClientRect().top, 70);
});

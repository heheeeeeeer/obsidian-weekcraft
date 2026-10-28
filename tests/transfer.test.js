const { test } = require('node:test');
const assert = require('node:assert/strict');
const { transferTask } = require('../src/board-transfer');
const { cardInfo } = require('../src/board-model');
const { setTimestamp } = require('../src/timestamps');
const item = (id, raw, checked = false) => ({ id, data: { titleRaw: raw, checked, checkChar: checked ? 'x' : ' ' } });
function manager(prefix, children) {
    let nextId = 0;
    return { state: { children }, setState(value) { this.state = typeof value === 'function' ? value(this.state) : value; },
        getNewItem(raw, char) { return item(`${prefix}-${++nextId}`, raw, char === 'x'); },
        updateItemContent(current, raw) { return { ...current, data: { ...current.data, titleRaw: raw } }; } };
}
function setup() {
    const raw = setTimestamp('**14:00–17:00**\n论文 [[研究]] #日程/科研', true,
        { timeZone: 'Asia/Shanghai', timestampFormat: 'HH:mm', timestampPrefix: '✅' }, new Date('2026-10-11T01:28:00Z'));
    const sourceManager = manager('source', [{ id: 's-backlog', children: [] }, { id: 's-mon', children: [item('task', raw, true), item('other', 'Other')] }]);
    const targetManager = manager('target', [{ id: 't-backlog', children: [] }, { id: 't-mon', children: [item('existing', 'Existing')] }]);
    return { sourceManager, targetManager, sourcePath: 'week-41.md', targetPath: 'week-42.md', id: 'task', laneId: 't-mon' };
}

test('cross-week transfer preserves data, uses a fresh ID and saves target before removing source', async () => {
    const input = setup(); const order = [];
    const raw = input.sourceManager.state.children[1].children[0].data.titleRaw;
    const result = await transferTask({ ...input, persist: async (manager, path) => {
        order.push(path);
        if (path === 'week-42.md') assert.ok(input.sourceManager.state.children[1].children.some(task => task.id === 'task'));
    } });
    assert.deepEqual(order, ['week-42.md', 'week-41.md']);
    assert.deepEqual(input.sourceManager.state.children[1].children.map(task => task.id), ['other']);
    const copied = input.targetManager.state.children[1].children[1];
    assert.notEqual(copied.id, 'task'); assert.equal(copied.id, result.targetId);
    assert.equal(copied.data.titleRaw, raw); assert.equal(copied.data.checked, true);
});

test('a target time group changes schedule/category while retaining content and completion time', async () => {
    const input = setup();
    await transferTask({ ...input, group: { range: '19:00–22:00', category: '自媒体' }, beforeId: 'existing', persist: async () => {} });
    const copied = input.targetManager.state.children[1].children[0];
    assert.equal(cardInfo(copied).range, '19:00–22:00'); assert.equal(cardInfo(copied).category, '自媒体');
    assert.equal(cardInfo(copied).title, '论文 [[研究]]'); assert.match(copied.data.titleRaw, /✅ 09:28/);
});

test('a target backlog removes only the planned time', async () => {
    const input = setup(); await transferTask({ ...input, laneId: 't-backlog', persist: async () => {} });
    const copied = input.targetManager.state.children[0].children[0];
    assert.equal(cardInfo(copied).range, null); assert.equal(cardInfo(copied).category, '科研');
    assert.match(copied.data.titleRaw, /✅ 09:28/);
});

test('target write failure leaves source intact and removes the tentative copy', async () => {
    const input = setup(); const original = input.sourceManager.state;
    await assert.rejects(transferTask({ ...input, persist: async () => { throw new Error('disk failed'); } }), /原任务仍保留/);
    assert.equal(input.sourceManager.state, original);
    assert.deepEqual(input.targetManager.state.children[1].children.map(task => task.id), ['existing']);
});

test('source edits during target save are retained and cancel the move', async () => {
    const input = setup(); let saves = 0;
    await assert.rejects(transferTask({ ...input, persist: async () => {
        if (saves++ === 0) input.sourceManager.state.children[1].children[0].data.titleRaw = 'Edited while saving';
    } }), /移动过程中发生变化/);
    assert.equal(input.sourceManager.state.children[1].children[0].data.titleRaw, 'Edited while saving');
    assert.deepEqual(input.targetManager.state.children[1].children.map(task => task.id), ['existing']);
});

test('source save failure restores its task, preserves unrelated edits and retains a durable target copy', async () => {
    const input = setup(); let sourceSaves = 0;
    await assert.rejects(transferTask({ ...input, persist: async (manager, path) => {
        if (path === 'week-42.md') input.sourceManager.state.children[1].children.push(item('new', 'Added while saving'));
        if (path === 'week-41.md' && sourceSaves++ === 0) throw new Error('source failed');
    } }), /原看板保存失败/);
    assert.deepEqual(input.sourceManager.state.children[1].children.map(task => task.id), ['task', 'other', 'new']);
    assert.equal(input.targetManager.state.children[1].children.length, 2);
});

test('a target task edited during a cancelled move is never removed by rollback', async () => {
    const input = setup();
    await assert.rejects(transferTask({ ...input, persist: async () => {
        input.sourceManager.state.children[1].children[0].data.titleRaw = 'Source edited';
        input.targetManager.state.children[1].children[1].data.titleRaw = 'Target edited';
    } }), /移动过程中发生变化/);
    assert.equal(input.sourceManager.state.children[1].children[0].data.titleRaw, 'Source edited');
    assert.equal(input.targetManager.state.children[1].children[1].data.titleRaw, 'Target edited');
});

test('two panes of the same document move a task once without generating a copy', async () => {
    const input = setup(); let writes = 0;
    await transferTask({ ...input, targetPath: input.sourcePath, targetManager: input.sourceManager, laneId: 's-backlog', persist: async () => { writes++; } });
    assert.equal(input.sourceManager.state.children[0].children[0].id, 'task');
    assert.deepEqual(input.sourceManager.state.children[1].children.map(task => task.id), ['other']);
    assert.equal(writes, 0);
});

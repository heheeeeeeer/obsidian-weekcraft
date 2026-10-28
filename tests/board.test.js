const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cardInfo, groupsForLane, moveCard, expandLegacyCards, stampBoardTransitions, sortedLane, deleteCard, changeCategory, deleteLane } = require('../src/board-model');
const { setTimestamp } = require('../src/timestamps');
const settings = { timestampFormat: 'HH:mm', timestampPrefix: '✅', timeZone: 'Asia/Shanghai' };
const task = (id, raw, checked = false) => ({ id, data: { titleRaw: raw, checked, checkChar: checked ? 'x' : ' ' } });
function manager(children) {
    let id = 0;
    return { state: { children }, setState(value) { this.state = typeof value === 'function' ? value(this.state) : value; },
        updateItemContent(item, raw) { return { ...item, data: { ...item.data, titleRaw: raw } }; },
        getNewItem(raw, char) { return task(`new-${++id}`, raw, char === 'x'); } };
}
test('legacy multi-task cards become independently checkable rows without losing content', () => {
    const m = manager([{ id: 'mon', children: [task('a', '**14:00–17:00** #日程/科研\n完成新模型运行；提交集群；检查运行日志')] }]);
    assert.ok(expandLegacyCards(m));
    assert.equal(m.state.children[0].children.length, 3);
    assert.deepEqual(m.state.children[0].children.map(item => cardInfo(item).title), ['完成新模型运行', '提交集群', '检查运行日志']);
    assert.equal(groupsForLane(m.state.children[0]).length, 1);
    assert.equal(expandLegacyCards(m), false);
});
test('backlog tasks move into a schedule group, preserving checkbox and owned completion time', () => {
    const raw = setTimestamp('论文 #日程/生活', true, settings, new Date('2026-10-11T01:28Z'));
    const m = manager([{ id: 'backlog', children: [task('a', raw, true)] }, { id: 'mon', children: [task('b', '**14:00–17:00**\n其他 #日程/科研')] }]);
    moveCard(m, 'a', 'mon', { range: '14:00–17:00', category: '科研' }, 'b');
    assert.equal(m.state.children[0].children.length, 0);
    const moved = m.state.children[1].children[0];
    assert.equal(moved.id, 'a'); assert.equal(moved.data.checked, true);
    assert.match(moved.data.titleRaw, /✅ 09:28/);
    assert.deepEqual(cardInfo(moved), { title: '论文', range: '14:00–17:00', category: '科研', key: '["14:00–17:00","科研"]' });
    moveCard(m, 'a', 'backlog');
    assert.equal(m.state.children[0].children[0].id, 'a');
});
test('individual task completion stamps never affect the time heading or other tasks', () => {
    const m = manager([{ id: 'mon', children: [task('a', '**14:00–17:00**\nA #日程/科研'), task('b', '**14:00–17:00**\nB #日程/科研')] }]);
    const old = m.state;
    const next = { children: [{ id: 'mon', children: [task('a', old.children[0].children[0].data.titleRaw, true), old.children[0].children[1]] }] };
    const stamped = stampBoardTransitions(m, old, next, settings, new Date('2026-10-11T01:28Z'));
    assert.match(stamped.children[0].children[0].data.titleRaw, /✅ 09:28/);
    assert.equal(stamped.children[0].children[1], old.children[0].children[1]);
    assert.equal(cardInfo(stamped.children[0].children[0]).range, '14:00–17:00');
    assert.equal(stampBoardTransitions(m, stamped, stamped, settings), stamped);
    const unchecked = { children: [{ id: 'mon', children: [task('a', stamped.children[0].children[0].data.titleRaw), old.children[0].children[1]] }] };
    assert.equal(stampBoardTransitions(m, stamped, unchecked, settings).children[0].children[0].data.titleRaw, old.children[0].children[0].data.titleRaw);
});

test('category sorting is stable and does not rewrite stored manual order', () => {
    const lane = { children: [task('life', '生活任务 #日程/生活'), task('science1', '科研一 #日程/科研'), task('video', '视频 #日程/自媒体'), task('science2', '科研二 #日程/科研')] };
    assert.deepEqual(sortedLane(lane, ['科研', '自媒体', '生活'], true, true).children.map(item => item.id), ['science1', 'science2', 'video', 'life']);
    assert.equal(lane.children[0].id, 'life');
    assert.equal(sortedLane(lane, [], false), lane);
    const daily = { children: [task('late', '**18:00–19:00**\n任务 #日程/科研'), task('untimed', '无时间任务 #日程/生活'), task('early', '**14:00–17:00**\n任务 #日程/生活')] };
    assert.deepEqual(sortedLane(daily, ['科研', '生活'], true).children.map(item => item.id), ['untimed', 'early', 'late']);
});

test('switching a time-group category preserves completion times and leaves other groups alone', () => {
    const raw = setTimestamp('**14:00–17:00**\nA #日程/科研', true, settings, new Date('2026-10-11T01:28Z'));
    const m = manager([{ id: 'backlog', children: [] }, { id: 'mon', children: [task('a', raw, true), task('b', '**14:00–17:00**\nB #日程/科研'), task('c', 'C #日程/运动')] }]);
    changeCategory(m, ['a', 'b'], '自媒体');
    assert.equal(cardInfo(m.state.children[1].children[0]).category, '自媒体');
    assert.equal(cardInfo(m.state.children[1].children[1]).category, '自媒体');
    assert.equal(cardInfo(m.state.children[1].children[2]).category, '运动');
    assert.match(m.state.children[1].children[0].data.titleRaw, /✅ 09:28/);
    deleteCard(m, 'b'); assert.deepEqual(m.state.children[1].children.map(item => item.id), ['a', 'c']);
});

test('deleting a date returns all of its tasks to backlog without deleting completion records', () => {
    const raw = setTimestamp('**14:00–17:00**\nA #日程/科研', true, settings, new Date('2026-10-11T01:28Z'));
    const m = manager([{ id: 'backlog', children: [task('existing', 'Existing')] }, { id: 'mon', children: [task('a', raw, true)] }, { id: 'tue', children: [] }]);
    deleteLane(m, 'mon');
    assert.deepEqual(m.state.children.map(lane => lane.id), ['backlog', 'tue']);
    assert.deepEqual(m.state.children[0].children.map(item => item.id), ['existing', 'a']);
    assert.equal(cardInfo(m.state.children[0].children[1]).range, null);
    assert.equal(m.state.children[0].children[1].data.checked, true);
    assert.match(m.state.children[0].children[1].data.titleRaw, /✅ 09:28/);
    const before = m.state; deleteLane(m, 'backlog'); assert.equal(m.state, before);
});

test('default category colors differ and custom colors are validated', () => {
    const { categoryColor } = require('../src/category-colors');
    assert.notEqual(categoryColor('科研', {}), categoryColor('生活', {}));
    assert.equal(categoryColor('科研', { categoryColors: { 科研: '#ff0000' } }), '#ff0000');
    assert.notEqual(categoryColor('科研', { categoryColors: { 科研: 'invalid' } }), 'invalid');
    assert.equal(categoryColor('阅读', {}), categoryColor('阅读', {}));
});


test('one time group includes independent categories and moving into it retains classification', () => {
    const m = manager([{ id: 'backlog', children: [task('c', 'C #日程/生活')] }, { id: 'mon', children: [task('a', '**14:00–17:00**\nA #日程/科研'), task('b', '**14:00–17:00**\nB')] }]);
    const groups = groupsForLane(m.state.children[1]);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].items.map(entry => entry.info.category), ['科研', '']);
    moveCard(m, 'c', 'mon', groups[0]);
    assert.equal(cardInfo(m.state.children[1].children[2]).category, '生活');
    changeCategory(m, ['a'], '');
    assert.equal(cardInfo(m.state.children[1].children[0]).category, '');
    assert.equal(groupsForLane(m.state.children[1]).length, 1);
});


test('inline additions are placed immediately below their anchor and inherit time/category without completion', () => {
    const { insertTaskAfter } = require('../src/board-model');
    const m = manager([{ id: 'mon', children: [task('a', '**14:00–17:00**\nA #日程/科研', true), task('b', '**14:00–17:00**\nB #日程/生活')] }]);
    insertTaskAfter(m, 'a', 'New task');
    const items = m.state.children[0].children;
    assert.equal(items[0].id, 'a'); assert.equal(items[2].id, 'b');
    assert.equal(cardInfo(items[1]).title, 'New task');
    assert.equal(cardInfo(items[1]).range, '14:00–17:00');
    assert.equal(cardInfo(items[1]).category, '科研');
    assert.equal(items[1].data.checked, false);
    assert.throws(() => insertTaskAfter(m, 'missing', 'No orphan'));
    assert.equal(m.state.children[0].children.length, 3);
});

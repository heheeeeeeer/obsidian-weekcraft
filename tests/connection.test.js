const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('startup waits for Kanban readiness; persistent failures report the correct cause', () => {
    const notices = []; const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/kanban-adapter'), 'utf8'), {
        module, require: name => name === 'obsidian' ? { Notice: class { constructor(message) { notices.push(message); } } }
            : name === './drop-position' ? require('../src/drop-position') : name === './drop-position' ? require('../src/drop-position') : name === './view-position' ? require('../src/view-position') : name === './board-history' ? require('../src/board-history') : name === './board-model' ? { stampBoardTransitions() {} } : name === './board-panel' ? { BoardPanel: class {} } : { TaskForm: class {} },
        Map, Set, Date,
    });
    const view = { file: { path: 'board.md' }, containerEl: { classList: { add() {}, remove() {} }, style: { setProperty() {}, removeProperty() {} }, addEventListener() {}, removeEventListener() {} } };
    let manager = null; let time = 0;
    const kanban = { getStateManager() { return manager; } };
    const plugin = { settings: { laneWidth: 680, groupedLayout: false, completionTimestamps: false }, app: {
        plugins: { plugins: { 'obsidian-kanban': kanban } }, workspace: { getLeavesOfType: () => [{ view }] }, metadataCache: { getFileCache: () => ({ frontmatter: { 'obsidian-weekcraft': true } }) },
    } };
    const adapter = new module.exports.KanbanAdapter(plugin); adapter.now = () => time;
    adapter.sync(); time = 9000; adapter.sync(); assert.equal(notices.length, 0);
    manager = { state: { children: [] }, setState() {}, updateItemContent() {}, getNewItem() {} };
    adapter.sync(); assert.equal(adapter.failures.size, 0); assert.equal(notices.length, 0);
    delete kanban.getStateManager; adapter.sync(); time += 8001; adapter.sync(); assert.match(notices.pop(), /接口不兼容/);
    adapter.sync(); assert.equal(notices.length, 0);
    delete plugin.app.plugins.plugins['obsidian-kanban']; adapter.sync(); time += 8001; adapter.sync(); assert.match(notices.pop(), /需要启用 Kanban/);
    adapter.unload();
});

test('drop targets resolve to the other open board and ignore unrelated elements', () => {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/kanban-adapter'), 'utf8'), {
        module, require: name => name === 'obsidian' ? { Notice: class {} }
            : name === './drop-position' ? require('../src/drop-position') : name === './view-position' ? require('../src/view-position') : name === './board-history' ? require('../src/board-history') : name === './board-model' ? { stampBoardTransitions() {} } : name === './board-panel' ? { BoardPanel: class {} } : {},
        Map, Set, Date,
    });
    const adapter = new module.exports.KanbanAdapter({ app: { metadataCache: { getFileCache: () => ({ frontmatter: { 'obsidian-weekcraft': true } }) } } });
    const a = { _weekcraftDrop: { laneId: 'a' } }, b = { _weekcraftDrop: { laneId: 'b', group: { range: '14:00–17:00', category: '科研' } } };
    const first = { view: { file: { path: 'first.md' } }, root: { contains: target => target === a } };
    const second = { view: { file: { path: 'second.md' } }, root: { contains: target => target === b } };
    adapter.panels.set(first.view, first); adapter.panels.set(second.view, second);
    const drop = adapter.resolveDrop({ closest: () => b });
    assert.equal(drop.panel, second); assert.equal(drop.laneId, 'b'); assert.equal(drop.group.range, '14:00–17:00');
    assert.equal(adapter.resolveDrop({ closest: () => ({}) }), null);
    adapter.panels.delete(second.view);
    assert.equal(adapter.resolveDrop({ closest: () => b }), null);
});

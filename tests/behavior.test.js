const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { parseRange, completionTime, stampChanges } = require('../src/tasks');
const { insertEntry } = require('../src/schedule-data');

test('time ranges accept common input, overnight values and reject invalid times', () => {
    assert.equal(parseRange('１４．００～１７．００'), '14:00–17:00');
    assert.equal(parseRange('23-1'), '23:00–次日 01:00');
    assert.equal(parseRange('23:00–次日 01:00'), '23:00–次日 01:00');
    assert.equal(parseRange(''), null);
    for (const input of ['24-1', '12.70-13', '12-12', 'bad']) assert.throws(() => parseRange(input));
    assert.equal(completionTime(new Date('2026-10-11T01:02:00Z'), 'Asia/Shanghai'), '2026-10-11 09:02');
});

test('weekly entries land under the requested heading and ignore fenced headings', () => {
    for (const level of [2, 3, 4]) {
        const h = '#'.repeat(level);
        const content = '```text\n#### fake Mon\n```\n' + h + ' 10.05 Mon\n\n' + h + ' 10.06 Tue\n\n## Summary';
        const result = insertEntry(content, '- new\n', 'Mon');
        assert.ok(result.indexOf('- new') > result.indexOf('10.05 Mon'));
        assert.ok(result.indexOf('- new') < result.indexOf('10.06 Tue'));
        assert.ok(result.endsWith('## Summary'));
    }
    assert.throws(() => insertEntry('### 10.10 Sat\n', '- new', 'Mon'), /未找到/);
    assert.equal(insertEntry('old\n', '- new\n'), 'old\n\n- new\n');
});

test('completion stamps are added once, preserved on move and removed on undo', () => {
    const item = checked => ({ id: 'task', data: { checked, titleRaw: 'Task' } });
    const state = task => ({ children: [{ children: [task] }] });
    const manager = { updateItemContent: (task, titleRaw) => ({ ...task, data: { ...task.data, titleRaw } }) };
    const completed = stampChanges(manager, state(item(false)), state(item(true)), '2026-10-11 09:02');
    assert.match(completed.children[0].children[0].data.titleRaw, /完成于 2026-10-11 09:02/);
    assert.equal(stampChanges(manager, completed, completed, 'later'), completed);
    const undone = state({ ...completed.children[0].children[0], data: { ...completed.children[0].children[0].data, checked: false } });
    assert.equal(stampChanges(manager, completed, undone, 'later').children[0].children[0].data.titleRaw, 'Task');
});

function loadBundle(savedData = { templateFolder: 'Templates', timeZone: 'Asia/Shanghai', groupedLayout: false }) {
    class Plugin {
        async loadData() { return savedData; }
        async saveData(data) { this.saved = data; }
        addSettingTab() {}
        registerMarkdownCodeBlockProcessor(name, callback) { this.processor = callback; }
        registerEvent() {}
        registerInterval() {}
        addCommand(command) { (this.commands ||= []).push(command); }
    }
    class MarkdownRenderChild {
        constructor(el) { this.el = el; this.cleanups = []; }
        register(fn) { this.cleanups.push(fn); }
        unload() { for (const fn of this.cleanups.splice(0)) fn(); }
    }
    const obsidian = { Plugin, MarkdownRenderChild, PluginSettingTab: class {}, Setting: class {}, Modal: class {}, Notice: class {}, normalizePath: value => value.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '').replace(/\u00a0/g, ' ').normalize() };
    const sandbox = { module: { exports: {} }, require: name => { assert.equal(name, 'obsidian'); return obsidian; }, window: { setInterval() { return 1; } }, console, Intl, Date };
    vm.runInNewContext(fs.readFileSync(require.resolve('../main.js'), 'utf8'), sandbox);
    const SchedulePlugin = sandbox.module.exports;
    const onload = SchedulePlugin.prototype.onload;
    SchedulePlugin.prototype.onload = function() {
        this.app.vault ||= {};
        this.app.vault.on ||= () => {};
        this.app.workspace.getActiveFile ||= () => null;
        return onload.call(this);
    };
    return sandbox.module.exports;
}

test('bundled plugin starts without Dataview, validates and serializes settings', async () => {
    const Plugin = loadBundle();
    const plugin = new Plugin();
    plugin.app = { workspace: { on() {}, onLayoutReady(fn) { fn(); }, getLeavesOfType() { return []; } }, metadataCache: { on() {} } };
    await plugin.onload();
    assert.ok(plugin.isTemplate('Templates/weekly.md'));
    assert.ok(!plugin.isTemplate('Templates-other/weekly.md'));
    await Promise.all([plugin.changeCategories(list => [...list, '阅读']), plugin.updateSetting('laneWidth', 800)]);
    assert.ok(plugin.settings.categories.includes('阅读'));
    assert.equal(plugin.settings.laneWidth, 800);
    await assert.rejects(plugin.changeCategories(() => ['bad/name']));
    await plugin.updateSetting('laneWidth', 900);
    assert.equal(plugin.settings.laneWidth, 900);
    const messages = [];
    const el = { createEl: (tag, options) => messages.push(options.text) };
    plugin.processor('mode: weekly', el, { sourcePath: 'Templates/week.md' });
    assert.match(messages.pop(), /日程入口/);
    plugin.processor('unexpected', el, { sourcePath: 'Notes/week.md' });
    assert.match(messages.pop(), /配置无效/);
    plugin.onunload();
});

test('clean installs load with no saved data and normalize portable template paths', async () => {
    for (const saved of [null, undefined, [], { templateFolder: 'Templates\\Weekly//' }]) {
        const Plugin = loadBundle(saved === undefined ? null : saved);
        const plugin = new Plugin();
        plugin.app = { workspace: { on() {}, onLayoutReady(fn) { fn(); }, getLeavesOfType() { return []; } }, metadataCache: { on() {} } };
        await plugin.onload();
        assert.ok(Array.isArray(plugin.settings.categories));
        if (saved?.templateFolder) assert.equal(plugin.settings.templateFolder, 'Templates/Weekly');
        plugin.onunload();
    }
});

test('public and legacy board markers agree across detection and adapter; explicit false wins', async () => {
    const Plugin = loadBundle();
    const plugin = new Plugin();
    let frontmatter;
    plugin.app = {
        workspace: { on() {}, onLayoutReady(fn) { fn(); }, getLeavesOfType() { return []; } },
        metadataCache: { on() {}, getFileCache() { return { frontmatter }; } },
    };
    await plugin.onload();
    for (const [flags, expected] of [
        [{ weekcraft: true }, true],
        [{ 'obsidian-weekcraft': true }, true],
        [{ weekcraft: false, 'obsidian-weekcraft': true }, false],
        [{}, false],
    ]) {
        frontmatter = { 'kanban-plugin': 'board', ...flags };
        assert.equal(plugin.isWeekCraftBoard({ path: 'board.md' }), expected);
        assert.equal(plugin.adapter.enabled({ path: 'board.md' }), expected);
    }
    plugin.onunload();
});

test('schedule form renders and saves a batch to the chosen weekday without Dataview', async () => {
    const doc = {};
    class Element {
        constructor(tag, options = {}) {
            this.tag = tag; this.textContent = options.text || ''; this.children = []; this.events = {};
            this.attrs = { ...(options.attr || {}) }; this.value = this.attrs.value || '';
            this.ownerDocument = doc; this.style = {}; this.scrollHeight = 32;
        }
        createEl(tag, options) { const el = new Element(tag, options); this.children.push(el); return el; }
        createDiv(options) { return this.createEl('div', options); }
        setAttribute(key, value) { this.attrs[key] = value; }
        replaceChildren() { this.children = []; }
        appendChild(el) { this.children.push(el); }
        remove() { this.removed = true; }
        empty() { this.children = []; }
        focus() {}
        getBoundingClientRect() { return { left: 0, top: 0, bottom: 32, width: 100, height: 100 }; }
        all() { return [this, ...this.children.flatMap(child => child.all())]; }
    }
    doc.body = new Element('body');
    doc.defaultView = { innerWidth: 1000, innerHeight: 800, requestAnimationFrame(fn) { fn(); } };
    const Plugin = loadBundle(); const plugin = new Plugin();
    let content = '```schedule\nmode: weekly\n```\n\n### 10.10 Sat\n\n### 10.11 Sun\n\n## Summary';
    plugin.app = {
        workspace: { on() {}, onLayoutReady(fn) { fn(); }, getLeavesOfType() { return []; } },
        metadataCache: { on() {} },
        vault: { getAbstractFileByPath(path) { return { path, extension: 'md' }; }, async process(file, transform) { content = transform(content); } },
    };
    await plugin.onload();
    const root = new Element('div'); let child;
    // Real MarkdownRenderChild inherits Component.registerDomEvent; mimic its event binding.
    plugin.processor('mode: weekly', root, { sourcePath: 'Notes/week.md', addChild(component) {
        child = component;
        component.registerDomEvent = (el, event, handler) => { (el.events ||= {})[event] = handler; };
    } });
    const find = label => root.all().find(el => el.attrs['aria-label'] === label);
    assert.ok(find('选择周记日期'));
    find('选择周记日期').value = 'Sat';
    find('时间段').value = '23-1';
    find('日程事项').value = '任务一；任务二';
    await find('选择日程类别').events.click();
    await doc.body.all().find(el => el.textContent === '科研' && el.tag === 'button').events.click();
    await root.all().find(el => el.textContent === '添加').events.click();
    assert.ok(content.includes('**23:00–次日 01:00** #日程/科研'));
    assert.ok(content.includes('  - [ ] 任务一\n  - [ ] 任务二'));
    assert.ok(content.indexOf('任务一') < content.indexOf('### 10.11 Sun'));
    assert.equal(find('日程事项').value, '');
    assert.equal(plugin.scheduleChildren.size, 1);
    plugin.onunload();
    assert.equal(plugin.scheduleChildren.size, 0);
    assert.ok(doc.body.children[0].removed);
});

test('Kanban enhancement respects the note marker and restores hooks when disabled', async () => {
    const Plugin = loadBundle(); const plugin = new Plugin();
    let enabled = true;
    const classes = new Set(); const styles = new Map(); const listeners = new Map();
    const container = {
        classList: { add: name => classes.add(name), remove: name => classes.delete(name) },
        style: { setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) },
        addEventListener: (name, handler) => listeners.set(name, handler), removeEventListener: name => listeners.delete(name),
    };
    const original = function(next) { this.state = next; };
    const manager = { state: { children: [] }, setState: original, getNewItem() {}, updateItemContent() {} };
    const view = { file: { path: 'Notes/board.md' }, containerEl: container };
    plugin.app = {
        workspace: { on() {}, onLayoutReady(fn) { fn(); }, getLeavesOfType() { return [{ view }]; } },
        metadataCache: { on() {}, getFileCache() { return { frontmatter: { 'obsidian-weekcraft': enabled } }; } },
        plugins: { plugins: { 'obsidian-kanban': { getStateManager() { return manager; } } } },
    };
    await plugin.onload();
    assert.notEqual(manager.setState, original);
    assert.ok(classes.has('weekly-kanban-enhanced'));
    await plugin.updateSetting('completionTimestamps', false);
    assert.equal(manager.setState, original);
    await plugin.updateSetting('completionTimestamps', true);
    assert.notEqual(manager.setState, original);
    enabled = false; plugin.adapter.sync();
    assert.equal(manager.setState, original);
    assert.equal(listeners.size, 0);
    assert.equal(styles.size, 0);
    assert.equal(classes.size, 0);
    plugin.onunload();
});

test('new WeekCraft boards auto-open in kanban view and expose a manual open command', async () => {
    const Plugin = loadBundle(); const plugin = new Plugin();
    const file = { path: 'Notes/2026-W44.md', extension: 'md' };
    let viewState = { type: 'markdown', state: { mode: 'source' } };
    const leaf = {
        id: 'leaf-1',
        view: { getViewType: () => viewState.type },
        getViewState() { return viewState; },
        async setViewState(next) { viewState = next; this.view = { getViewType: () => next.type }; },
    };
    plugin.app = {
        workspace: {
            on() {},
            onLayoutReady(fn) { fn(); },
            getLeavesOfType() { return []; },
            activeLeaf: leaf,
            getActiveFile() { return file; },
        },
        metadataCache: {
            on() {},
            getFileCache(current) {
                return current?.path === file.path ? { frontmatter: { 'kanban-plugin': 'list', 'obsidian-weekcraft': true } } : null;
            },
        },
        vault: { on() { return {}; } },
    };
    await plugin.onload();
    plugin.pendingBoardOpen.add(file.path);
    plugin.tryAutoOpenActiveBoard();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(viewState.type, 'kanban');
    assert.equal(viewState.state.file, file.path);
    assert.equal(viewState.state.kanbanViewState['kanban-plugin'], 'list');
    viewState = { type: 'markdown', state: {} };
    leaf.view = { getViewType: () => viewState.type };
    const command = plugin.commands.find(entry => entry.id === 'open-current-board-as-kanban');
    assert.ok(command);
    assert.equal(command.checkCallback(true), true);
    await command.checkCallback(false);
    assert.equal(viewState.type, 'kanban');
    plugin.onunload();
});

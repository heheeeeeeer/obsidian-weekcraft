const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { cardInfo } = require('../src/board-model');
const mod = { exports: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../src/board-panel'), 'utf8'), { module: mod, require: name => name === 'obsidian' ? { setIcon() {}, MarkdownRenderer: { render: () => Promise.resolve() } } : name === './copy-task-form' ? {} : require('../src/' + name.slice(2)) });
const BoardPanel = mod.exports.BoardPanel;
class Element {
    constructor(options = {}) { this.children = []; this.cls = options.cls; this.text = options.text; this.dataset = {}; this.style = { setProperty() {} }; this.events = {}; this.ownerDocument = { defaultView: {} }; }
    createDiv(options) { return this.createEl('div', options); }
    createEl(tag, options) { const el = new Element(options); this.children.push(el); return el; }
    setAttribute() {} remove() { this.removed = true; } focus() {} select() {}
    after(input) { this.inserted = input; } all() { return [this, ...this.children.flatMap(el => el.all())]; }
}

test('position numbers are regenerated from display order after reordering tasks', () => {
    const panel = Object.create(BoardPanel.prototype);
    panel.plugin = { app: {}, settings: {} }; panel.view = { file: { path: 'board.md' } };
    panel.bind = () => {}; panel.dropTarget = () => {}; panel.renderTag = () => {}; panel.touchDrag = () => {};
    const a = { id: 'a', data: { titleRaw: 'A', checked: false } }, b = { id: 'b', data: { titleRaw: 'B', checked: false } };
    for (const order of [[a, b], [b, a]]) {
        const body = new Element(); panel.rowPosition = 0;
        panel.renderGroup(body, { id: 'mon' }, { range: null, items: order.map(item => ({ item, info: cardInfo(item) })) });
        const rows = body.all().filter(el => el.dataset.wcItem);
        assert.deepEqual(rows.map(el => [el.dataset.wcItem, el.dataset.wcPosition]), [[order[0].id, '1'], [order[1].id, '2']]);
    }
});

test('daily themes can be saved and removed without changing date headings or task data', async () => {
    const panel = Object.create(BoardPanel.prototype); const data = {};
    panel.view = { file: { path: 'board.md' } };
    panel.plugin = { app: { metadataCache: { getFileCache: () => ({ frontmatter: data }) }, fileManager: { processFrontMatter: async (file, fn) => fn(data) } } };
    panel.bind = (el, event, callback) => { el.events[event] = callback; };
    const button = new Element(); button.ownerDocument.createElement = () => new Element();
    panel.editDayTheme(button, '10.16 Fri'); button.inserted.value = '专心完成论文'; await button.inserted.events.blur();
    assert.equal(data['weekcraft-day-themes']['10.16 Fri'], '专心完成论文');
    panel.editDayTheme(button, '10.16 Fri'); button.inserted.value = ''; await button.inserted.events.blur();
    assert.equal(data['weekcraft-day-themes'], undefined);
});

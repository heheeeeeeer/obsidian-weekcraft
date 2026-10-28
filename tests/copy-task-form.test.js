const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { cardInfo } = require('../src/board-model');
class Element {
    constructor(options = {}) { this.attrs = options.attr || {}; this.text = options.text; this.value = ''; this.children = []; this.events = {}; this.classList = { add() {} }; }
    createDiv(options) { return this.createEl('div', options); }
    createEl(tag, options) { const el = new Element(options); el.tag = tag; this.children.push(el); return el; }
    addEventListener(type, fn) { this.events[type] = fn; } empty() { this.children = []; } focus() {}
    all() { return [this, ...this.children.flatMap(el => el.all())]; }
}
test('copy dialog selects a date and existing/custom time and persists the chosen destination', () => {
    class Modal { constructor() { this.contentEl = new Element(); this.modalEl = new Element(); } setTitle() {} close() { this.closed = true; this.onClose(); } }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/copy-task-form'), 'utf8'), { module, require: name => name === 'obsidian' ? { Modal } : require('../src/' + name.slice(2)) });
    const task = (id, raw) => ({ id, data: { titleRaw: raw, checked: false } });
    const manager = { state: { children: [{ id: 'mon', data: { title: 'Mon' }, children: [task('a', '**13:00–14:00**\nA #日程/科研')] }, { id: 'tue', data: { title: 'Tue' }, children: [task('later', '**15:00–16:00**\nLater')] }] }, getNewItem(raw) { return task('copy', raw); }, setState(fn) { this.state = fn(this.state); } };
    const panel = { plugin: { openModals: new Set() }, current: () => manager, refresh() {} };
    const form = new module.exports.CopyTaskForm({}, panel, 'a'); form.onOpen();
    const find = label => form.contentEl.all().find(el => el.attrs['aria-label'] === label);
    const date = find('目标日期'), time = find('目标时间段'), custom = find('自定义时间段');
    date.value = 'tue'; date.events.change();
    assert.ok(time.children.some(el => el.attrs.value === '15:00–16:00'));
    time.value = 'custom'; time.events.change(); assert.equal(custom.hidden, false); custom.value = '18-19';
    form.contentEl.all().find(el => el.text === '复制').events.click();
    assert.equal(form.closed, true); assert.equal(panel.plugin.openModals.size, 0);
    const added = manager.state.children[1].children.at(-1);
    assert.equal(cardInfo(added).range, '18:00–19:00'); assert.equal(cardInfo(added).category, '科研');
    assert.equal(manager.state.children[0].children.length, 1);
});

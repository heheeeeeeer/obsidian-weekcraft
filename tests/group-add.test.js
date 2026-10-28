const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { cardInfo } = require('../src/board-model');
class Element {
    constructor(tag, options = {}) {
        this.tag = tag; this.text = options.text; this.attrs = options.attr || {}; this.children = []; this.events = {}; this.value = '';
        this.classList = { add() {} };
        this.style = { setProperty() {} };
        this.ownerDocument = { defaultView: { requestAnimationFrame(fn) { fn(); } } };
    }
    createEl(tag, options) { const e = new Element(tag, options); this.children.push(e); return e; }
    createDiv(options) { return this.createEl('div', options); }
    addEventListener(name, fn) { this.events[name] = fn; }
    focus() { this.focused = true; }
    empty() { this.children = []; }
    all() { return [this, ...this.children.flatMap(e => e.all())]; }
}
test('time group add omits the time field, inherits its range and accepts no category', () => {
    class Modal { constructor() { this.modalEl = new Element('div'); this.contentEl = new Element('div'); } setTitle() {} close() { this.closed = true; } }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/kanban-form'), 'utf8'), { module, require: name => name === 'obsidian' ? { Modal } : require('../src/' + name.slice(2)) });
    const manager = { state: { children: [{ id: 'mon', data: { title: 'Mon' }, children: [] }] }, getNewItem(raw) { return { id: 'new', data: { titleRaw: raw } }; }, setState(fn) { this.state = fn(this.state); } };
    const form = new module.exports.TaskForm({}, manager, 'mon', ['科研'], { range: '14:00–17:00', fixedRange: true });
    form.onOpen();
    assert.equal(form.contentEl.all().filter(e => e.tag === 'input').length, 0);
    const tasks = form.contentEl.all().find(e => e.tag === 'textarea');
    assert.ok(tasks.focused);
    tasks.value = 'New task';
    form.contentEl.all().find(e => e.text === '添加').events.click();
    assert.ok(form.closed);
    assert.equal(cardInfo(manager.state.children[0].children[0]).range, '14:00–17:00');
    assert.equal(cardInfo(manager.state.children[0].children[0]).category, '');
});

test('untimed tasks added to a date lane are inserted at the top of that date', () => {
    class Modal { constructor() { this.modalEl = new Element('div'); this.contentEl = new Element('div'); } setTitle() {} close() { this.closed = true; } }
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/kanban-form'), 'utf8'), { module, require: name => name === 'obsidian' ? { Modal } : require('../src/' + name.slice(2)) });
    const manager = {
        state: { children: [{ id: 'backlog', data: { title: 'Todos' }, children: [] }, { id: 'mon', data: { title: 'Mon' }, children: [
            { id: 'scheduled', data: { titleRaw: '**10:30–12:30**\n已有任务 #日程/科研' } },
            { id: 'untimed', data: { titleRaw: '原无时间任务 #日程/科研' } },
        ] }] },
        getNewItem(raw) { return { id: 'new', data: { titleRaw: raw } }; },
        setState(fn) { this.state = fn(this.state); }
    };
    const form = new module.exports.TaskForm({}, manager, 'mon', ['科研']);
    form.onOpen();
    const fields = form.contentEl.all();
    fields.find(e => e.tag === 'select').value = '科研';
    fields.find(e => e.tag === 'textarea').value = '最新无时间任务';
    fields.find(e => e.text === '添加').events.click();
    assert.ok(form.closed);
    assert.equal(manager.state.children[1].children.map(item => cardInfo(item).title).join(' | '), '最新无时间任务 | 已有任务 | 原无时间任务');
    assert.equal(cardInfo(manager.state.children[1].children[0]).range, null);
});

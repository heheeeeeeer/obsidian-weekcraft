const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
class Element {
    constructor(options = {}) { this.cls = options.cls; this.text = options.text; this.attrs = options.attr || {}; this.children = []; this.events = {}; this.dataset = {}; this.style = {}; this.value = ''; this.classList = { add() {} }; }
    createEl(tag, options) { const el = new Element(options); el.tag = tag; this.children.push(el); return el; }
    createDiv(options) { return this.createEl('div', options); } createSpan(options) { return this.createEl('span', options); }
    addEventListener(type, fn) { this.events[type] = fn; } empty() { this.children = []; }
    all() { return [this, ...this.children.flatMap(el => el.all())]; }
}
class Setting { setName() { return this; } setDesc() { return this; } addToggle(fn) { fn({ setValue() { return this; }, onChange() { return this; } }); return this; } }
const moduleStub = { exports: {} };
vm.runInNewContext(fs.readFileSync(require.resolve('../src/category-settings'), 'utf8'), { module: moduleStub, require: name => name === 'obsidian' ? { Setting, setIcon() {} } : require('../src/' + name.slice(2)) });
const { renderCategorySettings, reorderCategory } = moduleStub.exports;
test('category drag ordering changes positions without losing categories', () => {
    const original = ['科研', '生活', '运动'];
    assert.equal([...reorderCategory(original, '科研', '运动', true)].join(','), '生活,运动,科研');
    assert.equal([...reorderCategory(original, '运动', '科研')].join(','), '运动,科研,生活');
    assert.equal(original.join(','), '科研,生活,运动');
    assert.equal(reorderCategory(original, 'missing', '科研'), original);
});
test('list UI adds without Enter, rejects duplicates, resets colors, and removes only the selected category', async () => {
    const plugin = { settings: { categories: ['科研', '生活'], categoryColors: { 科研: '#112233' }, automaticCategorySorting: true },
        async changeCategories(fn) { this.settings = { ...this.settings, categories: fn([...this.settings.categories]) }; },
        async enqueueSettings(fn) { this.settings = fn(this.settings); } };
    const root = new Element(); renderCategorySettings(root, plugin);
    const find = label => root.all().find(el => el.attrs['aria-label'] === label);
    find('新类别名称').value = '工作'; await root.all().find(el => el.text === '＋ 添加').events.click();
    assert.equal(plugin.settings.categories.join(','), '科研,生活,工作');
    find('新类别名称').value = '工作'; await root.all().find(el => el.text === '＋ 添加').events.click();
    assert.equal(plugin.settings.categories.length, 3);
    assert.ok(root.all().find(el => el.cls === 'weekcraft-category-error').textContent.includes('已经存在'));
    find('生活的标签颜色').value = '#abcdef'; await find('生活的标签颜色').events.change();
    assert.equal(plugin.settings.categoryColors.生活, '#abcdef');
    await find('恢复 科研 的默认颜色').events.click(); assert.equal(plugin.settings.categoryColors.科研, undefined);
    await find('删除类别 生活').events.click(); assert.equal(plugin.settings.categories.join(','), '科研,工作');
    assert.equal(plugin.settings.categoryColors.生活, '#abcdef');
});

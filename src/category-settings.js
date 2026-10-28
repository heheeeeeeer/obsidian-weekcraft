const { Setting, setIcon } = require('obsidian');
const { categoryColor } = require('./category-colors');

function reorderCategory(names, source, target, after = false) {
    if (source === target || !names.includes(source) || !names.includes(target)) return names;
    const next = names.filter(name => name !== source);
    next.splice(next.indexOf(target) + (after ? 1 : 0), 0, source);
    return next;
}
function renderCategorySettings(container, plugin) {
    container.classList.add('weekcraft-category-panel');
    const card = container.createDiv({ cls: 'weekcraft-category-card' });
    const header = card.createDiv({ cls: 'weekcraft-category-heading' });
    header.createEl('h4', { text: '类别列表' });
    header.createEl('span', { text: '可拖动排序', cls: 'weekcraft-category-muted' });
    const addRow = card.createDiv({ cls: 'weekcraft-category-add' });
    const input = addRow.createEl('input', { attr: { type: 'text', placeholder: '输入新类别名称…', 'aria-label': '新类别名称' } });
    const add = addRow.createEl('button', { cls: 'mod-cta', text: '＋ 添加' });
    card.createDiv({ cls: 'weekcraft-category-hint', text: '输入名称后点击添加即可，无须专门按回车。' });
    const error = card.createDiv({ cls: 'weekcraft-category-error', attr: { role: 'status' } });
    const list = card.createDiv({ cls: 'weekcraft-category-list' });
    const note = card.createDiv({ cls: 'weekcraft-category-hint weekcraft-category-note' });
    setIcon(note.createSpan({ attr: { 'aria-hidden': 'true' } }), 'info');
    note.createSpan({ text: '删除类别不会删除已有任务。' });
    let disposed = false, busy = false, stopDrag = null;
    const run = async action => {
        if (busy || disposed) return;
        busy = true; add.disabled = true; error.textContent = '';
        try { await action(); if (!disposed) render(); }
        catch (e) { if (!disposed) error.textContent = e.message; }
        finally { busy = false; if (!disposed) add.disabled = false; }
    };
    const addCategory = () => run(async () => {
        const name = input.value.normalize('NFKC').trim();
        if (!name) throw new Error('请输入类别名称。');
        await plugin.changeCategories(names => {
            if (names.includes(name)) throw new Error('这个类别已经存在。');
            return [...names, name];
        });
        input.value = '';
    });
    add.addEventListener('click', addCategory);
    input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); addCategory(); } });
    const render = () => {
        list.empty();
        for (const name of plugin.settings.categories) {
            const row = list.createDiv({ cls: 'weekcraft-category-row' }); row.dataset.category = name;
            const grip = row.createEl('button', { cls: 'weekcraft-category-grip', attr: { 'aria-label': '拖动排序 ' + name + '，也可用上下方向键调整' } });
            setIcon(grip, 'grip-vertical');
            const dot = row.createSpan({ cls: 'weekcraft-category-dot', attr: { 'aria-hidden': 'true' } });
            row.createSpan({ text: name, cls: 'weekcraft-category-name' });
            const actions = row.createDiv({ cls: 'weekcraft-category-actions' });
            const colorLabel = actions.createEl('label', { cls: 'weekcraft-category-color' });
            setIcon(colorLabel.createSpan({ attr: { 'aria-hidden': 'true' } }), 'palette');
            const color = colorLabel.createEl('input', { attr: { type: 'color', 'aria-label': name + '的标签颜色' } });
            const paint = () => { const value = categoryColor(name, plugin.settings); dot.style.backgroundColor = value; color.value = value; };
            paint();
            color.addEventListener('change', () => run(() => plugin.enqueueSettings(settings => ({ ...settings, categoryColors: { ...settings.categoryColors, [name]: color.value } }))));
            const reset = actions.createEl('button', { cls: 'weekcraft-category-icon', attr: { 'aria-label': '恢复 ' + name + ' 的默认颜色' } }); setIcon(reset, 'rotate-ccw');
            reset.addEventListener('click', () => run(() => plugin.enqueueSettings(settings => { const categoryColors = { ...settings.categoryColors }; delete categoryColors[name]; return { ...settings, categoryColors }; })));
            const remove = actions.createEl('button', { cls: 'weekcraft-category-icon is-delete', attr: { 'aria-label': '删除类别 ' + name } }); setIcon(remove, 'trash-2');
            remove.addEventListener('click', () => run(() => plugin.changeCategories(names => names.filter(item => item !== name))));
            grip.addEventListener('keydown', event => {
                if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return;
                event.preventDefault();
                const names = plugin.settings.categories, index = names.indexOf(name), next = index + (event.key === 'ArrowUp' ? -1 : 1);
                if (next < 0 || next >= names.length) return;
                const target = names[next];
                run(async () => { await plugin.changeCategories(names => reorderCategory(names, name, target, event.key === 'ArrowDown')); }).then(() => {
                    [...list.querySelectorAll('.weekcraft-category-row')].find(item => item.dataset.category === name)?.querySelector('button')?.focus({ preventScroll: true });
                });
            });
            grip.addEventListener('pointerdown', event => {
                if (event.button !== 0 || busy) return;
                event.preventDefault(); stopDrag?.();
                const doc = row.ownerDocument, view = doc.defaultView;
                const startY = event.clientY; let target = null, after = false, moved = false;
                const clear = () => list.querySelectorAll('.is-insert-before, .is-insert-after').forEach(el => el.classList.remove('is-insert-before', 'is-insert-after'));
                const move = e => {
                    if (e.pointerId !== event.pointerId || Math.abs(e.clientY - startY) < 4 && !moved) return;
                    moved = true; row.classList.add('is-dragging'); clear();
                    const hit = doc.elementFromPoint(e.clientX, e.clientY)?.closest('.weekcraft-category-row');
                    target = hit && list.contains(hit) && hit !== row ? hit.dataset.category : null;
                    if (target) { const rect = hit.getBoundingClientRect(); after = e.clientY > rect.top + rect.height / 2; hit.classList.add(after ? 'is-insert-after' : 'is-insert-before'); }
                };
                const cleanup = () => { view.removeEventListener('pointermove', move, true); view.removeEventListener('pointerup', finish, true); view.removeEventListener('pointercancel', cleanup, true); view.removeEventListener('blur', cleanup, true); row.classList.remove('is-dragging'); clear(); stopDrag = null; };
                const finish = e => { if (e.pointerId !== event.pointerId) return; cleanup(); if (moved && target) run(() => plugin.changeCategories(names => reorderCategory(names, name, target, after))); };
                stopDrag = cleanup;
                view.addEventListener('pointermove', move, true); view.addEventListener('pointerup', finish, true); view.addEventListener('pointercancel', cleanup, true); view.addEventListener('blur', cleanup, true);
            });
        }
        if (!plugin.settings.categories.length) list.createDiv({ cls: 'weekcraft-category-hint', text: '还没有类别，在上方添加一个。' });
    };
    render();
    const sortCard = container.createDiv({ cls: 'weekcraft-category-sort' });
    const icon = sortCard.createDiv({ cls: 'weekcraft-category-sort-icon', attr: { 'aria-hidden': 'true' } }); setIcon(icon, 'list-ordered');
    new Setting(sortCard).setName('按类别自动排序').setDesc('待办事项按上方的类别顺序排列。')
        .addToggle(control => control.setValue(plugin.settings.automaticCategorySorting).onChange(value => plugin.updateSetting('automaticCategorySorting', value)));
    return () => { disposed = true; stopDrag?.(); };
}
module.exports = { renderCategorySettings, reorderCategory };

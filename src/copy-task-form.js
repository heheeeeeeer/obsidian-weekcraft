const { Modal } = require('obsidian');
const { cardInfo, orderedTimeGroups, copyTask } = require('./board-model');
const { parseRange } = require('./tasks');
const { suppressHoverHints } = require('./hover-hints');
class CopyTaskForm extends Modal {
    constructor(app, panel, id) { super(app); this.panel = panel; this.id = id; }
    onOpen() {
        this.panel.plugin.openModals?.add(this);
        this.modalEl.classList.add('weekly-kanban-task-modal'); this.setTitle('复制任务');
        const manager = this.panel.current();
        const sourceLane = manager.state.children.find(lane => lane.children.some(item => item.id === this.id));
        if (!sourceLane) { this.close(); return; }
        const originalRange = cardInfo(sourceLane.children.find(item => item.id === this.id)).range;
        const dateBox = this.contentEl.createDiv({ cls: 'wk-input-box' });
        const date = dateBox.createEl('select', { attr: { 'aria-label': '目标日期' } });
        for (const lane of manager.state.children) date.createEl('option', { text: lane.data.title, attr: { value: lane.id } });
        date.value = sourceLane.id;
        const timeBox = this.contentEl.createDiv({ cls: 'wk-input-box weekcraft-copy-time' });
        const time = timeBox.createEl('select', { attr: { 'aria-label': '目标时间段' } });
        const custom = this.contentEl.createEl('input', { attr: { type: 'text', placeholder: '例如 14.00-17.00', 'aria-label': '自定义时间段' } });
        custom.hidden = true;
        const fillTimes = () => {
            time.empty(); time.createEl('option', { text: '不设置时间', attr: { value: '' } });
            const lane = this.panel.current().state.children.find(item => item.id === date.value);
            const ranges = new Set(orderedTimeGroups(lane).map(group => group.range));
            if (originalRange) ranges.add(originalRange);
            for (const range of [...ranges].sort()) time.createEl('option', { text: range, attr: { value: range } });
            time.createEl('option', { text: '自定义时间…', attr: { value: 'custom' } });
            time.value = originalRange || ''; custom.hidden = true;
        };
        fillTimes(); date.addEventListener('change', fillTimes);
        time.addEventListener('change', () => { custom.hidden = time.value !== 'custom'; if (!custom.hidden) custom.focus(); });
        const error = this.contentEl.createDiv({ cls: 'wk-form-error', attr: { role: 'status' } });
        const actions = this.contentEl.createDiv({ cls: 'wk-form-actions' });
        actions.createEl('button', { text: '取消' }).addEventListener('click', () => this.close());
        const submit = actions.createEl('button', { text: '复制', cls: 'mod-cta' });
        let saving = false;
        submit.addEventListener('click', () => {
            if (saving) return;
            try {
                const range = parseRange(time.value === 'custom' ? custom.value : time.value);
                saving = true; copyTask(this.panel.current(), this.id, date.value, range);
                this.close(); this.panel.refresh();
            } catch (e) { saving = false; error.textContent = e.message; }
        });
        this.stopHints = suppressHoverHints(this.modalEl);
    }
    onClose() { this.panel.plugin.openModals?.delete(this); this.stopHints?.(); this.contentEl.empty(); }
}
module.exports = { CopyTaskForm };

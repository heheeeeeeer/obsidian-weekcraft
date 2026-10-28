const { Plugin, MarkdownRenderChild, Notice } = require('obsidian');
const { normalizeSettings, validateCategories, ScheduleSettingsTab } = require('./settings');
const { renderSchedule } = require('./schedule-form');
const { KanbanAdapter } = require('./kanban-adapter');
const { TimestampService } = require('./timestamp-service');

const BOARD_FLAG = 'weekcraft';
const KANBAN_VIEW = 'kanban';

class ScheduleHelper extends Plugin {
    async onload() {
        this.settings = normalizeSettings(await this.loadData());
        this.settingsQueue = Promise.resolve();
        this.openModals = new Set();
        this.scheduleChildren = new Set();
        this.pendingBoardOpen = new Set();
        this.openingBoards = new Set();
        this.adapter = new KanbanAdapter(this);
        this.timestamps = new TimestampService(this);
        this.timestamps.start();
        this.addSettingTab(new ScheduleSettingsTab(this.app, this));
        this.registerMarkdownCodeBlockProcessor('schedule', (source, el, context) => {
            if (context.frontmatter?.['schedule-template'] === true || this.isTemplate(context.sourcePath)) {
                el.createEl('p', { text: '日程入口：在由此模板创建的日记或周记中添加日程。' });
                return;
            }
            const options = { weekly: false };
            for (const line of source.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
                if (line === 'mode: weekly') options.weekly = true;
                else if (line === 'mode: daily') options.weekly = false;
                else if (/^day: (Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(line)) options.day = line.slice(5);
                else { el.createEl('p', { text: '日程配置无效。请使用 mode: daily、mode: weekly 或 day: Mon 等日期。' }); return; }
            }
            const child = new MarkdownRenderChild(el);
            this.scheduleChildren.add(child);
            child.register(() => { this.scheduleChildren.delete(child); el.empty(); });
            context.addChild(child);
            try { renderSchedule(this, el, child, context, options); }
            catch (error) { child.unload(); el.createEl('p', { text: `日程表单加载失败：${error.message}` }); }
        });
        const sync = () => { this.adapter.sync(); this.tryAutoOpenActiveBoard(); };
        this.registerEvent(this.app.workspace.on('layout-change', sync));
        this.registerEvent(this.app.workspace.on('active-leaf-change', sync));
        this.registerEvent(this.app.workspace.on('file-open', sync));
        this.registerEvent(this.app.metadataCache.on('changed', sync));
        this.registerEvent(this.app.vault.on('create', file => {
            if (file?.extension === 'md') this.pendingBoardOpen.add(file.path);
            this.tryAutoOpenActiveBoard();
        }));
        this.registerInterval(window.setInterval(sync, 700));
        this.app.workspace.onLayoutReady(sync);
        this.addCommand({ id: 'enable-weekly-board', name: '启用当前看板的日程增强', checkCallback: checking => {
            const file = this.app.workspace.getActiveFile();
            if (!file || !this.app.metadataCache.getFileCache(file)?.frontmatter?.['kanban-plugin']) return false;
            if (!checking) this.app.fileManager.processFrontMatter(file, data => { data[BOARD_FLAG] = true; })
                .then(() => new Notice('已启用当前看板的日程增强。')).catch(() => new Notice('启用失败，请重试。'));
            return true;
        }});
        this.addCommand({ id: 'open-current-board-as-kanban', name: '以 Kanban 视图打开当前看板', checkCallback: checking => {
            const leaf = this.app.workspace.activeLeaf;
            const file = this.app.workspace.getActiveFile();
            if (!leaf || !file || !this.isWeekCraftBoard(file)) return false;
            if (!checking) this.openBoardAsKanban(leaf, file, true).catch(() => new Notice('切换到 Kanban 视图失败，请重试。'));
            return true;
        }});
    }
    isTemplate(path) {
        const folder = this.settings.templateFolder;
        return Boolean(folder && path.startsWith(folder + '/'));
    }
    isWeekCraftBoard(file) {
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return Boolean((frontmatter?.[BOARD_FLAG] ?? frontmatter?.['obsidian-weekcraft']) === true && frontmatter?.['kanban-plugin']);
    }
    async openBoardAsKanban(leaf, file, force = false) {
        if (!leaf || !file || !this.app.metadataCache.getFileCache(file)?.frontmatter?.['kanban-plugin']) return false;
        const current = typeof leaf.getViewState === 'function' ? leaf.getViewState() : { type: leaf.view?.getViewType?.() || 'markdown', state: {} };
        if (current?.type === KANBAN_VIEW) return true;
        if (!force && current?.type && current.type !== 'markdown') return false;
        const token = `${leaf.id || 'active'}:${file.path}`;
        if (this.openingBoards.has(token) || typeof leaf.setViewState !== 'function') return false;
        this.openingBoards.add(token);
        try {
            const kanbanPlugin = this.app.metadataCache.getFileCache(file)?.frontmatter?.['kanban-plugin'] || 'list';
            await leaf.setViewState({
                ...current,
                type: KANBAN_VIEW,
                state: {
                    ...(current?.state || {}),
                    file: file.path,
                    kanbanViewState: { ...(current?.state?.kanbanViewState || {}), 'kanban-plugin': kanbanPlugin },
                },
            });
            return true;
        } finally { this.openingBoards.delete(token); }
    }
    tryAutoOpenActiveBoard() {
        if (!this.settings.autoOpenNewBoards) return;
        const leaf = this.app.workspace.activeLeaf;
        const file = this.app.workspace.getActiveFile?.();
        if (!leaf || !file || !this.pendingBoardOpen.has(file.path) || !this.isWeekCraftBoard(file)) return;
        const type = leaf.view?.getViewType?.() || leaf.getViewState?.()?.type;
        if (type === KANBAN_VIEW) { this.pendingBoardOpen.delete(file.path); return; }
        this.openBoardAsKanban(leaf, file).then(opened => { if (opened) this.pendingBoardOpen.delete(file.path); }).catch(() => {});
    }
    enqueueSettings(transform) {
        const operation = this.settingsQueue.then(async () => {
            const next = normalizeSettings(transform(this.settings));
            await this.saveData(next);
            this.settings = next;
            this.adapter.sync();
        });
        this.settingsQueue = operation.catch(() => {});
        return operation;
    }
    updateSetting(key, value) { return this.enqueueSettings(settings => ({ ...settings, [key]: value })); }
    changeCategories(transform) {
        return this.enqueueSettings(settings => ({ ...settings, categories: validateCategories(transform([...settings.categories])) }));
    }
    onunload() {
        this.timestamps?.stop();
        this.adapter?.unload();
        for (const modal of this.openModals || []) modal.close();
        for (const child of this.scheduleChildren || []) child.unload();
    }
}
module.exports = ScheduleHelper;

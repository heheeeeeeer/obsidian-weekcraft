// All access to the community Kanban plugin's internal state and DOM stays here.
const { Notice } = require('obsidian');
const { TaskForm } = require('./kanban-form');
const { stampBoardTransitions } = require('./board-model');
const { BoardPanel } = require('./board-panel');
const { transferTask } = require('./board-transfer');
const { dropPosition } = require('./drop-position');
const { captureViewPosition } = require('./view-position');
const { BoardHistory, snapshot } = require('./board-history');

const BOARD_FLAG = 'weekcraft';

class KanbanAdapter {
    constructor(plugin) {
        this.plugin = plugin;
        this.patches = new Map();
        this.bindings = new Map();
        this.panels = new Map();
        this.failures = new Map();
        this.now = () => Date.now();
        this.activeDrag = null;
        this.transferBusy = false;
        this.history = new BoardHistory();
        this.historyDocuments = new Map();
    }
    enabled(file) {
        const frontmatter = this.plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        return (frontmatter?.[BOARD_FLAG] ?? frontmatter?.['obsidian-weekcraft']) === true;
    }
    manager(file) {
        return this.connection(file).manager;
    }
    connection(file) {
        const kanban = this.plugin.app.plugins?.plugins?.['obsidian-kanban'];
        if (!kanban) return { kind: 'missing', manager: null };
        if (typeof kanban.getStateManager !== 'function') return { kind: 'incompatible', manager: null };
        try {
            const manager = kanban.getStateManager(file);
            if (!manager || !Array.isArray(manager.state?.children)) return { kind: 'pending', manager: null };
            return ['setState', 'updateItemContent', 'getNewItem'].every(key => typeof manager[key] === 'function')
                ? { kind: 'ready', manager } : { kind: 'incompatible', manager: null };
        } catch { return { kind: 'pending', manager: null }; }
    }
    patch(manager, file) {
        if (this.patches.has(manager)) return;
        const original = manager.setState;
        const adapter = this;
        const wrapped = function(value, shouldSave = true) {
            const previous = snapshot(this.state);
            let next = typeof value === 'function' ? value(previous) : value;
            if (!adapter.history.replaying && shouldSave && next?.children && adapter.enabled(file) && adapter.plugin.settings.completionTimestamps) {
                next = stampBoardTransitions(this, previous, next, adapter.plugin.settings);
            }
            const positions = [...adapter.panels.values()].filter(panel => panel.root?.ownerDocument && panel.root?.querySelectorAll).map(panel => captureViewPosition(panel.root));
            const result = original.call(this, next, shouldSave);
            if (shouldSave) adapter.history.record([{ manager: this, before: previous, after: this.state }]);
            for (const panel of adapter.panels.values()) panel.refresh();
            for (const restore of positions) restore();
            return result;
        };
        manager.setState = wrapped;
        this.patches.set(manager, { original, wrapped });
    }
    sync() {
        const activeViews = new Set();
        const activeManagers = new Set();
        const openPaths = new Set();
        for (const leaf of this.plugin.app.workspace.getLeavesOfType('kanban')) {
            const view = leaf.view;
            if (!view.file || !this.enabled(view.file)) continue;
            openPaths.add(view.file.path);
            const connection = this.connection(view.file);
            const manager = connection.manager;
            if (!manager) {
                const path = view.file.path;
                let failure = this.failures.get(path);
                if (!failure || failure.kind !== connection.kind) {
                    failure = { kind: connection.kind, since: this.now(), notified: false }; this.failures.set(path, failure);
                }
                const grace = connection.kind === 'pending' ? 30000 : 8000;
                if (!failure.notified && this.now() - failure.since >= grace) {
                    const message = connection.kind === 'missing' ? 'WeekCraft 看板需要启用 Kanban 社区插件。'
                        : connection.kind === 'pending' ? '此看板加载尚未完成，请关闭后重新打开；WeekCraft 会继续尝试连接。'
                        : 'WeekCraft 与当前 Kanban 接口不兼容，请检查两个插件的版本。基础看板仍可使用。';
                    new Notice(message); failure.notified = true;
                }
                continue;
            }
            this.failures.delete(view.file.path);
            activeViews.add(view); activeManagers.add(manager);
            if (this.plugin.settings.completionTimestamps || this.plugin.settings.groupedLayout) this.patch(manager, view.file);
            const container = view.containerEl;
            container.classList.add('weekly-kanban-enhanced');
            container.style.setProperty('--wk-lane-width', `${this.plugin.settings.laneWidth}px`);
            if (this.plugin.settings.groupedLayout && typeof (view.contentEl || container).createDiv === 'function') {
                container.classList.add('weekcraft-grouped-view');
                if (!this.panels.has(view)) this.panels.set(view, new BoardPanel(this, view));
                this.listenHistory(container.ownerDocument);
                this.panels.get(view).refresh();
            } else if (this.panels.has(view)) {
                this.panels.get(view).destroy(); this.panels.delete(view); container.classList.remove('weekcraft-grouped-view');
            }
            if (this.bindings.has(view)) continue;
            const click = event => {
                if (!this.plugin.settings.enhanceTaskForm || !this.enabled(view.file)) return;
                const button = event.target.closest?.('.kanban-plugin__new-item-button');
                if (!button || !container.contains(button)) return;
                const wrapper = button.closest('.kanban-plugin__lane-wrapper');
                const wrappers = [...container.querySelectorAll('.kanban-plugin__lane-wrapper')];
                const current = this.manager(view.file);
                const title = wrapper?.querySelector('.kanban-plugin__lane-title')?.textContent?.trim();
                const lane = current?.state.children.find(item => item.data.title === title) || current?.state.children[wrappers.indexOf(wrapper)];
                if (!lane) return;
                event.preventDefault(); event.stopImmediatePropagation();
                this.openForm(view, lane.id);
            };
            container.addEventListener('click', click, true);
            this.bindings.set(view, click);
        }
        for (const [view, click] of this.bindings) if (!activeViews.has(view)) this.unbind(view, click);
        for (const path of this.failures.keys()) if (!openPaths.has(path)) this.failures.delete(path);
        for (const [manager, patch] of this.patches) {
            if (!activeManagers.has(manager) || (!this.plugin.settings.completionTimestamps && !this.plugin.settings.groupedLayout)) this.unpatch(manager, patch);
        }
    }
    listenHistory(doc) {
        if (!doc?.addEventListener || this.historyDocuments.has(doc)) return;
        const keydown = event => {
            if (event.isComposing || event.altKey || !(event.ctrlKey || event.metaKey)) return;
            const key = event.key.toLowerCase();
            if (key !== 'z' && !(event.ctrlKey && key === 'y')) return;
            if (event.target?.closest?.('textarea, input:not([type="checkbox"]):not([type="radio"]):not([type="button"]), [contenteditable="true"]') || this.plugin.openModals?.size) return;
            const active = this.plugin.app.workspace.activeLeaf?.view;
            const panel = [...this.panels.values()].find(panel => panel.root.ownerDocument === doc && (panel.view === active || panel.root.contains(event.target)));
            if (!panel) return;
            const manager = panel.current(); if (!manager || this.transferBusy) return;
            event.preventDefault(); event.stopImmediatePropagation(); panel.closeMenu?.();
            try { this.history.apply(manager, event.shiftKey || key === 'y'); }
            catch (error) { new Notice(error.message); }
        };
        doc.addEventListener('keydown', keydown, true); this.historyDocuments.set(doc, keydown);
    }
    openForm(view, laneId, options = {}) {
        if (this.plugin.openModals.size) return;
        const manager = this.manager(view.file); if (!manager) return;
        const modal = new TaskForm(this.plugin.app, manager, laneId, this.plugin.settings.categories, options);
        this.plugin.openModals.add(modal);
        const onClose = modal.onClose.bind(modal);
        modal.onClose = () => { this.plugin.openModals.delete(modal); onClose(); };
        modal.open();
    }
    clearDropTargets() {
        for (const panel of this.panels.values()) panel.root.querySelectorAll('.is-drop-target, .weekcraft-drop-before, .weekcraft-drop-after').forEach(el => el.classList.remove('is-drop-target', 'weekcraft-drop-before', 'weekcraft-drop-after'));
    }
    resolveDrop(element, clientY) {
        const target = element?.closest('[data-wc-lane]');
        if (!target) return null;
        for (const panel of this.panels.values()) {
            if (panel.root.contains(target) && this.enabled(panel.view.file)) return { panel, ...dropPosition(target, clientY) };
        }
        return null;
    }
    async finishDrop(drag, drop) {
        if (this.transferBusy || !drag || !drop) return;
        const source = drag.panel, target = drop.panel;
        if (source.view.file?.path !== drag.path) return;
        const sourceManager = source.current(), targetManager = target.current();
        if (!sourceManager || !targetManager) return;
        if (source.view.file.path === target.view.file.path) { target.move(drag.id, drop.laneId, drop.group, drop.beforeId); return; }
        const sourcePath = source.view.file.path, targetPath = target.view.file.path;
        const saveView = (manager, fallback) => manager.getAView?.() || fallback;
        for (const [manager, view, path] of [[sourceManager, source.view, sourcePath], [targetManager, target.view, targetPath]]) {
            const primary = saveView(manager, view);
            if (typeof primary.save !== 'function' || primary.file?.path !== path) {
                new Notice('当前看板无法确认文件保存，原任务未移动。请关闭后重新打开两个看板。'); return;
            }
        }
        const transferBefore = [{ manager: sourceManager, before: snapshot(sourceManager.state) }, { manager: targetManager, before: snapshot(targetManager.state) }];
        this.history.suspended++;
        this.transferBusy = true;
        if (source.root.dataset) source.root.dataset.wcMovingItem = drag.id;
        source.root.classList.add('weekcraft-transfer-busy'); target.root.classList.add('weekcraft-transfer-busy');
        try {
            await transferTask({ sourceManager, targetManager, sourcePath, targetPath, id: drag.id,
                laneId: drop.laneId, group: drop.group, beforeId: drop.beforeId,
                persist: async (manager, path) => {
                    if (manager.hasError?.()) throw new Error('看板解析存在错误。');
                    const fallback = path === sourcePath ? source.view : target.view;
                    if (!this.panels.has(fallback)) throw new Error('看板已关闭。');
                    const primary = saveView(manager, fallback);
                    if (primary.file?.path !== path || typeof primary.save !== 'function') throw new Error('看板已关闭或切换。');
                    await primary.save();
                } });
        } catch (error) { new Notice(error.message); }
        finally {
            this.transferBusy = false;
            this.history.suspended--;
            this.history.record(transferBefore.map(change => ({ ...change, after: change.manager.state })));
            source.root.classList.remove('weekcraft-transfer-busy'); target.root.classList.remove('weekcraft-transfer-busy');
            source.refresh(); target.refresh(); this.clearDropTargets();
            if (source.root.dataset) delete source.root.dataset.wcMovingItem;
        }
    }
    unbind(view, click) {
        view.containerEl.removeEventListener('click', click, true);
        view.containerEl.classList.remove('weekly-kanban-enhanced');
        view.containerEl.classList.remove('weekcraft-grouped-view');
        view.containerEl.style.removeProperty('--wk-lane-width');
        this.panels.get(view)?.destroy(); this.panels.delete(view);
        this.bindings.delete(view);
    }
    unpatch(manager, patch) {
        if (manager.setState === patch.wrapped) manager.setState = patch.original;
        this.patches.delete(manager);
        this.history.forget(manager);
    }
    unload() {
        for (const [doc, handler] of this.historyDocuments) doc.removeEventListener('keydown', handler, true);
        this.historyDocuments.clear();
        this.activeDrag = null;
        for (const [view, click] of this.bindings) this.unbind(view, click);
        for (const [manager, patch] of this.patches) this.unpatch(manager, patch);
    }
}
module.exports = { KanbanAdapter };

const { Notice } = require('obsidian');
const { changedTasks, applyTaskChanges } = require('./timestamps');

class TimestampService {
    constructor(plugin) {
        this.plugin = plugin;
        this.snapshots = new Map();
        this.queues = new Map();
        this.writingEditors = new WeakSet();
        this.pendingEditors = new WeakSet();
        this.stopped = false;
    }
    eligible(file) {
        return file?.extension === 'md' && !this.plugin.isTemplate(file.path)
            && !this.plugin.app.metadataCache.getFileCache(file)?.frontmatter?.['kanban-plugin'];
    }
    start() {
        const { app } = this.plugin;
        this.plugin.registerEvent(app.workspace.on('editor-change', (editor, view) => this.queueEditorChange(editor, view.file)));
        this.plugin.registerEvent(app.workspace.on('file-open', file => this.prime(file)));
        this.plugin.registerEvent(app.vault.on('modify', file => this.fileChanged(file)));
        this.plugin.registerEvent(app.vault.on('delete', file => this.snapshots.delete(file.path)));
        this.plugin.registerEvent(app.vault.on('rename', (file, oldPath) => {
            const old = this.snapshots.get(oldPath); this.snapshots.delete(oldPath);
            if (old !== undefined) this.snapshots.set(file.path, old);
        }));
        app.workspace.onLayoutReady(() => {
            for (const leaf of app.workspace.getLeavesOfType('markdown')) {
                const view = leaf.view;
                if (this.eligible(view.file) && view.editor) this.snapshots.set(view.file.path, view.editor.getValue());
            }
            this.prime(app.workspace.getActiveFile());
        });
    }
    queueEditorChange(editor, file) {
        if (this.stopped || this.writingEditors.has(editor) || this.pendingEditors.has(editor)) return;
        this.pendingEditors.add(editor);
        // Dispatch after CodeMirror's current update completes. Read fresh editor text then,
        // so fast toggles or typing cannot be overwritten by a captured older snapshot.
        Promise.resolve().then(() => {
            this.pendingEditors.delete(editor);
            this.editorChanged(editor, file);
        }).catch(error => { console.error('WeekCraft editor timestamp:', error); });
    }
    async prime(file) {
        if (!this.eligible(file) || this.stopped || this.snapshots.has(file.path)) return;
        try {
            const content = await this.plugin.app.vault.read(file);
            if (!this.stopped && !this.snapshots.has(file.path)) this.snapshots.set(file.path, content);
        } catch { /* A note may be closed/deleted while reading it. */ }
    }
    editorChanged(editor, file) {
        if (this.stopped || !this.eligible(file) || this.writingEditors.has(editor)) return;
        const current = editor.getValue();
        const previous = this.snapshots.get(file.path);
        this.snapshots.set(file.path, current);
        if (previous === undefined || !this.plugin.settings.automaticTimestamps) return;
        const changes = changedTasks(previous, current, this.plugin.settings);
        if (!changes.length) return;
        this.writingEditors.add(editor);
        try {
            editor.transaction({ changes: changes.map(change => ({
                from: { line: change.index, ch: 0 }, to: { line: change.index, ch: change.oldLine.length }, text: change.line,
            })) });
            this.snapshots.set(file.path, editor.getValue());
        } finally { this.writingEditors.delete(editor); }
    }
    fileChanged(file) {
        if (this.stopped || !this.eligible(file)) return;
        const previousQueue = this.queues.get(file.path) || Promise.resolve();
        const job = previousQueue.catch(() => {}).then(async () => {
            if (this.stopped) return;
            // An editing view owns its unsaved text. Never replace it with vault content.
            const editing = this.plugin.app.workspace.getLeavesOfType('markdown').find(leaf =>
                leaf.view.file?.path === file.path && leaf.view.getMode?.() !== 'preview');
            if (editing?.view.editor) { this.editorChanged(editing.view.editor, file); return; }
            const current = await this.plugin.app.vault.read(file);
            const previous = this.snapshots.get(file.path);
            const changes = previous !== undefined && this.plugin.settings.automaticTimestamps
                ? changedTasks(previous, current, this.plugin.settings) : [];
            if (!changes.length) { this.snapshots.set(file.path, current); return; }
            await this.plugin.app.vault.process(file, current => {
                if (this.stopped) return current;
                const changes = previous !== undefined && this.plugin.settings.automaticTimestamps
                    ? changedTasks(previous, current, this.plugin.settings) : [];
                const next = applyTaskChanges(current, changes);
                this.snapshots.set(file.path, next);
                return next;
            });
        });
        this.queues.set(file.path, job);
        job.catch(error => { console.error('WeekCraft timestamp:', error); new Notice('完成时间保存失败，请重试。'); })
            .finally(() => { if (this.queues.get(file.path) === job) this.queues.delete(file.path); });
    }
    stop() { this.stopped = true; this.snapshots.clear(); }
}
module.exports = { TimestampService };

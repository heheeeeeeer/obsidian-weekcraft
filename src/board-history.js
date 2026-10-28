function snapshot(board) {
    return { ...board, children: board.children.map(lane => ({ ...lane, data: { ...lane.data }, children: lane.children.map(item => ({ ...item, data: { ...item.data } })) })) };
}
function signature(board) {
    return JSON.stringify(board.children.map(lane => [lane.id, lane.data, lane.children.map(item => [item.id, item.data.titleRaw, item.data.checked, item.data.checkChar])]));
}
class BoardHistory {
    constructor() { this.stacks = new Map(); this.replaying = false; this.suspended = 0; }
    stack(manager) { if (!this.stacks.has(manager)) this.stacks.set(manager, { undo: [], redo: [] }); return this.stacks.get(manager); }
    record(changes) {
        if (this.replaying || this.suspended) return;
        changes = changes.filter(change => signature(change.before) !== signature(change.after)).map(change => ({ ...change, before: snapshot(change.before), after: snapshot(change.after) }));
        if (!changes.length) return;
        const entry = { changes };
        for (const { manager } of changes) { const stack = this.stack(manager); stack.undo.push(entry); stack.redo = []; if (stack.undo.length > 100) stack.undo.shift(); }
    }
    apply(manager, redo = false) {
        const from = redo ? 'redo' : 'undo', to = redo ? 'undo' : 'redo';
        const entry = this.stack(manager)[from].at(-1); if (!entry) return false;
        for (const change of entry.changes) {
            if (this.stack(change.manager)[from].at(-1) !== entry || signature(change.manager.state) !== signature(redo ? change.before : change.after)) {
                throw new Error('看板内容已在别处修改，无法安全撤销这一步。');
            }
        }
        const originals = entry.changes.map(change => ({ manager: change.manager, state: snapshot(change.manager.state) }));
        this.replaying = true;
        try {
            for (const change of entry.changes) change.manager.setState(snapshot(redo ? change.after : change.before));
            for (const { manager } of entry.changes) { this.stack(manager)[from].pop(); this.stack(manager)[to].push(entry); }
        } catch (error) {
            for (const original of originals) original.manager.setState(original.state);
            throw error;
        } finally { this.replaying = false; }
        return true;
    }
    forget(manager) { this.stacks.delete(manager); }
}
module.exports = { BoardHistory, snapshot };

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function createService(mode) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/timestamp-service'), 'utf8'), {
        module, require: name => name === 'obsidian' ? { Notice: class {} } : require('../src/timestamps'), console, Promise, Map, WeakSet,
    });
    const { TimestampService } = module.exports;
    const file = { path: 'week.md', extension: 'md' };
    let content = '- [ ] A\n  - [ ] B'; let writes = 0; let transactions = 0;
    const handlers = {};
    const editor = { getValue: () => content, transaction({ changes }) {
        transactions++;
        const lines = content.split('\n');
        for (const change of changes) lines[change.from.line] = change.text;
        content = lines.join('\n'); handlers['editor-change']?.(editor, view);
    }};
    const view = { file, editor, getMode: () => mode };
    const plugin = {
        settings: { automaticTimestamps: true, timestampFormat: 'HH:mm', timestampPrefix: '✅', timeZone: 'Asia/Shanghai' },
        registerEvent() {}, isTemplate: () => false,
        app: {
            metadataCache: { getFileCache() { return {}; } },
            workspace: { on(name, fn) { handlers[name] = fn; }, onLayoutReady(fn) { fn(); }, getLeavesOfType() { return [{ view }]; }, getActiveFile: () => file },
            vault: { on(name, fn) { handlers[name] = fn; }, async read() { return content; }, async process(file, transform) {
                writes++; content = transform(content); handlers.modify?.(file);
            } },
        },
    };
    const service = new TimestampService(plugin); service.start();
    return { service, file, editor, handlers, plugin, get: () => content, set: value => { content = value; }, writes: () => writes, transactions: () => transactions };
}
async function drain(service) {
    for (let i = 0; i < 12; i++) { await Promise.resolve(); await Promise.all([...service.queues.values()].map(job => job.catch(() => {}))); }
}

test('reading-view events produce one write and no modify-event loop', async () => {
    const s = createService('preview');
    s.set('- [x] A\n  - [ ] B'); s.handlers.modify(s.file); await drain(s.service);
    assert.match(s.get(), /A ✅ \d{2}:\d{2}/);
    assert.equal(s.writes(), 1);
    s.set(s.get().replace('[x]', '[ ]')); s.handlers.modify(s.file); await drain(s.service);
    assert.equal(s.get(), '- [ ] A\n  - [ ] B'); assert.equal(s.writes(), 2);
    s.service.stop();
});

test('source/live preview changes use fresh editor transactions and preserve other edits', async () => {
    for (const mode of ['source', 'live']) {
        const s = createService(mode);
        s.set('- [x] A\n  - [ ] B'); s.handlers['editor-change'](s.editor, { file: s.file });
        s.set(s.get() + '\nUnsaved writing');
        await drain(s.service);
        assert.match(s.get(), /A ✅ \d{2}:\d{2}/);
        assert.ok(s.get().endsWith('Unsaved writing'));
        assert.equal(s.writes(), 0); assert.equal(s.transactions(), 1);
        s.set(s.get().replace('[x]', '[ ]')); s.handlers['editor-change'](s.editor, { file: s.file }); await drain(s.service);
        assert.ok(!s.get().includes('dayflow:stamp:')); assert.equal(s.transactions(), 2);
        s.service.stop();
    }
});

test('rapid events are coalesced without restoring an earlier checked state', async () => {
    const s = createService('source');
    s.set('- [x] A\n  - [ ] B'); s.handlers['editor-change'](s.editor, { file: s.file });
    s.set('- [ ] A\n  - [ ] B'); s.handlers['editor-change'](s.editor, { file: s.file });
    await drain(s.service); assert.equal(s.transactions(), 0);
    s.set('- [x] A\n  - [x] B'); s.handlers['editor-change'](s.editor, { file: s.file }); await drain(s.service);
    assert.equal(s.transactions(), 1); assert.equal((s.get().match(/dayflow:stamp:/g) || []).length, 2);
    s.service.stop(); s.set('- [ ] A\n  - [ ] B'); s.handlers['editor-change'](s.editor, { file: s.file }); await drain(s.service);
    assert.equal(s.transactions(), 1);
});

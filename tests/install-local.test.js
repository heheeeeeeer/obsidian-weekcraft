const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const root = path.resolve(__dirname, '..');
const install = (...args) => run(process.execPath, [path.join(root, 'scripts/install-local.mjs'), ...args]);
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));

async function fixture(t, configName = '.obsidian') {
    const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'weekcraft-install-test-'));
    t.after(() => fs.rm(vault, { recursive: true, force: true }));
    const config = path.join(vault, configName);
    await fs.mkdir(config);
    return { vault, config };
}

test('installer requires an explicit target vault', async () => {
    await assert.rejects(install(), /Usage:/);
});

test('installer migrates settings and hotkeys, preserves other plugins and retains a rollback copy', async t => {
    const { vault, config } = await fixture(t);
    const old = path.join(config, 'plugins', 'obsidian-weekcraft');
    await fs.mkdir(old, { recursive: true });
    const data = '{"categories":["Study"],"hiddenLanes":{"weekly.md":["Monday"]}}\n';
    await fs.writeFile(path.join(old, 'data.json'), data);
    await fs.writeFile(path.join(old, 'main.js'), '// old build');
    await fs.writeFile(path.join(config, 'community-plugins.json'), JSON.stringify(['obsidian-kanban', 'obsidian-weekcraft', 'calendar']));
    await fs.writeFile(path.join(config, 'hotkeys.json'), JSON.stringify({ 'obsidian-weekcraft:enable-weekly-board': [{ modifiers: ['Mod'], key: 'W' }], 'calendar:open': [] }));
    await install(vault);
    assert.deepEqual(await json(path.join(config, 'community-plugins.json')), ['obsidian-kanban', 'weekcraft', 'calendar']);
    assert.equal(await fs.readFile(path.join(config, 'plugins/weekcraft/data.json'), 'utf8'), data);
    assert.equal(await fs.readFile(path.join(old, 'main.js'), 'utf8'), '// old build');
    const hotkeys = await json(path.join(config, 'hotkeys.json'));
    assert.ok(hotkeys['weekcraft:enable-weekly-board']);
    assert.ok(!('obsidian-weekcraft:enable-weekly-board' in hotkeys));
    assert.deepEqual(hotkeys['calendar:open'], []);
    const backups = await fs.readdir(path.join(config, 'weekcraft-backups'));
    assert.equal(backups.length, 1);
    assert.equal(await fs.readFile(path.join(config, 'weekcraft-backups', backups[0], 'obsidian-weekcraft/data.json'), 'utf8'), data);
    await fs.writeFile(path.join(config, 'plugins/weekcraft/data.json'), '{"categories":["New"]}');
    await install(vault);
    assert.deepEqual(await json(path.join(config, 'plugins/weekcraft/data.json')), { categories: ['New'] });
    assert.deepEqual(await json(path.join(config, 'community-plugins.json')), ['obsidian-kanban', 'weekcraft', 'calendar']);
});

test('installer supports a custom config directory and a clean vault', async t => {
    const { vault, config } = await fixture(t, '.obsidian-dev');
    await install(vault, '.obsidian-dev');
    assert.equal((await json(path.join(config, 'plugins/weekcraft/manifest.json'))).id, 'weekcraft');
    assert.deepEqual(await json(path.join(config, 'community-plugins.json')), ['weekcraft']);
    await assert.rejects(fs.access(path.join(vault, '.obsidian')));
});

test('installer rejects invalid settings before changing enabled IDs or existing runtime files', async t => {
    const { vault, config } = await fixture(t);
    const old = path.join(config, 'plugins/obsidian-weekcraft');
    await fs.mkdir(old, { recursive: true });
    await fs.writeFile(path.join(old, 'data.json'), 'invalid json');
    await fs.writeFile(path.join(config, 'community-plugins.json'), '["obsidian-weekcraft"]');
    await assert.rejects(install(vault));
    assert.deepEqual(await json(path.join(config, 'community-plugins.json')), ['obsidian-weekcraft']);
    await assert.rejects(fs.access(path.join(config, 'plugins/weekcraft/main.js')));
});

test('installer rejects a configuration directory outside the selected vault', async t => {
    const { vault } = await fixture(t);
    await assert.rejects(install(vault, '..'), /must stay inside/);
});

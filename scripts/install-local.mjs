import { readFile, writeFile, mkdir, copyFile, access, realpath, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Development-only installer. It is never included in the plugin runtime.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [vaultArg, configArg = '.obsidian', ...extra] = process.argv.slice(2);
if (!vaultArg || extra.length) throw new Error('Usage: npm run install:local -- <vault-path> [config-folder]');
const vault = await realpath(path.resolve(vaultArg));
const config = await realpath(path.resolve(vault, configArg));
function assertInside(parent, child) {
    const relative = path.relative(parent, child);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Installation path must stay inside its parent: ' + child);
}
assertInside(vault, config);
const exists = async file => { try { await access(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const manifest = await readJson(path.join(project, 'manifest.json'));
if (manifest.id !== 'weekcraft') throw new Error('Expected the public weekcraft plugin ID.');
const legacyIds = ['obsidian-weekcraft', 'weekly-kanban-helper'];
const enabledPath = path.join(config, 'community-plugins.json');
const hotkeysPath = path.join(config, 'hotkeys.json');
const enabled = await exists(enabledPath) ? await readJson(enabledPath) : [];
if (!Array.isArray(enabled) || enabled.some(id => typeof id !== 'string')) throw new Error('Invalid enabled-plugin configuration.');
const hotkeys = await exists(hotkeysPath) ? await readJson(hotkeysPath) : {};
if (!hotkeys || typeof hotkeys !== 'object' || Array.isArray(hotkeys)) throw new Error('Invalid hotkey configuration.');
await import('../build.mjs');
const plugins = path.join(config, 'plugins');
await mkdir(plugins, { recursive: true });
assertInside(config, await realpath(plugins));
const target = path.join(plugins, manifest.id);
for (const id of [manifest.id, ...legacyIds]) {
    const folder = path.join(plugins, id);
    if (await exists(folder)) assertInside(plugins, await realpath(folder));
}
let dataSource;
for (const id of [manifest.id, ...legacyIds]) {
    const file = path.join(plugins, id, 'data.json');
    if (await exists(file)) { await readJson(file); dataSource = file; break; }
}
const backupRoot = path.join(config, 'weekcraft-backups');
await mkdir(backupRoot, { recursive: true });
assertInside(config, await realpath(backupRoot));
const backup = await mkdtemp(path.join(backupRoot, 'migration-'));
for (const name of ['community-plugins.json', 'hotkeys.json']) {
    if (await exists(path.join(config, name))) await copyFile(path.join(config, name), path.join(backup, name));
}
for (const id of [manifest.id, ...legacyIds]) {
    for (const name of ['main.js', 'styles.css', 'manifest.json', 'data.json']) {
        const source = path.join(plugins, id, name);
        if (await exists(source)) {
            await mkdir(path.join(backup, id), { recursive: true });
            await copyFile(source, path.join(backup, id, name));
        }
    }
}
await mkdir(target, { recursive: true });
for (const name of ['main.js', 'styles.css', 'manifest.json']) await copyFile(path.join(project, name), path.join(target, name));
if (dataSource && dataSource !== path.join(target, 'data.json')) await copyFile(dataSource, path.join(target, 'data.json'));
for (const [key, value] of Object.entries(hotkeys)) {
    const legacy = legacyIds.find(id => key.startsWith(id + ':'));
    if (!legacy) continue;
    const nextKey = manifest.id + key.slice(legacy.length);
    if (!(nextKey in hotkeys)) hotkeys[nextKey] = value;
    delete hotkeys[key];
}
if (await exists(hotkeysPath)) await writeFile(hotkeysPath, JSON.stringify(hotkeys, null, 2) + '\n');
// Switch the enabled ID last. Keep old folders as an additional rollback copy.
const nextEnabled = [...new Set(enabled.map(id => legacyIds.includes(id) ? manifest.id : id))];
if (!nextEnabled.includes(manifest.id)) nextEnabled.push(manifest.id);
await writeFile(enabledPath, JSON.stringify(nextEnabled, null, 2) + '\n');
for (const name of ['main.js', 'styles.css', 'manifest.json']) {
    if (!(await readFile(path.join(project, name))).equals(await readFile(path.join(target, name)))) throw new Error('Installed artifact differs: ' + name);
}
console.log('Installed WeekCraft at ' + target);
console.log('Settings and hotkeys preserved; legacy IDs disabled. Backup: ' + backup);
console.log('Restart Obsidian before using the new version.');

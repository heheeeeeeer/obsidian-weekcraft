import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const json = async name => JSON.parse(await readFile(path.join(root, name), 'utf8'));
const manifest = await json('manifest.json');
const pkg = await json('package.json');
const lock = await json('package-lock.json');
const versions = await json('versions.json');
assert.match(manifest.id, /^[a-z]+(?:-[a-z]+)*$/);
assert.ok(!manifest.id.includes('obsidian') && !manifest.id.endsWith('plugin'));
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(pkg.version, manifest.version);
assert.equal(lock.version, manifest.version);
assert.equal(lock.packages[''].version, manifest.version);
assert.equal(versions[manifest.version], manifest.minAppVersion);
assert.equal(manifest.author, 'heheeeeeeer');
assert.equal(typeof manifest.isDesktopOnly, 'boolean');
if (process.env.GITHUB_REF_TYPE === 'tag') assert.equal(process.env.GITHUB_REF_NAME, manifest.version, 'Release tag must match manifest version exactly (no v prefix).');
for (const name of ['README.md', 'LICENSE', 'main.js', 'styles.css', 'package-lock.json']) assert.ok((await readFile(path.join(root, name))).length > 0, name);
for (const name of await readdir(path.join(root, 'src'))) {
    if (!name.endsWith('.js')) continue;
    const source = await readFile(path.join(root, 'src', name), 'utf8');
    assert.ok(!/[A-Za-z]:[\\/]|heheer_obsidian|LENOVO/.test(source), 'Local path in ' + name);
    const external = [...source.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map(match => match[1]).filter(id => !id.startsWith('./'));
    assert.ok(external.every(id => id === 'obsidian'), 'Unexpected runtime dependency in ' + name);
}
console.log('Release metadata, assets, and runtime portability checks passed for ' + manifest.version);

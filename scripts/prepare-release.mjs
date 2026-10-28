import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'));
const output = path.join(root, 'dist', version);
await mkdir(output, { recursive: true });
for (const name of ['main.js', 'manifest.json', 'styles.css']) await copyFile(path.join(root, name), path.join(output, name));
console.log('Release attachments: ' + output);

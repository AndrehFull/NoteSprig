import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { legacy } from '../server/legacy.mjs';
const offlineMessages = {};
for (const locale of ['en', 'pt-BR']) {
    const catalog = JSON.parse(await readFile(`src/locales/${locale}.json`, 'utf8'));
    offlineMessages[locale] = Object.fromEntries(['Attachment unavailable offline.', 'Open the app online before using it offline.'].map((key) => [key, catalog[key]]));
}
const root = path.resolve('dist');
const legal = path.join(root, 'legal');
await mkdir(legal, { recursive: true });
await copyFile('LICENSE', path.join(legal, 'LICENSE.txt'));
await copyFile('THIRD_PARTY_NOTICES.md', path.join(legal, 'THIRD_PARTY_NOTICES.txt'));
await copyFile('docs/legal/THIRD_PARTY_LICENSES.txt', path.join(legal, 'THIRD_PARTY_LICENSES.txt'));
await copyFile('docs/legal/runtime-dependencies.json', path.join(legal, 'runtime-dependencies.json'));
const assets = [];
async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory())
        await walk(file);
    else if (/\.(js|css|woff2|svg|webmanifest|html|txt|json)$/.test(file) && entry.name !== 'sw.js')
        assets.push('/' + path.relative(root, file).replaceAll('\\', '/'));
} }
await walk(root);
const hash = createHash('sha256').update(assets.join('\n')).update(await readFile(path.join(root, 'index.html'))).update(await readFile(path.join(root, 'icon.svg'))).update(await readFile(path.join(root, 'manifest.webmanifest')));
for (const file of ['LICENSE.txt', 'THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_LICENSES.txt', 'runtime-dependencies.json'])
    hash.update(await readFile(path.join(legal, file)));
const digest = hash.digest('hex').slice(0, 16);
const template = await readFile('scripts/service-worker.js', 'utf8');
await writeFile(path.join(root, 'sw.js'), template.replace('__OFFLINE_MESSAGES__', JSON.stringify(offlineMessages)).replace('__VERSION__', digest).replace('__ASSETS__', JSON.stringify(assets)).replaceAll('__LEGACY_SHELL__', `${legacy.slug}-shell-`).replaceAll('__LEGACY_MEDIA__', `${legacy.slug}-media-v1`));
const bytes = (await Promise.all(assets.map((asset) => stat(path.join(root, asset))))).reduce((sum, info) => sum + info.size, 0);
console.log(`PWA: ${assets.length} static files, ${(bytes / 1024 / 1024).toFixed(1)} MB available offline.`);

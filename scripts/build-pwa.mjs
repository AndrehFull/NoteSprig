import { cp, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
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
for (const name of ['board-fonts', 'supplemental']) await cp(path.join('docs/legal', name), path.join(legal, name), { recursive: true });
for (const name of ['board-fonts.json', 'supplemental-licenses.json']) await copyFile(path.join('docs/legal', name), path.join(legal, name));
for (const name of await readdir(root)) if (/^board-feature-[a-f\d]{24}\.json$/.test(name)) await rm(path.join(root, name));
const assets = [];
async function walk(directory) { for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== '.vite')
        await walk(file);
    else if (entry.isFile() && (file.startsWith(legal + path.sep) || /\.(js|css|woff2?|ttf|wasm|png|svg|webmanifest|html|txt|json)$/.test(file)) && entry.name !== 'sw.js')
        assets.push('/' + path.relative(root, file).replaceAll('\\', '/'));
} }
await walk(root);
const graph = JSON.parse(await readFile(path.join(root, '.vite/manifest.json'), 'utf8'));
const boardEntry = 'src/boards/BoardView.tsx';
if (!graph[boardEntry] || !graph['index.html']) throw new Error('The build manifest must identify the application and board entries.');
function dependencies(entry, excluded = new Set(), visited = new Set(), files = new Set()) {
    if (excluded.has(entry) || visited.has(entry)) return files;
    visited.add(entry);
    const chunk = graph[entry];
    if (!chunk) throw new Error(`Missing build dependency: ${entry}`);
    for (const asset of [chunk.file, ...(chunk.css || []), ...(chunk.assets || [])]) if (asset) files.add('/' + asset);
    for (const child of [...(chunk.imports || []), ...(chunk.dynamicImports || [])]) dependencies(child, excluded, visited, files);
    return files;
}
// Preserve existing non-board offline features. The board and its drawing engine
// are downloaded only when requested; shared application dependencies stay in shell.
const coreFiles = dependencies('index.html', new Set([boardEntry]));
const boardFiles = dependencies(boardEntry);
for (const asset of assets) if (asset.startsWith('/board-assets/')) boardFiles.add(asset);
const featureFiles = [...boardFiles].filter((asset) => !coreFiles.has(asset)).sort();
if (!featureFiles.some((asset) => asset.endsWith('.js'))) throw new Error('The board engine must be a separate lazy feature.');
const featureAssets = await Promise.all(featureFiles.map(async (url) => {
    const bytes = await readFile(path.join(root, url));
    return { url, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') };
}));
const featureVersion = createHash('sha256').update(JSON.stringify(featureAssets)).digest('hex').slice(0, 24);
const featureManifest = { schemaVersion: 1, version: featureVersion, entry: '/' + graph[boardEntry].file, assets: featureAssets };
const manifestPath = `/board-feature-${featureVersion}.json`;
await writeFile(path.join(root, manifestPath), JSON.stringify(featureManifest));
const htmlPath = path.join(root, 'index.html');
await writeFile(htmlPath, (await readFile(htmlPath, 'utf8')).replace(/<meta\s+name="notesprig-board-manifest"\s+content="[^"]*">/g, '').replace('</head>', `<meta name="notesprig-board-manifest" content="${manifestPath}"></head>`));
const featureSet = new Set(featureFiles);
const shellAssets = [...assets.filter((asset) => !featureSet.has(asset)), manifestPath].sort();
const hash = createHash('sha256').update(shellAssets.join('\n'));
for (const asset of shellAssets) hash.update(await readFile(path.join(root, asset)));
const digest = hash.digest('hex').slice(0, 16);
const template = await readFile('scripts/service-worker.js', 'utf8');
await writeFile(path.join(root, 'sw.js'), template.replace('__OFFLINE_MESSAGES__', JSON.stringify(offlineMessages)).replace('__VERSION__', digest).replace('__ASSETS__', JSON.stringify(shellAssets)).replaceAll('__LEGACY_SHELL__', `${legacy.slug}-shell-`).replaceAll('__LEGACY_MEDIA__', `${legacy.slug}-media-v1`));
const bytes = (await Promise.all(shellAssets.map((asset) => stat(path.join(root, asset))))).reduce((sum, info) => sum + info.size, 0);
const featureBytes = featureAssets.reduce((sum, asset) => sum + asset.bytes, 0);
console.log(`PWA: ${shellAssets.length} shell files (${(bytes / 1024 / 1024).toFixed(1)} MB); ${featureAssets.length} board feature files (${(featureBytes / 1024 / 1024).toFixed(1)} MB), downloaded on demand.`);

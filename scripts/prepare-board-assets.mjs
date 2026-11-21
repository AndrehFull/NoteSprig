import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Refuse to ship changed font bytes before their notices/provenance are reviewed.
await import('./acquire-board-licenses.mjs');

const source = 'node_modules/@excalidraw/excalidraw/dist/prod/fonts';
const destination = 'public/board-assets/fonts';
await mkdir(destination, { recursive: true });
await cp(source, destination, { recursive: true });
const metadata = JSON.parse(await readFile('node_modules/@excalidraw/excalidraw/package.json', 'utf8'));
await writeFile(path.join('public/board-assets', 'version.json'), JSON.stringify({ engine: metadata.version }) + '\n');
console.log(`Prepared self-hosted Excalidraw ${metadata.version} fonts.`);

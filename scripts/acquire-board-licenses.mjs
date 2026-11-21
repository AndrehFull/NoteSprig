import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// This is a checksum-locked acquisition/check tool, not a license classifier.
// The reviewed manifest records original embedded font notices and pinned upstream evidence.
const project = path.resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(path.join(project, 'docs/legal/board-fonts.json'), 'utf8'));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fetchSources = process.argv.includes('--fetch');
if (process.argv.some((arg, index) => index > 1 && !['--fetch', '--check'].includes(arg))) throw new Error('Use --check or --fetch.');
if (manifest.package !== '@excalidraw/excalidraw' || manifest.version !== '0.18.1') throw new Error('Unreviewed board font package.');
const installed = JSON.parse(await readFile(path.join(project, 'node_modules/@excalidraw/excalidraw/package.json'), 'utf8'));
if (installed.version !== manifest.version) throw new Error('Board engine version differs from reviewed font inventory.');
const root = path.join(project, manifest.fontRoot), legalRoot = path.join(project, 'docs/legal/board-fonts');
const checked = new Set();
function legalPath(relative) {
  const resolved = path.resolve(project, relative);
  if (!resolved.startsWith(legalRoot + path.sep)) throw new Error('Unsafe font license manifest path.');
  return resolved;
}
for (const font of manifest.fonts) {
  if (font.redistributionStatus !== 'verified') throw new Error(`Unresolved font license: ${font.family}`);
  const license = legalPath(font.licenseFile);
  if (hash(await readFile(license)) !== font.licenseSha256) throw new Error(`Font license checksum mismatch: ${font.family}`);
  for (const source of font.sources) {
    const target = legalPath(source.localFile);
    if (fetchSources && !checked.has(target)) {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.hostname !== 'raw.githubusercontent.com') throw new Error('Unapproved font provenance host.');
      const response = await fetch(url);
      if (!response.ok) throw new Error(`License acquisition failed (${response.status}): ${font.family}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 2 * 1024 ** 2 || hash(bytes) !== source.sha256) throw new Error(`Upstream font provenance checksum mismatch: ${font.family}`);
      await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes);
    }
    if (hash(await readFile(target)) !== source.sha256) throw new Error(`Font provenance checksum mismatch: ${source.localFile}`);
    checked.add(target);
  }
  for (const file of font.files) {
    const target = path.resolve(root, file.path);
    if (!target.startsWith(root + path.sep) || hash(await readFile(target)) !== file.sha256) throw new Error(`Bundled font differs from reviewed bytes: ${file.path}`);
  }
}
const actual = [];
async function walk(directory, prefix = '') {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) await walk(path.join(directory, entry.name), relative + '/');
    else if (entry.name.endsWith('.woff2')) actual.push(relative);
  }
}
await walk(root);
const expected = manifest.fonts.flatMap((font) => font.files.map((file) => file.path));
if (JSON.stringify(actual.sort()) !== JSON.stringify(expected.sort())) throw new Error('Bundled font inventory changed; review all added/removed assets.');
console.log(`Verified ${manifest.fonts.length} board font families, ${expected.length} font files and ${checked.size} pinned provenance files.`);

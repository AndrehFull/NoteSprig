import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const json = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const lock = await json('package-lock.json');
const serverLock = await json('server/package-lock.json');
const packages = new Map();
const supplemental = await json('docs/legal/supplemental-licenses.json');
const optionalOtherPlatforms = [];
const noticeName = /^(licen[cs]e|notice|copying|copyright|ofl|unlicense)([.\-_]|$)/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory || entry.dev) continue;
  let metadata;
  try { metadata = await json(`${directory}/package.json`); }
  catch(error) { if (entry.optional && error.code==='ENOENT') {optionalOtherPlatforms.push({name:directory.split('node_modules/').at(-1),version:entry.version,license:entry.license,archive:entry.resolved});continue;}throw error; }
  if (metadata.version !== entry.version) throw new Error(`Run npm ci: version mismatch for ${directory}`);
  const names = (await readdir(path.join(root, directory), { withFileTypes: true })).filter((file) => file.isFile() && noticeName.test(file.name)).map((file) => file.name).sort(compare);
  const external = supplemental[`${metadata.name}@${metadata.version}`] || [];
  if (!names.length && !external.length) throw new Error(`No license file found for ${metadata.name}; review manually.`);
  const notices = await Promise.all(names.map(async (name) => ({ file: name, text: (await readFile(path.join(root, directory, name), 'utf8')).replaceAll('\r\n', '\n').trimEnd() })));
  for(const notice of external) {
    const raw=await readFile(path.join(root,notice.file));
    if(createHash('sha256').update(raw).digest('hex')!==notice.sha256)throw new Error(`Supplemental license digest mismatch: ${notice.file}`);
    notices.push({file:notice.file,source:notice.source,text:raw.toString('utf8').replaceAll('\r\n','\n').trimEnd()});
  }
  // khroma's published package omits metadata.license; its included license is MIT.
  const license = entry.license || metadata.license || (metadata.licenses?.length===1&&metadata.licenses[0].type) || (metadata.name === 'khroma' && notices.some((notice) => notice.text.startsWith('The MIT License (MIT)')) ? 'MIT' : null);
  if (!license || typeof license !== 'string') throw new Error(`Review license metadata for ${metadata.name}`);
  const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url || '';
  packages.set(`${metadata.name}@${metadata.version}`, { name: metadata.name, version: metadata.version, license, repository, archive: entry.resolved, notices });
}

// The separate production lockfile must be covered by the same installed versions.
for (const [directory, entry] of Object.entries(serverLock.packages)) {
  if (!directory || entry.dev) continue;
  const name = directory.split('node_modules/').at(-1);
  if (!packages.has(`${name}@${entry.version}`) && !optionalOtherPlatforms.some(item=>item.name===name&&item.version===entry.version)) throw new Error(`Server-only dependency ${name}@${entry.version}: extend the inventory before distributing.`);
}

const inventory = [...packages.values()].sort((a, b) => compare(`${a.name}@${a.version}`, `${b.name}@${b.version}`));
const elkVersion = inventory.find((item) => item.name === 'elkjs')?.version ?? 'unknown';
const introduction = `# Third-party notices

NoteSprig's original code and documentation use MIT. The components below retain their own licenses and copyright notices. This index includes installed runtime dependencies of the frontend and production server; some may not appear in a particular tree-shaken build. Optional binaries for other operating systems or architectures are listed separately and are not distributed by this installation. Development tools and the container base operating system are outside this npm inventory.

Generated from both committed lockfiles, installed package license files, and checksum-verified upstream notices where npm omits its license file. Regenerate with \`npm run notices:generate\`; verify with \`npm run notices:check\`. No timestamps or machine-specific paths are included.

Full upstream license and notice texts are preserved in [THIRD_PARTY_LICENSES.txt](docs/legal/THIRD_PARTY_LICENSES.txt). Machine-readable package versions, repository metadata, and source archive URLs are in [runtime-dependencies.json](docs/legal/runtime-dependencies.json). Compiled builds also include the licenses under \`/legal/\`.

## Components requiring particular attention

- **Excalidraw and its fonts** retain their individual licenses. Font file hashes, exact notices, and upstream source information are recorded in [board-fonts.json](docs/legal/board-fonts.json); font licenses are included below.
- **sharp/libvips** decode and validate board raster images on the server. The unmodified shared native library retains LGPL-3.0-or-later and the notices of its bundled dependencies. Its pinned build sources and upstream component versions are preserved with the supplemental notices. Users may replace or rebuild the shared library; the project MIT license does not relicense it.
- **elkjs** is a transitive Mermaid dependency offered under EPL-2.0 OR GPL-3.0-or-later; NoteSprig distributes it under EPL-2.0. The locked version's source is [kieler/elkjs ${elkVersion}](https://github.com/kieler/elkjs/tree/${elkVersion}), with the underlying Java layout implementation in [Eclipse ELK](https://github.com/eclipse-elk/elk). Preserve its license and source availability information when distributing it; an MIT license on this project does not relicense elkjs.
- **DOMPurify** is offered under \`MPL-2.0 OR Apache-2.0\`. Both license texts supplied by the package are retained.
- **KaTeX** includes the mathematical fonts used by the interface. Its supplied license text is retained with the package's notices.
- **khroma** omits a license field in its published package metadata. Its included \`license\` file explicitly states MIT and is used as the inventory source.

The distributed npm components are not patched by NoteSprig; bundling and minification do not change their license ownership. If you modify or redistribute a component, review its applicable source and notice requirements. Container images additionally contain Node.js and Debian packages with their own licenses and notices.

## Locked runtime packages (${inventory.length})

| Package | Version | License |
| --- | --- | --- |
`;
const index = introduction + inventory.map((item) => `| \`${item.name}\` | ${item.version} | ${item.license} |`).join('\n') + '\n\n## Optional packages for other platforms (not distributed here)\n\n| Package | Version | License |\n| --- | --- | --- |\n' + optionalOtherPlatforms.sort((a,b)=>compare(a.name,b.name)).map(item=>`| \`${item.name}\` | ${item.version} | ${item.license || 'See upstream package'} |`).join('\n')+'\n';
let texts = 'THIRD-PARTY LICENSES AND NOTICES\n\nGenerated by scripts/third-party-notices.mjs from installed locked runtime packages.\n\n' + inventory.map((item) => `${'='.repeat(78)}\n${item.name}@${item.version}\nLicense: ${item.license}\nUpstream: ${item.repository}\nPackage archive: ${item.archive}\n\n${item.notices.map((notice) => `--- ${notice.file} ---\n${notice.text}\n`).join('\n')}`).join('\n');
const fonts = await json('docs/legal/board-fonts.json');
for(const font of fonts.fonts) {
  const license=await readFile(path.join(root,font.licenseFile),'utf8');
  texts+=`\n${'='.repeat(78)}\nFont: ${font.family}\nLicense: ${font.license}\nSources: ${font.sources.map(source=>typeof source==='string'?source:source.url).join(', ')}\n\n${license}\n`;
}
const data = JSON.stringify(inventory.map(({ notices, ...item }) => ({ ...item, noticeFiles: notices.map((notice) => notice.file) })), null, 2) + '\n';
for (const [name, contents] of [['THIRD_PARTY_NOTICES.md', index], ['docs/legal/THIRD_PARTY_LICENSES.txt', texts], ['docs/legal/runtime-dependencies.json', data]]) {
  const file = path.join(root, name);
  if (check) {
    if (await readFile(file, 'utf8').catch(() => null) !== contents) throw new Error(`${name} is stale; run npm run notices:generate and review the result.`);
  } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents); }
}
console.log(`${check ? 'Verified' : 'Generated'} notices for ${inventory.length} locked runtime packages.`);

import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');
const json = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const lock = await json('package-lock.json');
const serverLock = await json('server/package-lock.json');
const packages = new Map();
const noticeName = /^(licen[cs]e|notice|copying|copyright|ofl|unlicense)([.\-_]|$)/i;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

for (const [directory, entry] of Object.entries(lock.packages)) {
  if (!directory || entry.dev) continue;
  const metadata = await json(`${directory}/package.json`);
  if (metadata.version !== entry.version) throw new Error(`Run npm ci: version mismatch for ${directory}`);
  const names = (await readdir(path.join(root, directory), { withFileTypes: true })).filter((file) => file.isFile() && noticeName.test(file.name)).map((file) => file.name).sort(compare);
  if (!names.length) throw new Error(`No license file found for ${metadata.name}; review manually.`);
  const notices = await Promise.all(names.map(async (name) => ({ file: name, text: (await readFile(path.join(root, directory, name), 'utf8')).replaceAll('\r\n', '\n').trimEnd() })));
  // khroma's published package omits metadata.license; its included license is MIT.
  const license = entry.license || metadata.license || (metadata.name === 'khroma' && notices.some((notice) => notice.text.startsWith('The MIT License (MIT)')) ? 'MIT' : null);
  if (!license || typeof license !== 'string') throw new Error(`Review license metadata for ${metadata.name}`);
  const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url || '';
  packages.set(`${metadata.name}@${metadata.version}`, { name: metadata.name, version: metadata.version, license, repository, archive: entry.resolved, notices });
}

// The separate production lockfile must be covered by the same installed versions.
for (const [directory, entry] of Object.entries(serverLock.packages)) {
  if (!directory || entry.dev) continue;
  const name = directory.split('node_modules/').at(-1);
  if (!packages.has(`${name}@${entry.version}`)) throw new Error(`Server-only dependency ${name}@${entry.version}: extend the inventory before distributing.`);
}

const inventory = [...packages.values()].sort((a, b) => compare(`${a.name}@${a.version}`, `${b.name}@${b.version}`));
const introduction = `# Third-party notices

NoteSprig's original code and documentation use MIT. The components below retain their own licenses and copyright notices. This index conservatively includes every locked runtime dependency, including dependencies of the frontend and the production server; some may not appear in a particular tree-shaken build. Development tools and the container base operating system are outside this npm inventory.

Generated from both committed lockfiles and the installed package license files. Regenerate with \`npm run notices:generate\`; verify with \`npm run notices:check\`. No timestamps or machine-specific paths are included.

Full upstream license and notice texts are preserved in [THIRD_PARTY_LICENSES.txt](docs/legal/THIRD_PARTY_LICENSES.txt). Machine-readable package versions, repository metadata, and source archive URLs are in [runtime-dependencies.json](docs/legal/runtime-dependencies.json). Compiled builds also include the licenses under \`/legal/\`.

## Components requiring particular attention

- **elkjs** is licensed under EPL-2.0 and is a transitive Mermaid dependency. The locked version's source is [kieler/elkjs 0.9.3](https://github.com/kieler/elkjs/tree/0.9.3), with the underlying Java layout implementation in [Eclipse ELK](https://github.com/eclipse-elk/elk). Preserve its license and source availability information when distributing it; an MIT license on this project does not relicense elkjs.
- **DOMPurify** is offered under \`MPL-2.0 OR Apache-2.0\`. Both license texts supplied by the package are retained.
- **KaTeX** includes the mathematical fonts used by the interface. Its supplied license text is retained with the package's notices.
- **khroma** omits a license field in its published package metadata. Its included \`license\` file explicitly states MIT and is used as the inventory source.

The distributed npm components are not patched by NoteSprig; bundling and minification do not change their license ownership. If you modify or redistribute a component, review its applicable source and notice requirements. Container images additionally contain Node.js and Debian packages with their own licenses and notices.

## Locked runtime packages (${inventory.length})

| Package | Version | License |
| --- | --- | --- |
`;
const index = introduction + inventory.map((item) => `| \`${item.name}\` | ${item.version} | ${item.license} |`).join('\n') + '\n';
const texts = 'THIRD-PARTY LICENSES AND NOTICES\n\nGenerated by scripts/third-party-notices.mjs from installed locked runtime packages.\n\n' + inventory.map((item) => `${'='.repeat(78)}\n${item.name}@${item.version}\nLicense: ${item.license}\nUpstream: ${item.repository}\nPackage archive: ${item.archive}\n\n${item.notices.map((notice) => `--- ${notice.file} ---\n${notice.text}\n`).join('\n')}`).join('\n');
const data = JSON.stringify(inventory.map(({ notices, ...item }) => ({ ...item, noticeFiles: notices.map((notice) => notice.file) })), null, 2) + '\n';
for (const [name, contents] of [['THIRD_PARTY_NOTICES.md', index], ['docs/legal/THIRD_PARTY_LICENSES.txt', texts], ['docs/legal/runtime-dependencies.json', data]]) {
  const file = path.join(root, name);
  if (check) {
    if (await readFile(file, 'utf8').catch(() => null) !== contents) throw new Error(`${name} is stale; run npm run notices:generate and review the result.`);
  } else { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, contents); }
}
console.log(`${check ? 'Verified' : 'Generated'} notices for ${inventory.length} locked runtime packages.`);

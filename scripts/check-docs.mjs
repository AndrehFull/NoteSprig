import { readFile, readdir, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory() && !['node_modules', '.git', '.local', 'data', 'dist', 'RUN', 'test-results', 'playwright-report', 'backups'].includes(entry.name)) await walk(file);
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(file);
  }
}
await walk('');
const errors = [];
for (const file of files) {
  const text = await readFile(path.join(root, file), 'utf8');
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const links = [...prose.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g), ...prose.matchAll(/(?:src|href)="([^"]+)"/g)];
  for (const [, target] of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) continue;
    const name = decodeURIComponent(target.split('#')[0]);
    if (!name) continue;
    const resolved = path.resolve(root, path.dirname(file), name);
    if (!resolved.startsWith(root + path.sep)) { errors.push(`${file}: link leaves the repository: ${target}`); continue; }
    try { await access(resolved); } catch { errors.push(`${file}: missing local target: ${target}`); }
  }
  if (/\/home\/|\/Users\/|C:\\\\Users\\\\/.test(text)) errors.push(`${file}: machine-specific home path`);
}
if (errors.length) throw new Error(errors.join('\n'));
console.log(`Checked local links, images, and home-path references in ${files.length} Markdown documents.`);

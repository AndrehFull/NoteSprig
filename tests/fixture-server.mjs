import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-ui-'));
const notes = {
  'Index.md': '---\ntags: [inicio]\n---\n# Início\n\n[[Projetos/Atlas]] e [[Ideias/Ligações]]\n\n[[Futura]]\n\n[Atlas](Projetos/Atlas.md)\n',
  'Projetos/Atlas.md': '---\naliases: [Astro]\ntags: [projetos]\n---\n# Atlas\n\n[[Index]] e [[Ideias/Ligações]]\n\n## Próximas ações\n\nAnotar ideias.\n',
  'Ideias/Ligações.md': '---\ntags: [ideias]\n---\n# Ligações\n\n[[Index]]\n',
  'Órfã.md': '# Órfã\n\nSem links.\n',
  'Duplicadas/A/Shared.md': '---\naliases: [DUPLICADO]\n---\n# Shared\n',
  'Duplicadas/B/Shared.md': '---\naliases: [DUPLICADO]\n---\n# Shared\n',
  'Ambígua.md': '# Ambígua\n\n[[DUPLICADO]]\n',
};
for (const [relative, content] of Object.entries(notes)) {
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), content);
}
process.env.HOST = '127.0.0.1'; process.env.PORT = '4318'; process.env.NODE_ENV = 'development';
process.env.NOTESPRIG_VAULT = root; process.env.NOTESPRIG_DEV_PASSWORD = 'test-session-only';
process.env.NOTESPRIG_PASSWORD_HASH = ''; process.env.SESSION_SECRET = '';
process.on('exit', () => { rmSync(root, { recursive: true, force: true }); });
await import('../server/index.mjs');

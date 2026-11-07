import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
// @ts-ignore Native server module.
import { Vault, validateCanvas } from '../server/vault.mjs';
const exec = promisify(execFile);

test('concurrent writes detect conflicts and history restores the previous version', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-storage-'));
  try {
    const vault = new Vault(root); await vault.initialize(); const original = await vault.create('Nota.md', '# Original');
    const results = await Promise.all([vault.update('Nota.md', '# Primeiro', original.hash), vault.update('Nota.md', '# Segundo', original.hash)]);
    expect(results.filter((result: { conflict: boolean }) => result.conflict)).toHaveLength(1);
    const versions = await vault.versions('Nota.md'); expect(versions.length).toBeGreaterThan(1);
    const first = (await Promise.all(versions.map((version: { id: string }) => vault.version('Nota.md', version.id)))).find((version: { content: string }) => version.content === '# Original');
    const current = await vault.read('Nota.md'); await vault.restoreVersion('Nota.md', first.id, current.hash); expect((await vault.read('Nota.md')).content).toBe('# Original');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('symbolic links and path traversal cannot write outside the vault', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-paths-')); const outside = await mkdtemp(path.join(os.tmpdir(), 'notesprig-outside-'));
  try {
    const vault = new Vault(root); await vault.initialize(); await symlink(outside, path.join(root, 'escape'));
    await expect(vault.create('../fora.md', 'texto')).rejects.toThrow(); await expect(vault.create('escape/fora.md', 'texto')).rejects.toThrow(); await expect(vault.upload('escape/foto.png', 'YQ==')).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  } finally { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
});

test('interrupted journal recovers documents and a moved folder', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-recovery-'));
  try {
    const vault = new Vault(root); await vault.initialize(); await mkdir(path.join(root, 'Destino')); await writeFile(path.join(root, 'Destino', 'Nota.md'), '# Modificado'); await mkdir(path.join(root, 'Destino', 'Vazia'));
    await writeFile(path.join(root, '.notesprig', 'transaction.json'), JSON.stringify({ directoryMove: { from: 'Origem', to: 'Destino' }, originals: [{ path: 'Origem/Nota.md', base64: Buffer.from('# Original').toString('base64') }], created: ['Destino/Nota.md'] }));
    const restarted = new Vault(root); await restarted.initialize(); expect((await restarted.read('Origem/Nota.md')).content).toBe('# Original'); expect(await readdir(path.join(root, 'Origem', 'Vazia'))).toEqual([]); expect(await readdir(root)).not.toContain('Destino');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('encrypted backup restores notes, Canvas, attachments, and history; incorrect password preserves target', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'notesprig-backup-')); const root = path.join(work, 'vault'), target = path.join(work, 'restaurado'), backup = path.join(work, 'backup.obak');
  const environment = { ...process.env, NOTESPRIG_BACKUP_PASSWORD: 'senha-ficticia-para-o-teste-de-backup' };
  try {
    const vault = new Vault(root); await vault.initialize(); const note = await vault.create('Pastas/Nota.md', '# Original'); await vault.update('Pastas/Nota.md', '# Atualizada', note.hash);
    await vault.create('Mapa.canvas', JSON.stringify({ nodes: [], edges: [] })); await vault.upload('foto.png', Buffer.from([1, 2, 3, 4]).toString('base64'));
    await exec(process.execPath, ['scripts/backup.mjs', 'create', '--vault', root, '--output', backup], { env: environment });
    await exec(process.execPath, ['scripts/backup.mjs', 'restore', '--input', backup, '--vault', target], { env: environment });
    expect(await readFile(path.join(target, 'Pastas', 'Nota.md'), 'utf8')).toBe('# Atualizada'); expect(await readFile(path.join(target, 'foto.png'))).toEqual(Buffer.from([1, 2, 3, 4])); const restored = new Vault(target); await restored.initialize(); expect((await restored.versions('Pastas/Nota.md')).length).toBeGreaterThan(1);
    await expect(exec(process.execPath, ['scripts/backup.mjs', 'restore', '--input', backup, '--vault', path.join(work, 'incorreto')], { env: { ...environment, NOTESPRIG_BACKUP_PASSWORD: 'senha-incorreta-mas-longa' } })).rejects.toThrow();
    await expect(exec(process.execPath, ['scripts/backup.mjs', 'restore', '--input', backup, '--vault', target], { env: environment })).rejects.toThrow();
    expect(await readFile(path.join(target, 'Pastas', 'Nota.md'), 'utf8')).toBe('# Atualizada');
  } finally { await rm(work, { recursive: true, force: true }); }
});

test('JSON Canvas accepts optional lists and preserves unknown fields', () => {
  expect(validateCanvas({ custom: 42 })).toEqual({ custom: 42 });
  expect(validateCanvas({ nodes: [], metadata: { abc: true } })).toEqual({ nodes: [], metadata: { abc: true } });
  expect(() => validateCanvas({ nodes: 'inválido' })).toThrow();
});

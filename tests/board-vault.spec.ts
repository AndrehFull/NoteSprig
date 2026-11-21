import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { zipSync } from 'fflate';
// @ts-ignore Native server implementation.
import { Vault } from '../server/vault.mjs';
// @ts-ignore Shared native schema.
import { createBoard, MANAGED_ASSET_ROOT } from '../shared/board-schema.mjs';
async function fixture(run: (root: string) => Promise<void>) { const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-board-vault-')); try { await run(root); } finally { await rm(root, { recursive: true, force: true }); } }
const text = (root: string, relative: string) => readFile(path.join(root, relative), 'utf8');
const encode = (value: string) => Buffer.from(value).toString('base64');

test('ordinary content changes and fresh paths preserve epoch while path reuse rejects stale editor writes', async () => fixture(async (root) => {
  const vault = new Vault(root); await vault.initialize();
  const original = await vault.create('A.md', '# same'); const context = await vault.boardReferences.getContext();
  await vault.create('Fresh.md', '# fresh'); await vault.update('Fresh.md', '# edited', (await vault.read('Fresh.md')).hash);
  expect(await vault.boardReferences.getContext()).toEqual(context);
  await vault.rename('A.md', 'B.md'); const renamed = await vault.boardReferences.getContext(); expect(renamed.epoch).not.toBe(context.epoch);
  await vault.create('A.md', '# same'); const reused = await vault.boardReferences.getContext(); expect(reused.epoch).not.toBe(renamed.epoch);
  // Even identical bytes/hash must not turn a stale card write into success.
  await expect(vault.update('A.md', original.content, original.hash, context)).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' });
  await expect(vault.update('A.md', '# stale mutation', original.hash, context)).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' }); expect(await text(root, 'A.md')).toBe('# same');
  const okay = await vault.update('A.md', '# explicit current edit', original.hash, reused); expect(okay.conflict).toBe(false);
}));

test('folder rename commits links, empty folders, history and ledger while retaining board provenance', async () => fixture(async (root) => {
  const vault = new Vault(root); await vault.initialize(); await vault.folder('Folder/Empty');
  const first = await vault.create('Folder/A.md', '# first'); await vault.update(first.path, '# second', first.hash);
  await vault.create('Links.md', '[[Folder/A]]\n\n[local](Folder/A.md)');
  await vault.create('Map.canvas', JSON.stringify({ nodes: [{ id: 'file', type: 'file', x: 0, y: 0, width: 200, height: 100, file: 'Folder/A.md' }], edges: [] }));
  const context = await vault.boardReferences.getContext(), board = createBoard(context); const boardBytes = JSON.stringify(board);
  await vault.boardTransactions.run({ writes: [{ path: 'Folder/Board.board', content: boardBytes }] });
  const result = await vault.rename('Folder', 'Moved'); expect(result.moved['Folder/A.md']).toBe('Moved/A.md');
  expect(await text(root, 'Links.md')).toContain('[local](Moved/A.md)'); expect(await text(root, 'Links.md')).not.toContain('Folder/A');
  expect(JSON.parse(await text(root, 'Map.canvas')).nodes[0].file).toBe('Moved/A.md'); expect(await readdir(path.join(root, 'Moved/Empty'))).toEqual([]);
  expect((await vault.versions('Moved/A.md')).length).toBeGreaterThanOrEqual(2); expect(await text(root, 'Moved/Board.board')).toBe(boardBytes);
  expect((await vault.read('Moved/Board.board')).kind).toBe('board'); expect((await vault.boardReferences.getContext()).epoch).not.toBe(context.epoch);
  await expect(vault.boardReferences.assertContext(board.referenceContext)).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' });
  await expect(readdir(path.join(root, 'Folder'))).rejects.toMatchObject({ code: 'ENOENT' });
}));

test('folder trash and restore preserve exact board bytes and never bless old reference contexts', async () => fixture(async (root) => {
  const vault = new Vault(root); await vault.initialize(); await vault.folder('Folder/Empty'); await vault.create('Folder/A.md', '# original');
  const context = await vault.boardReferences.getContext(), board = JSON.stringify(createBoard(context)); await vault.boardTransactions.run({ writes: [{ path: 'Folder/Drawing.board', content: board }] });
  const trashed = await vault.trash('Folder'); const deleted = await vault.boardReferences.getContext(); expect(deleted.epoch).not.toBe(context.epoch); expect((await vault.trashList())[0].id).toBe(trashed.id);
  await vault.restoreTrash(trashed.id); const restored = await vault.boardReferences.getContext(); expect(restored.epoch).not.toBe(deleted.epoch);
  expect(await text(root, 'Folder/A.md')).toBe('# original'); expect(await text(root, 'Folder/Drawing.board')).toBe(board); expect(await readdir(path.join(root, 'Folder/Empty'))).toEqual([]); expect(await vault.trashList()).toEqual([]);
  await expect(vault.boardReferences.assertContext(context)).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' });
}));

test('generic routes protect managed assets and containing ancestors, including archive imports', async () => fixture(async (root) => {
  const vault = new Vault(root); await vault.initialize(); const asset = `${MANAGED_ASSET_ROOT}/${'a'.repeat(64)}.png`;
  await vault.boardTransactions.run({ writes: [{ path: asset, content: 'immutable bytes' }] });
  await vault.create('Note.md', '# note'); const trashed = await vault.trash('Note.md');
  for (const action of [() => vault.upload(asset, encode('overwrite'), true), () => vault.create(asset, 'overwrite'), () => vault.update(asset, 'overwrite', ''), () => vault.trash(asset), () => vault.trash('attachments'), () => vault.rename('attachments', 'MovedAttachments'), () => vault.rename(asset, 'copy.png'), () => vault.restoreTrash(trashed.id, `${MANAGED_ASSET_ROOT}/injected.md`), () => vault.folder(`${MANAGED_ASSET_ROOT}/Folder`)]) await expect(action()).rejects.toMatchObject({ code: 'MANAGED_BOARD_ASSET' });
  const archive = Buffer.from(zipSync({ [asset]: Buffer.from('overwrite'), 'Ordinary.md': Buffer.from('# imported') })).toString('base64');
  const imported = await vault.importArchive(archive, true); expect(imported.skipped).toContain(asset); expect(imported.imported).toBe(1); expect(await text(root, asset)).toBe('immutable bytes');
}));

test('board documents allow four MiB reads but require dedicated create/update/import/history APIs', async () => fixture(async (root) => {
  const vault = new Vault(root); await vault.initialize(); const board = createBoard(await vault.boardReferences.getContext()); board.extensions.padding = 'a'.repeat(2 * 1024 ** 2 + 100);
  const content = JSON.stringify(board); await vault.boardTransactions.run({ writes: [{ path: 'Large.board', content }] });
  expect((await vault.read('Large.board')).content).toBe(content); expect((await vault.listFiles()).find((file: { path: string }) => file.path === 'Large.board').kind).toBe('board');
  for (const action of [() => vault.create('New.board', content), () => vault.update('Large.board', content, ''), () => vault.upload('Imported.board', encode(content)), () => vault.restoreVersion('Large.board', 'invalid', '')]) await expect(action()).rejects.toMatchObject({ code: 'BOARD_API_REQUIRED' });
  const archive = Buffer.from(zipSync({ 'Imported.board': Buffer.from(content) })).toString('base64'); expect((await vault.importArchive(archive)).skipped).toEqual(['Imported.board']);
  await vault.boardTransactions.run({ writes: [{ path: 'Broken.board', content: '{"schemaVersion":999}' }] }); await expect(vault.read('Broken.board')).rejects.toThrow();
}));

test('merge, import overwrite and history restore rotate identity while content updates do not', async () => fixture(async (root) => {
  const vault = new Vault(root); await vault.initialize(); const source = await vault.create('Source.md', '# source'), target = await vault.create('Target.md', '# target'); await vault.create('Links.md', '[[Source]]');
  const first = await vault.boardReferences.getContext(); await vault.merge(source.path, target.path, source.hash, target.hash); const merged = await vault.boardReferences.getContext(); expect(merged.epoch).not.toBe(first.epoch);
  expect(await text(root, 'Links.md')).toBe('[[Target]]'); expect((await vault.trashList())[0].path).toBe('Source.md');
  await vault.upload('Target.md', encode('# replacement'), true); const replaced = await vault.boardReferences.getContext(); expect(replaced.epoch).not.toBe(merged.epoch);
  const versions = await vault.versions('Target.md'); const version = (await Promise.all(versions.map((entry: { id: string }) => vault.version('Target.md', entry.id)))).find((entry: { content: string }) => entry.content === '# target');
  await vault.restoreVersion('Target.md', version.id, (await vault.read('Target.md')).hash); expect((await vault.boardReferences.getContext()).epoch).not.toBe(replaced.epoch); expect(await text(root, 'Target.md')).toBe('# target');
}));

test('post-COMMIT structural failure holds every public read/mutation behind recovery', async () => fixture(async (root) => {
  let armed = false; const vault = new Vault(root, { fault: async (point: string) => { if (armed && point === 'after-apply') throw new Error('Injected destination failure'); } }); await vault.initialize();
  const original = await vault.create('A.md', '# old'); await vault.upload('image.png', encode('bytes')); const oldContext = await vault.boardReferences.getContext(); armed = true;
  await expect(vault.rename('A.md', 'B.md')).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED' });
  for (const action of [() => vault.read('A.md'), () => vault.list(), () => vault.listFiles(), () => vault.versions('A.md'), () => vault.version('A.md', '0-00000000-0000-0000-0000-000000000000'), () => vault.trashList(), () => vault.exportArchive(), () => vault.attachment('image.png'), () => vault.settings(), () => vault.settings({ a: 1 }), () => vault.create('Other.md', '# other'), () => vault.update('A.md', '# update', original.hash)]) await expect(action()).rejects.toMatchObject({ code: 'BOARD_RECOVERY_REQUIRED' });
  const restarted = new Vault(root); await restarted.initialize(); expect((await restarted.read('B.md')).content).toBe('# old'); await expect(restarted.read('A.md')).rejects.toMatchObject({ status: 404 }); expect((await restarted.boardReferences.getContext()).epoch).not.toBe(oldContext.epoch);
}));

test('over-budget structural operations fail before note bytes or reference epoch change', async () => fixture(async (root) => {
  await mkdir(path.join(root, 'Folder')); await Promise.all(Array.from({ length: 101 }, (_, index) => writeFile(path.join(root, `Folder/${index}.md`), '# same')));
  const vault = new Vault(root); await vault.initialize(); const context = await vault.boardReferences.getContext();
  await expect(vault.rename('Folder', 'Moved')).rejects.toMatchObject({ status: 413 }); await expect(vault.trash('Folder')).rejects.toMatchObject({ status: 413 }); expect(await vault.boardReferences.getContext()).toEqual(context); expect((await readdir(path.join(root, 'Folder'))).length).toBe(101); await expect(readdir(path.join(root, 'Moved'))).rejects.toMatchObject({ code: 'ENOENT' });
}));

test('renaming back reuses identical historical records and attachments cannot acquire document identities', async () => fixture(async (root) => {
  const vault = new Vault(root); await vault.initialize(); await vault.create('A.md', '# original');
  await vault.rename('A.md', 'B.md'); await vault.rename('B.md', 'A.md'); expect((await vault.read('A.md')).content).toBe('# original'); expect((await vault.versions('A.md')).length).toBe(1);
  await vault.upload('text.txt', encode('# imported outside note route')); const context = await vault.boardReferences.getContext();
  await expect(vault.rename('text.txt', 'Reused.md')).rejects.toMatchObject({ status: 400 }); await expect(vault.rename('text.txt', 'Drawing.board')).rejects.toMatchObject({ status: 400 }); expect(await vault.boardReferences.getContext()).toEqual(context);
}));

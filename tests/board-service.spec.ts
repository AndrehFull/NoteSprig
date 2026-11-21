import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import sharp from 'sharp';
// @ts-ignore Native service modules.
import { Vault } from '../server/vault.mjs';
// @ts-ignore Native service modules.
import { Boards, managedAssetPath, inspectBoardImage } from '../server/boards.mjs';
// @ts-ignore Shared native schema.
import { createBoard, CARD_PREFIX } from '../shared/board-schema.mjs';
async function fixture(run: (vault: any, boards: any, root: string) => Promise<void>) { const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-board-service-')); try { const vault = new Vault(root); await vault.initialize(); await run(vault, new Boards(vault), root); } finally { await rm(root, { recursive: true, force: true }); } }
const clone = (value: any) => JSON.parse(JSON.stringify(value));
const card = (id: string, relative: string, isDeleted = false) => ({ id, type: 'embeddable', x: 0, y: 0, width: 320, height: 200, angle: 0, isDeleted, link: CARD_PREFIX + randomUUID(), customData: { notesprig: { version: 1, kind: 'note-card', binding: { state: 'bound', path: relative } } } });
const png = () => sharp({ create: { width: 4, height: 3, channels: 4, background: '#ff0080' } }).png().toBuffer();

test('conditional board saves detect conflicts and exact retries acknowledge without duplicate history', async () => fixture(async (vault, boards) => {
  const context = await boards.context(), board = createBoard(context);
  const created = await boards.save({ path: 'Drawing.board', board, context, create: true });
  const retried = await boards.save({ path: 'Drawing.board', board, context, create: true }); expect(retried.hash).toBe(created.hash); expect((await vault.versions('Drawing.board')).length).toBe(1);
  const first = clone(board), second = clone(board); first.extensions.edit = 'one'; second.extensions.edit = 'two';
  const saved = await boards.save({ path: 'Drawing.board', board: first, baseHash: created.hash, context });
  await expect(boards.save({ path: 'Drawing.board', board: second, baseHash: created.hash, context })).rejects.toMatchObject({ code: 'BOARD_CONFLICT', status: 409 });
  const retry = await boards.save({ path: 'Drawing.board', board: first, baseHash: created.hash, context }); expect(retry.hash).toBe(saved.hash);
  expect((await boards.read('Drawing.board', context)).board.extensions.edit).toBe('one');
  await expect(boards.save({ path: 'Copy.board', board: first, create: true, context })).rejects.toMatchObject({ code: 'DUPLICATE_BOARD_ID' });
  await expect(boards.save({ path: 'Drawing.board', board: createBoard(context), create: true, context })).rejects.toMatchObject({ code: 'BOARD_CONFLICT' });
}));

test('managed images are decoded, hashed, idempotent and verified before board publication', async () => fixture(async (vault, boards, root) => {
  const context = await boards.context(), bytes = await png(), expected = createHash('sha256').update(bytes).digest('hex');
  const asset = await boards.assetUpload({ base64: bytes.toString('base64'), context }); expect(asset).toEqual({ sha256: expected, mimeType: 'image/png', byteLength: bytes.length, width: 4, height: 3 });
  expect(await boards.assetUpload({ base64: bytes.toString('base64'), context })).toEqual(asset); expect(await readFile(path.join(root, managedAssetPath(asset)))).toEqual(bytes);
  const download = await boards.asset({ sha256: asset.sha256, mimeType: asset.mimeType, context }); expect(Buffer.from(download.base64, 'base64')).toEqual(bytes);
  const board = createBoard(context); board.assets.image = { ...asset, extraMetadata: { safe: true } }; board.scene.elements.push({ id: 'image', type: 'image', x: 0, y: 0, width: 4, height: 3, angle: 0, fileId: 'image' });
  const created = await boards.save({ path: 'Images.board', board, context, create: true }); expect(created.board.assets.image.extraMetadata).toEqual({ safe: true });
  await expect(vault.upload(managedAssetPath(asset), Buffer.from('bad').toString('base64'), true)).rejects.toMatchObject({ code: 'MANAGED_BOARD_ASSET' });
  await writeFile(path.join(root, managedAssetPath(asset)), Buffer.from('corrupt'));
  await expect(boards.asset({ sha256: asset.sha256, mimeType: asset.mimeType, context })).rejects.toMatchObject({ code: 'MISSING_ASSET' });
  const edited = clone(board); edited.extensions.edit = 1;
  await expect(boards.save({ path: 'Images.board', board: edited, baseHash: created.hash, context })).rejects.toMatchObject({ code: 'MISSING_ASSET' });
  expect((await boards.read('Images.board', context)).hash).toBe(created.hash);
}));

test('decoder rejects invalid, unsupported, truncated and oversized image dimensions', async () => {
  for (const format of ['png', 'jpeg', 'webp'] as const) {
    const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#ffffff' } })[format]().toBuffer();
    expect((await inspectBoardImage(bytes)).mimeType).toBe(`image/${format}`);
  }
  await expect(inspectBoardImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>'))).rejects.toThrow();
  await expect(inspectBoardImage(Buffer.from('invalid encoded image'))).rejects.toThrow();
  await expect(inspectBoardImage((await png()).subarray(0, 45))).rejects.toThrow();
  const tooWide = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer(); await expect(inspectBoardImage(tooWide)).rejects.toThrow();
});

test('missing assets and forged metadata reject a board without writing a partial document', async () => fixture(async (_vault, boards) => {
  const context = await boards.context(), board = createBoard(context), bytes = await png(); const asset = await inspectBoardImage(bytes);
  board.assets.image = asset; await expect(boards.save({ path: 'Missing.board', board, context, create: true })).rejects.toMatchObject({ code: 'MISSING_ASSET' }); await expect(boards.read('Missing.board', context)).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
  await boards.assetUpload({ base64: bytes.toString('base64'), context }); board.assets.image.width = 5;
  await expect(boards.save({ path: 'Forged.board', board, context, create: true })).rejects.toMatchObject({ code: 'INVALID_ASSET' }); await expect(boards.read('Forged.board', context)).rejects.toMatchObject({ code: 'BOARD_NOT_FOUND' });
}));

test('stale references require explicit complete review before preview, board save or card editor write', async () => fixture(async (vault, boards) => {
  await vault.create('A.md', '# Original\n\nprivate original excerpt'); const context = await boards.context(), board = createBoard(context);
  board.scene.elements.push(card('live', 'A.md'), card('deleted', 'A.md', true));
  const created = await boards.save({ path: 'References.board', board, context, create: true });
  expect((await boards.preview({ path: 'A.md', context })).excerpt).toContain('private original excerpt');
  await vault.rename('A.md', 'B.md'); await vault.create('A.md', '# Different\n\nnew unrelated identity'); const currentContext = await boards.context();
  await expect(boards.preview({ path: 'A.md', context })).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' });
  await expect(boards.save({ path: 'References.board', board, context, baseHash: created.hash })).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' });
  const stamped = clone(board); stamped.referenceContext = currentContext;
  await expect(boards.save({ path: 'References.board', board: stamped, context: currentContext, baseHash: created.hash })).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' });
  const nowA = await vault.read('A.md'); await expect(vault.update('A.md', nowA.content, nowA.hash, context)).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' });
  await expect(boards.review({ path: 'References.board', baseHash: created.hash, context: currentContext, previousContext: context, bindings: [] })).rejects.toThrow('Review every live note card');
  await expect(boards.review({ path: 'References.board', baseHash: created.hash, context: currentContext, previousContext: context, bindings: [null] })).rejects.toMatchObject({ code: 'INVALID_BOARD' });
  const reviewed = await boards.review({ path: 'References.board', baseHash: created.hash, context: currentContext, previousContext: context, bindings: [{ elementId: 'live', state: 'bound', path: 'B.md' }] });
  expect(reviewed.board.referenceContext).toEqual(currentContext); expect(reviewed.board.scene.elements[0].customData.notesprig.binding.path).toBe('B.md'); expect(reviewed.board.scene.elements[1].customData.notesprig.binding.state).toBe('unbound');
  expect((await boards.preview({ path: 'B.md', context: currentContext })).excerpt).toContain('private original excerpt');
  await expect(boards.read('References.board', { ...currentContext, restoreGeneration: randomUUID() })).rejects.toMatchObject({ code: 'RESTORE_CONTEXT_MISMATCH' });
}));

test('history checkpoints honor the durable 45-second interval across service recreation', async () => fixture(async (vault, boards) => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  try {
    const context = await boards.context(), board = createBoard(context); let saved = await boards.save({ path: 'History.board', board, context, create: true });
    now += 1000; board.extensions.edit = 1; saved = await new Boards(vault).save({ path: saved.path, board, context, baseHash: saved.hash }); expect((await vault.versions(saved.path)).length).toBe(1);
    now += 45000; board.extensions.edit = 2; saved = await new Boards(vault).save({ path: saved.path, board, context, baseHash: saved.hash }); expect((await vault.versions(saved.path)).length).toBe(2);
    await vault.rename('History.board', 'Moved.board'); expect((await vault.versions('Moved.board')).length).toBe(2);
    board.extensions.edit = 3; saved = await new Boards(vault).save({ path: 'Moved.board', board, context, baseHash: saved.hash });
    await vault.trash('Moved.board'); expect((await vault.versions('Moved.board')).length).toBe(3);
  } finally { Date.now = originalNow; }
}));

test('board checkpoint retention remains bounded at 100 durable versions', async () => fixture(async (vault, boards) => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  try {
    const context = await boards.context(), board = createBoard(context); let saved = await boards.save({ path: 'Retention.board', board, context, create: true });
    for (let index = 0; index < 101; index++) { now += 45001; board.extensions.counter = index; saved = await boards.save({ path: saved.path, board, baseHash: saved.hash, context }); }
    expect((await vault.versions('Retention.board')).length).toBe(100); expect((await boards.read('Retention.board', context)).board.extensions.counter).toBe(100);
  } finally { Date.now = originalNow; }
}));

test('graph links derive only from current canonical live bound cards', async () => fixture(async (vault, boards) => {
  await vault.create('A.md', '# A'); await vault.create('B.md', '# B'); const context = await boards.context(), board = createBoard(context);
  const unbound = card('unbound', 'B.md'); unbound.customData.notesprig.binding.state = 'unbound';
  board.scene.elements.push(card('one', 'A.md'), card('duplicate', 'A.md'), card('deleted', 'B.md', true), unbound);
  await boards.save({ path: 'Graph.board', board, context, create: true });
  const indexed = (await vault.listFiles()).find((file: any) => file.path === 'Graph.board'); expect(indexed.links).toEqual([{ target: 'A.md', embed: true, kind: 'wiki' }]);
  await vault.rename('A.md', 'Renamed.md'); const stale = (await vault.listFiles()).find((file: any) => file.path === 'Graph.board'); expect(stale.links).toEqual([]);
}));

test('board history restore preserves the historical context and forces a checkpoint in the same commit', async () => fixture(async (vault, boards) => {
  await vault.create('A.md', '# Original'); const context = await boards.context(), board = createBoard(context); board.scene.elements.push(card('card', 'A.md'));
  const original = await boards.save({ path: 'Restore.board', board, context, create: true }); const [version] = await vault.versions('Restore.board');
  const edited = clone(board); edited.scene.elements[0].x = 42; const updated = await boards.save({ path: 'Restore.board', board: edited, context, baseHash: original.hash });
  await vault.rename('A.md', 'B.md'); const current = await boards.context();
  const restored = await boards.restore({ path: 'Restore.board', id: version.id, baseHash: updated.hash, context: current });
  expect(restored.board.scene.elements[0].x).toBe(0); expect(restored.board.referenceContext).toEqual(context); expect((await vault.versions('Restore.board')).length).toBe(2);
  await expect(boards.preview({ path: 'A.md', context: restored.board.referenceContext })).rejects.toMatchObject({ code: 'REFERENCE_REVIEW_REQUIRED' });
  await expect(boards.restore({ path: 'Restore.board', id: version.id, baseHash: updated.hash, context: current })).rejects.toMatchObject({ code: 'BOARD_CONFLICT' });
  const reviewed = await boards.review({ path: 'Restore.board', baseHash: restored.hash, context: current, previousContext: context, bindings: [{ elementId: 'card', state: 'bound', path: 'B.md' }] }); expect(reviewed.board.referenceContext).toEqual(current);
}));

test('board history restore validates historical image dependencies and preserves current bytes on failure', async () => fixture(async (vault, boards, root) => {
  const context = await boards.context(), bytes = await png(), asset = await boards.assetUpload({ base64: bytes.toString('base64'), context }); const board = createBoard(context); board.assets.image = asset;
  const original = await boards.save({ path: 'AssetRestore.board', board, context, create: true }); const [version] = await vault.versions('AssetRestore.board'); const empty = clone(board); empty.assets = {};
  const updated = await boards.save({ path: original.path, board: empty, context, baseHash: original.hash }); await rm(path.join(root, managedAssetPath(asset)));
  await expect(boards.restore({ path: original.path, id: version.id, baseHash: updated.hash, context })).rejects.toMatchObject({ code: 'MISSING_ASSET' }); expect((await boards.read(original.path, context)).hash).toBe(updated.hash);
}));

test('animated WebP containers are rejected before publication', async () => {
  const bytes = await sharp(Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]), { raw: { width: 1, height: 2, channels: 4, pageHeight: 1 } }).webp({ loop: 0, delay: [100, 100] }).toBuffer();
  expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2); await expect(inspectBoardImage(bytes)).rejects.toThrow();
});

import { test, expect } from '@playwright/test';
import { zipSync, unzipSync, strToU8 } from 'fflate';
import { createBoard, CARD_PREFIX } from '../shared/board-schema.mjs';
import type { BoardDocument, BoardElement, ReferenceContext } from '../shared/board-schema.mjs';
import { convertCanvasToBoard, importExcalidraw, createPrivateBoardBundle, readPrivateBoardBundle, prepareImportedBoard } from '../src/boards/portability';

const context: ReferenceContext = { vaultId: '2514515c-8214-4b42-bfec-690fd32dd951', restoreGeneration: '51c478ab-02ba-4c2a-b6d8-917b5c4239ce', epoch: '8e847af2-88df-49b1-8a8a-987abc29c062' };
const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));
async function sha(bytes: Uint8Array): Promise<string> { return Buffer.from(await crypto.subtle.digest('SHA-256', bytes.slice().buffer)).toString('hex'); }
function card(): BoardElement { return { id: 'card', type: 'embeddable', x: 10, y: 20, width: 300, height: 200, angle: 0.1, link: CARD_PREFIX + '509c8e3b-b3a0-445c-a258-09f1d9fec8ad', customData: { notesprig: { version: 1, kind: 'note-card', binding: { state: 'bound', path: 'Private/Planning.md', fragment: '#Review' } } } }; }
async function populated(): Promise<{ board: BoardDocument; hash: string }> { const board = createBoard(context), hash = await sha(png); board.scene.elements = [card(), { id: 'image', type: 'image', x: 0, y: 0, width: 120, height: 120, angle: 0, fileId: 'raster' }]; board.assets.raster = { sha256: hash, mimeType: 'image/png', byteLength: png.length, width: 1, height: 1 }; board.extensions = { custom: { retained: [true, 'Future extension'] } }; return { board, hash }; }

test('Canvas conversion creates a separate native scene with unbound notes, native arrows and a fidelity report', () => {
  const source = JSON.stringify({ custom: { retained: true }, nodes: [{ id: 'group', type: 'group', x: 0, y: 0, width: 1000, height: 800, label: 'Project' }, { id: 'a', type: 'file', x: 40, y: 50, width: 300, height: 200, file: 'Plans/Project.md', subpath: '#Milestones' }, { id: 'b', type: 'text', x: 500, y: 50, width: 300, height: 200, text: '# Markdown is retained as text' }, { id: 'attachment', type: 'file', x: 500, y: 400, width: 200, height: 150, file: 'Photo.png' }], edges: [{ id: 'edge', fromNode: 'a', toNode: 'b', fromSide: 'right', toSide: 'left', label: 'depends on' }] });
  const result = convertCanvasToBoard(source, context);
  expect(result.source).toBe(source); expect(result.board.extensions.canvasSource).toBe(source); expect(result.report.sourcePreserved).toBe(true);
  expect(result.board.scene.elements.find((element) => element.id === 'canvas_node_1')).toMatchObject({ type: 'embeddable', frameId: 'canvas_node_0', customData: { notesprig: { binding: { state: 'unbound', path: 'Plans/Project.md', fragment: '#Milestones' } } } });
  expect(result.board.scene.elements.find((element) => element.id === 'canvas_edge_0')).toMatchObject({ type: 'arrow', startBinding: { elementId: 'canvas_node_1' }, endBinding: { elementId: 'canvas_node_2' } });
  expect(result.board.scene.elements.some((element) => element.text === '# Markdown is retained as text')).toBe(true);
  expect(result.report.requiresReferenceReview).toBe(true);
  expect(result.report.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(['group-converted-to-frame', 'reference-review-required', 'markdown-converted-to-plain-text', 'unsupported-content-placeholder', 'edge-label-layout-changed']));
  expect(() => convertCanvasToBoard(JSON.stringify({ nodes: [{ id: 'a', type: 'file', x: 0, y: 0, width: 300, height: 200, file: '../Escape.md' }] }), context)).toThrow('note path');
  expect(() => convertCanvasToBoard(JSON.stringify({ nodes: [], edges: [{ id: 'broken', fromNode: 'missing', toNode: 'missing' }] }), context)).toThrow('target missing');
});

test('foreign Excalidraw note cards never silently reactivate references and metadata is stripped', async () => {
  const original = card(); const source = JSON.stringify({ type: 'excalidraw', version: 2, elements: [original], appState: { viewBackgroundColor: '#aabbcc', collaborators: { private: true } }, files: {} });
  const result = await importExcalidraw(source, context);
  expect(result.source).toBe(source); expect(result.board.scene.elements).toHaveLength(1);
  expect(result.board.scene.elements[0]).toMatchObject({ id: 'card', type: 'embeddable', angle: 0.1, customData: { notesprig: { binding: { state: 'unbound', path: 'Private/Planning.md' } } } });
  expect(result.board.scene.elements[0].link).not.toBe(original.link);
  expect(result.board.scene.appState).toEqual({ viewBackgroundColor: '#aabbcc' });
  expect(result.report.requiresReferenceReview).toBe(true);
  await expect(importExcalidraw(JSON.stringify({ type: 'excalidraw', version: 99, elements: [] }), context)).rejects.toThrow('Unsupported');
  await expect(importExcalidraw('{"type":"excalidraw","version":2,"elements":[],"__proto__":{"unsafe":true}}', context)).rejects.toThrow('Unsafe');
});

test('native image import only accepts embedded bytes and requires host validation before producing a board', async () => {
  const source = JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'image', type: 'image', x: 0, y: 0, width: 100, height: 100, angle: 0, fileId: 'raster', scale: [1, -1], isDeleted: false }], files: { raster: { id: 'raster', mimeType: 'image/png', dataURL: 'data:image/png;base64,' + Buffer.from(png).toString('base64') } } });
  await expect(importExcalidraw(source, context)).rejects.toThrow('Image validation is required');
  let calls = 0;
  const result = await importExcalidraw(source, context, { validateImage: async (bytes, mime) => { calls++; expect(bytes).toEqual(png); expect(mime).toBe('image/png'); bytes.fill(0); return { width: 1, height: 1, mimeType: mime }; } });
  const hash = await sha(png); expect(calls).toBe(1); expect(result.assets[hash]).toEqual(png); expect(result.board.assets.raster).toMatchObject({ sha256: hash, width: 1, height: 1, byteLength: png.length });
  const external = source.replace('data:image/png;base64,' + Buffer.from(png).toString('base64'), 'https://example.com/private.png');
  await expect(importExcalidraw(external, context, { validateImage: async () => { throw new Error('Must not resolve external URL'); } })).rejects.toThrow('Unsupported imported image');
  await expect(importExcalidraw(source, context, { validateImage: async () => ({ width: 5000, height: 1 }) })).rejects.toThrow('dimensions');
});

test('private native bundle preserves exact source/context/extensions and every supplied pending byte', async () => {
  const { board, hash } = await populated(); const raw = JSON.stringify(board, null, 4) + '\n';
  const pending = new Uint8Array([1, 2, 3, 4]), pendingHash = await sha(pending);
  const output = await createPrivateBoardBundle(raw, { [hash]: new Blob([png]), [pendingHash]: pending });
  expect(output.manifest).toMatchObject({ type: 'notesprig-private-board-bundle', private: true, complete: true, missingHashes: [] });
  const restored = await readPrivateBoardBundle(output.bytes);
  expect(restored.rawBoard).toBe(raw); expect(restored.board).toEqual(board); expect(restored.board.referenceContext).toEqual(context); expect(restored.assets[hash]).toEqual(png); expect(restored.assets[pendingHash]).toEqual(pending);
  expect(restored.manifest.assets).toContainEqual({ sha256: pendingHash, byteLength: pending.length, required: false });
  const unbound = prepareImportedBoard(restored.board, { ...context, epoch: '4934fb49-7748-4067-9b45-ae3fac3329fc' });
  expect(unbound.boardId).not.toBe(board.boardId); expect(unbound.referenceContext.epoch).not.toBe(context.epoch); expect(unbound.scene.elements[0].customData?.notesprig?.binding.state).toBe('unbound'); expect(restored.board.scene.elements[0].customData?.notesprig?.binding.state).toBe('bound');
});

test('incomplete recovery explicitly enumerates missing dependencies and cannot claim completeness', async () => {
  const { board, hash } = await populated(); const bundle = await createPrivateBoardBundle(JSON.stringify(board));
  expect(bundle.manifest).toMatchObject({ complete: false, missingHashes: [hash], assets: [] });
  const restored = await readPrivateBoardBundle(bundle.bytes); expect(restored.manifest.complete).toBe(false); expect(restored.assets).toEqual({});
  const unpacked = unzipSync(bundle.bytes); const manifest = JSON.parse(new TextDecoder().decode(unpacked['manifest.json'])); manifest.complete = true; manifest.missingHashes = [];
  unpacked['manifest.json'] = strToU8(JSON.stringify(manifest));
  await expect(readPrivateBoardBundle(zipSync(unpacked))).rejects.toThrow('completeness');
});

test('tampered hashes, hidden paths, duplicate entries and forged expansion sizes fail before recovery succeeds', async () => {
  const { board, hash } = await populated(); const raw = JSON.stringify(board); const bundle = await createPrivateBoardBundle(raw, { [hash]: png });
  await expect(createPrivateBoardBundle(raw, { [hash]: new Uint8Array([0]) })).rejects.toThrow('digest mismatch');
  const unpacked = unzipSync(bundle.bytes); unpacked['assets/' + hash] = png.slice(); unpacked['assets/' + hash][20] ^= 1;
  await expect(readPrivateBoardBundle(zipSync(unpacked))).rejects.toThrow('verification failed');
  const hidden = unzipSync(bundle.bytes); hidden['../escape'] = new Uint8Array([1]);
  await expect(readPrivateBoardBundle(zipSync(hidden))).rejects.toThrow('Unsafe');
  const rawChanged = unzipSync(bundle.bytes); rawChanged['board.board'] = strToU8(raw + ' ');
  await expect(readPrivateBoardBundle(zipSync(rawChanged))).rejects.toThrow('board digest');
  const forged = bundle.bytes.slice(), view = new DataView(forged.buffer); let directory = 0;
  while (directory < forged.length - 46 && view.getUint32(directory, true) !== 0x02014b50) directory++;
  view.setUint32(directory + 24, 129 * 1024 ** 2, true);
  await expect(readPrivateBoardBundle(forged)).rejects.toThrow('expansion limit');
  const names = unzipSync(bundle.bytes); const duplicateArchive = zipSync({ ...names, 'board.boarD': new Uint8Array([1]) });
  // Replace equal-length local and central filenames: a normal unzip object would overwrite the first document.
  const needle = new TextEncoder().encode('board.boarD');
  let replacements = 0;
  for (let offset = 0; offset <= duplicateArchive.length - needle.length; offset++) if (needle.every((byte, index) => duplicateArchive[offset + index] === byte)) { duplicateArchive[offset + needle.length - 1] = 'd'.charCodeAt(0); replacements++; }
  expect(replacements).toBe(2);
  await expect(readPrivateBoardBundle(duplicateArchive)).rejects.toThrow('Unsafe');
  const forgedActual = bundle.bytes.slice(), forgedView = new DataView(forgedActual.buffer);
  let central = 0; while (central < forgedActual.length - 46 && forgedView.getUint32(central, true) !== 0x02014b50) central++;
  const local = forgedView.getUint32(central + 42, true);
  forgedView.setUint32(central + 24, 1, true); forgedView.setUint32(local + 22, 1, true);
  await expect(readPrivateBoardBundle(forgedActual)).rejects.toThrow('decompression limit');
});

import { Unzip, UnzipInflate, zipSync, strToU8, strFromU8 } from 'fflate';
import type { Zippable } from 'fflate';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import type { BoardDocument, BoardElement, BoardAsset, ReferenceContext } from '../../shared/board-schema.mjs';
import { BOARD_LIMITS, CARD_PREFIX, createBoard, validateBoard, validContext, validVaultPath, isManagedPath, persistedAppearance } from '../../shared/board-schema.mjs';
import { createSharingProjection } from './projection';

export type PortabilityIssue = { code: string; elementId?: string };
export type PortabilityReport = { sourcePreserved: true; requiresReferenceReview: boolean; issues: PortabilityIssue[] };
export type ConvertedBoard = { board: BoardDocument; source: string; assets: Record<string, Uint8Array>; report: PortabilityReport };
export type RasterValidation = (bytes: Uint8Array, mimeType: string) => Promise<{ width: number; height: number; mimeType?: string }>;
const HASH = /^[a-f\d]{64}$/;
const MAX_ARCHIVE = 128 * 1024 ** 2;
const MAX_MANIFEST = 128 * 1024;
const MAX_IMPORT = 96 * 1024 ** 2;
type Data = Record<string, any>;
function object(value: unknown): value is Data { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function boundedJSON(raw: string, maximum: number): Data {
  ensure(typeof raw === 'string' && strToU8(raw).length <= maximum, 'Import size limit exceeded.');
  const parsed: unknown = JSON.parse(raw); ensure(object(parsed), 'Invalid import document.');
  let nodes = 0;
  function check(value: unknown, depth = 0) {
    ensure(depth <= BOARD_LIMITS.depth && ++nodes <= BOARD_LIMITS.nodes, 'Import complexity limit exceeded.');
    if (value && typeof value === 'object') for (const key of Object.keys(value)) { ensure(!['__proto__', 'constructor', 'prototype'].includes(key), 'Unsafe import property.'); check((value as Data)[key], depth + 1); }
  }
  check(parsed); return parsed;
}
async function digest(bytes: Uint8Array): Promise<string> { const result = await crypto.subtle.digest('SHA-256', bytes.slice().buffer); return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
function shape(id: string, type: string, x: number, y: number, width: number, height: number, extra: Data = {}): BoardElement {
  ensure([x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 10000000) && width >= 0 && height >= 0, 'Invalid imported geometry.');
  return { id, type, x, y, width, height, angle: 0, strokeColor: '#343a40', backgroundColor: '#ffffff', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roundness: null, roughness: 0, opacity: 100, seed: 1, version: 1, versionNonce: 1, index: null, isDeleted: false, groupIds: [], frameId: null, boundElements: null, updated: 0, link: null, locked: false, ...extra };
}
function noteMetadata(element: Data): Data | null { return object(element.customData) && object(element.customData.notesprig) && element.customData.notesprig.kind === 'note-card' ? element.customData.notesprig : null; }
function unboundCard(element: BoardElement, path: unknown, fragment?: unknown): BoardElement {
  const candidate = typeof path === 'string' && validVaultPath(path) && path.toLowerCase().endsWith('.md') && !isManagedPath(path) ? path : 'Unbound.md';
  return { ...element, type: 'embeddable', boundElements: (element.boundElements || []).filter((entry: Data) => entry.type === 'arrow'), link: CARD_PREFIX + crypto.randomUUID(), customData: { notesprig: { version: 1, kind: 'note-card', binding: { state: 'unbound', path: candidate, ...(typeof fragment === 'string' && fragment.length <= 1024 ? { fragment } : {}) } } } };
}
function label(parent: BoardElement, text: string, id: string): BoardElement {
  ensure(text.length <= BOARD_LIMITS.textPerElement, 'Imported text limit exceeded.');
  const child = shape(id, 'text', parent.x + 12, parent.y + 12, Math.max(1, parent.width - 24), Math.max(1, parent.height - 24), { text, originalText: text, fontSize: 16, fontFamily: 3, textAlign: 'left', verticalAlign: 'top', containerId: parent.id, autoResize: false, lineHeight: 1.25, backgroundColor: 'transparent' });
  parent.boundElements = [{ id: child.id, type: 'text' }]; return child;
}

/** Creates a separate document. It never changes the original Canvas or resolves a file reference. */
export function convertCanvasToBoard(source: string, context: ReferenceContext): ConvertedBoard {
  const canvas = boundedJSON(source, 2 * 1024 ** 2); const nodes = canvas.nodes ?? [], edges = canvas.edges ?? [];
  ensure(Array.isArray(nodes) && Array.isArray(edges) && nodes.length + edges.length <= BOARD_LIMITS.elements, 'Invalid Canvas element list.');
  const board = createBoard(context), issues: PortabilityIssue[] = [], map = new Map<string, BoardElement>();
  const originalIds = new Set<string>();
  for (const [index, node] of nodes.entries()) {
    ensure(object(node) && typeof node.id === 'string' && !originalIds.has(node.id), 'Duplicate or invalid Canvas node ID.'); originalIds.add(node.id);
    const id = `canvas_node_${index}`;
    let item = shape(id, node.type === 'group' ? 'frame' : 'rectangle', node.x, node.y, node.width, node.height);
    if (node.type === 'file' && typeof node.file === 'string' && node.file.toLowerCase().endsWith('.md')) {
      ensure(validVaultPath(node.file), 'Invalid Canvas note path.'); item = unboundCard(item, node.file, node.subpath); issues.push({ code: 'reference-review-required', elementId: id });
    } else if (node.type === 'group') { item.name = typeof node.label === 'string' ? node.label : null; issues.push({ code: 'group-converted-to-frame', elementId: id }); }
    else if (node.type === 'text') { ensure(typeof node.text === 'string', 'Invalid Canvas text.'); board.scene.elements.push(item, label(item, node.text, id + '_label')); issues.push({ code: 'markdown-converted-to-plain-text', elementId: id }); map.set(node.id, item); continue; }
    else {
      const text = node.type === 'link' && typeof node.url === 'string' ? node.url : node.type === 'file' ? 'Attachment requires import' : 'Unsupported Canvas content';
      if (node.type === 'link') { try { const url = new URL(node.url); if (['https:', 'http:', 'mailto:'].includes(url.protocol)) item.link = url.href; } catch { /* Visible text is retained without activating an invalid URL. */ } }
      board.scene.elements.push(item, label(item, text, id + '_label')); issues.push({ code: node.type === 'link' ? 'link-converted-to-static-card' : 'unsupported-content-placeholder', elementId: id }); map.set(node.id, item); continue;
    }
    board.scene.elements.push(item); map.set(node.id, item);
  }
  const frameNodes = board.scene.elements.filter((item) => item.type === 'frame');
  for (const item of board.scene.elements) {
    const containing = frameNodes.filter((frame) => frame.id !== item.id && frame.width * frame.height > item.width * item.height && item.x >= frame.x && item.y >= frame.y && item.x + item.width <= frame.x + frame.width && item.y + item.height <= frame.y + frame.height).sort((a, b) => a.width * a.height - b.width * b.height);
    if (containing[0]) item.frameId = containing[0].id;
  }
  function endpoint(item: BoardElement, side: unknown): [number, number] { return [item.x + (side === 'left' ? 0 : side === 'right' ? item.width : item.width / 2), item.y + (side === 'top' ? 0 : side === 'bottom' ? item.height : item.height / 2)]; }
  const edgeIds = new Set<string>();
  for (const [index, edge] of edges.entries()) {
    ensure(object(edge) && typeof edge.id === 'string' && !edgeIds.has(edge.id), 'Duplicate or invalid Canvas edge ID.'); edgeIds.add(edge.id);
    const from = map.get(edge.fromNode), to = map.get(edge.toNode); ensure(from && to, 'Canvas edge target missing.');
    const start = endpoint(from, edge.fromSide), end = endpoint(to, edge.toSide), id = `canvas_edge_${index}`;
    const item = shape(id, 'arrow', start[0], start[1], Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1]), { points: [[0, 0], [end[0] - start[0], end[1] - start[1]]], lastCommittedPoint: null, startBinding: { elementId: from.id, focus: 0, gap: 0 }, endBinding: { elementId: to.id, focus: 0, gap: 0 }, startArrowhead: edge.fromEnd === 'arrow' ? 'arrow' : null, endArrowhead: edge.toEnd === 'none' ? null : 'arrow', elbowed: false });
    from.boundElements = [...(from.boundElements || []), { id, type: 'arrow' }]; to.boundElements = [...(to.boundElements || []), { id, type: 'arrow' }]; board.scene.elements.push(item);
    if (typeof edge.label === 'string' && edge.label) { board.scene.elements.push(label(item, edge.label, id + '_label')); issues.push({ code: 'edge-label-layout-changed', elementId: id }); }
  }
  issues.push({ code: 'canvas-style-and-layout-review' });
  board.extensions = { canvasSource: source };
  return { board: validateBoard(board), source, assets: {}, report: { sourcePreserved: true, requiresReferenceReview: board.scene.elements.some((item) => item.type === 'embeddable'), issues } };
}

/** Native ingress accepts embedded raster bytes only. The host must validate/decode images before commit. */
export async function importExcalidraw(source: string, context: ReferenceContext, options: { validateImage?: RasterValidation } = {}): Promise<ConvertedBoard> {
  ensure(validContext(context), 'Invalid workspace identity.'); const input = boundedJSON(source, MAX_IMPORT);
  ensure(input.type === 'excalidraw' && input.version === 2 && Array.isArray(input.elements) && input.elements.length <= BOARD_LIMITS.elements, 'Unsupported Excalidraw document.');
  const inputFiles = object(input.files) ? input.files : {}, validatedFiles: BinaryFiles = {}, assets: Record<string, Uint8Array> = {}, manifest: Record<string, BoardAsset> = {};
  ensure(Object.keys(inputFiles).length <= BOARD_LIMITS.assets, 'Imported image count limit exceeded.');
  let totalBytes = 0, pixels = 0;
  const needed = new Set<string>(input.elements.filter((item: Data) => item?.type === 'image' && !item.isDeleted).map((item: Data) => item.fileId));
  for (const fileId of needed) {
    ensure(typeof fileId === 'string' && /^[a-zA-Z\d_-]{1,128}$/.test(fileId) && !['__proto__', 'constructor', 'prototype'].includes(fileId), 'Invalid imported image ID.');
    const file = inputFiles[fileId]; ensure(object(file) && typeof file.dataURL === 'string' && file.dataURL.length <= Math.ceil(BOARD_LIMITS.assetBytes / 3) * 4 + 64, 'Imported image missing or too large.');
    const match = /^data:(image\/(?:png|jpeg|webp));base64,([a-z\d+/]+={0,2})$/i.exec(file.dataURL);
    ensure(match && match[2].length % 4 === 0 && match[1].toLowerCase() === file.mimeType, 'Unsupported imported image.');
    const decoded = atob(match[2]), bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0)); totalBytes += bytes.length;
    ensure(bytes.length > 0 && bytes.length <= BOARD_LIMITS.assetBytes && totalBytes <= BOARD_LIMITS.totalAssetBytes, 'Imported image byte budget exceeded.');
    ensure(options.validateImage, 'Image validation is required before importing raster content.');
    const dimensions = await options.validateImage(bytes.slice(), file.mimeType);
    ensure(['width', 'height'].every((key) => Number.isSafeInteger(dimensions[key as 'width' | 'height']) && dimensions[key as 'width' | 'height'] > 0 && dimensions[key as 'width' | 'height'] <= BOARD_LIMITS.dimension) && (!dimensions.mimeType || dimensions.mimeType === file.mimeType), 'Invalid imported image dimensions.');
    pixels += dimensions.width * dimensions.height; ensure(pixels <= BOARD_LIMITS.pixels, 'Imported image pixel budget exceeded.');
    const sha256 = await digest(bytes); assets[sha256] = bytes; manifest[fileId] = { sha256, byteLength: bytes.length, mimeType: file.mimeType, width: dimensions.width, height: dimensions.height }; validatedFiles[fileId] = { id: fileId, dataURL: file.dataURL, mimeType: file.mimeType, created: 0 } as BinaryFiles[string];
  }
  const projected = createSharingProjection({ elements: input.elements, appState: input.appState, files: validatedFiles });
  const cards = new Map<string, Data>(input.elements.filter((item: Data) => object(item) && noteMetadata(item)).map((item: Data) => [item.id, item]));
  const generatedText = new Set<string>();
  for (const item of projected.elements) if (cards.has(item.id)) for (const bound of item.boundElements || []) if (bound.type === 'text') generatedText.add(bound.id);
  const board = createBoard(context); board.assets = manifest; board.scene.appState = persistedAppearance(projected.appState);
  board.scene.elements = projected.elements.filter((item) => !generatedText.has(item.id)).map((item) => {
    const original = cards.get(item.id); if (!original) return item as unknown as BoardElement;
    const binding = noteMetadata(original)?.binding; return unboundCard(item as unknown as BoardElement, binding?.path, binding?.fragment);
  });
  return { board: validateBoard(board), source, assets, report: { sourcePreserved: true, requiresReferenceReview: cards.size > 0, issues: [...projected.report.issues.map((issue) => ({ ...issue })), ...(cards.size ? [{ code: 'reference-review-required' }] : [])] } };
}

export type PrivateBundleManifest = { type: 'notesprig-private-board-bundle'; schemaVersion: 1; private: true; complete: boolean; boardSha256: string; assets: { sha256: string; byteLength: number; required: boolean }[]; missingHashes: string[] };
export type PrivateBundle = { bytes: Uint8Array; manifest: PrivateBundleManifest };
/** All supplied locally unique dependencies are included, including bytes needed only by undo/outbox. */
export async function createPrivateBoardBundle(rawBoard: string, supplied: Readonly<Record<string, Uint8Array | Blob>> = {}): Promise<PrivateBundle> {
  const board = validateBoard(rawBoard), required = new Map<string, number>();
  for (const asset of Object.values(board.assets)) { ensure(!required.has(asset.sha256) || required.get(asset.sha256) === asset.byteLength, 'Inconsistent asset manifest.'); required.set(asset.sha256, asset.byteLength); }
  const entries: Zippable = { 'board.board': strToU8(rawBoard) }, assets: PrivateBundleManifest['assets'] = []; let total = 0;
  ensure(Object.keys(supplied).length <= BOARD_LIMITS.assets, 'Recovery asset count limit exceeded.');
  for (const [sha256, source] of Object.entries(supplied)) {
    ensure(HASH.test(sha256), 'Invalid recovery asset hash.');
    ensure(source instanceof Uint8Array ? source.byteLength <= BOARD_LIMITS.assetBytes : source instanceof Blob && source.size <= BOARD_LIMITS.assetBytes, 'Recovery asset byte budget exceeded.');
    const bytes = source instanceof Uint8Array ? source.slice() : new Uint8Array(await source.arrayBuffer());
    total += bytes.length; ensure(bytes.length > 0 && bytes.length <= BOARD_LIMITS.assetBytes && total <= BOARD_LIMITS.totalAssetBytes, 'Recovery asset byte budget exceeded.');
    ensure(await digest(bytes) === sha256, 'Recovery asset digest mismatch.'); ensure(!required.has(sha256) || required.get(sha256) === bytes.length, 'Recovery asset size mismatch.');
    entries['assets/' + sha256] = [bytes, { level: 0 }]; assets.push({ sha256, byteLength: bytes.length, required: required.has(sha256) });
  }
  const missingHashes = [...required.keys()].filter((hash) => !Object.hasOwn(supplied, hash)).sort();
  const manifest: PrivateBundleManifest = { type: 'notesprig-private-board-bundle', schemaVersion: 1, private: true, complete: missingHashes.length === 0, boardSha256: await digest(strToU8(rawBoard)), assets: assets.sort((a, b) => a.sha256.localeCompare(b.sha256)), missingHashes };
  const manifestBytes = strToU8(JSON.stringify(manifest)); ensure(manifestBytes.length <= MAX_MANIFEST, 'Recovery manifest too large.'); entries['manifest.json'] = manifestBytes;
  const bytes = zipSync(entries, { level: 6 }); ensure(bytes.length <= MAX_ARCHIVE, 'Recovery archive too large.'); return { bytes, manifest };
}

type ZipEntry = { name: string; compressed: number; original: number; method: number; offset: number };
function zipEntries(bytes: Uint8Array): ZipEntry[] {
  ensure(bytes.length >= 22 && bytes.length <= MAX_ARCHIVE, 'Invalid recovery archive size.'); const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22; while (end >= Math.max(0, bytes.length - 65557) && view.getUint32(end, true) !== 0x06054b50) end--;
  ensure(end >= 0 && view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length, 'Invalid ZIP directory.');
  ensure(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0 && view.getUint16(end + 8, true) === view.getUint16(end + 10, true), 'Multipart ZIP is unsupported.');
  const count = view.getUint16(end + 10, true), size = view.getUint32(end + 12, true), start = view.getUint32(end + 16, true);
  ensure(count >= 2 && count <= BOARD_LIMITS.assets + 2 && start + size === end, 'Invalid recovery ZIP directory.');
  const entries: ZipEntry[] = [], names = new Set<string>(); let cursor = start, expanded = 0, assetBytes = 0, compressedAssets = 0;
  for (let index = 0; index < count; index++) {
    ensure(cursor + 46 <= end && view.getUint32(cursor, true) === 0x02014b50, 'Invalid recovery ZIP entry.');
    const flags = view.getUint16(cursor + 8, true), method = view.getUint16(cursor + 10, true), compressed = view.getUint32(cursor + 20, true), original = view.getUint32(cursor + 24, true), nameSize = view.getUint16(cursor + 28, true), extraSize = view.getUint16(cursor + 30, true), commentSize = view.getUint16(cursor + 32, true), offset = view.getUint32(cursor + 42, true);
    ensure(cursor + 46 + nameSize + extraSize + commentSize <= end, 'Invalid recovery ZIP filename.');
    const name = strFromU8(bytes.subarray(cursor + 46, cursor + 46 + nameSize));
    ensure((name === 'manifest.json' || name === 'board.board' || /^assets\/[a-f\d]{64}$/.test(name)) && !names.has(name), 'Unsafe or duplicate recovery ZIP entry.'); names.add(name);
    ensure(!(flags & 1) && !(flags & 8) && [0, 8].includes(method) && view.getUint16(cursor + 34, true) === 0 && ((view.getUint32(cursor + 38, true) >>> 16) & 0xf000) !== 0xa000, 'Unsupported recovery ZIP entry.');
    const maximum = name === 'manifest.json' ? MAX_MANIFEST : name === 'board.board' ? BOARD_LIMITS.bytes : BOARD_LIMITS.assetBytes;
    expanded += original; if (name.startsWith('assets/')) { assetBytes += original; compressedAssets += compressed; }
    ensure(original > 0 && original <= maximum && expanded <= MAX_ARCHIVE && assetBytes <= BOARD_LIMITS.totalAssetBytes && compressedAssets <= BOARD_LIMITS.totalAssetBytes && offset + 30 <= start && view.getUint32(offset, true) === 0x04034b50, 'Recovery expansion limit exceeded.');
    const localNameSize = view.getUint16(offset + 26, true), localExtraSize = view.getUint16(offset + 28, true), dataStart = offset + 30 + localNameSize + localExtraSize;
    ensure(view.getUint16(offset + 6, true) === flags && view.getUint16(offset + 8, true) === method && view.getUint32(offset + 18, true) === compressed && view.getUint32(offset + 22, true) === original && dataStart + compressed <= start && strFromU8(bytes.subarray(offset + 30, offset + 30 + localNameSize)) === name, 'Inconsistent recovery ZIP header.');
    entries.push({ name, compressed, original, method, offset }); cursor += 46 + nameSize + extraSize + commentSize;
  }
  ensure(cursor === end && names.has('manifest.json') && names.has('board.board'), 'Missing recovery bundle entries.');
  const ordered = entries.slice().sort((a, b) => a.offset - b.offset); let boundary = 0;
  for (const entry of ordered) { ensure(entry.offset === boundary, 'Overlapping or hidden recovery ZIP data.'); boundary = entry.offset + 30 + view.getUint16(entry.offset + 26, true) + view.getUint16(entry.offset + 28, true) + entry.compressed; }
  ensure(boundary === start, 'Hidden recovery ZIP data.'); return entries;
}
function boundedUnzip(bytes: Uint8Array, entries: ZipEntry[]): Record<string, Uint8Array> {
  const expected = new Map(entries.map((entry) => [entry.name, entry])), output: Record<string, Uint8Array> = {}, completed = new Set<string>();
  const unzip = new Unzip((file) => {
    const entry = expected.get(file.name); ensure(entry && !Object.hasOwn(output, file.name) && file.originalSize === entry.original && file.size === entry.compressed && file.compression === entry.method, 'Unexpected recovery ZIP stream.');
    const result = new Uint8Array(entry.original); output[file.name] = result; let offset = 0;
    file.ondata = (error, chunk, final) => { if (error) throw error; ensure(offset + chunk.length <= result.length, 'Recovery decompression limit exceeded.'); result.set(chunk, offset); offset += chunk.length; if (final) { ensure(offset === result.length, 'Truncated recovery ZIP entry.'); completed.add(file.name); } }; file.start();
  }); unzip.register(UnzipInflate);
  // Bounded compressed chunks prevent a forged DEFLATE size from producing an unbounded allocation before the output guard.
  for (let offset = 0; offset < bytes.length; offset += 4096) unzip.push(bytes.subarray(offset, offset + 4096), offset + 4096 >= bytes.length);
  ensure(completed.size === entries.length, 'Incomplete recovery ZIP stream.'); return output;
}

/** Returns exact recovery bytes. Binding review/import is a separate explicit operation. */
export async function readPrivateBoardBundle(bytes: Uint8Array): Promise<{ rawBoard: string; board: BoardDocument; assets: Record<string, Uint8Array>; manifest: PrivateBundleManifest }> {
  const unpacked = boundedUnzip(bytes, zipEntries(bytes)); const rawBoard = strFromU8(unpacked['board.board']); const board = validateBoard(rawBoard);
  const manifest = boundedJSON(strFromU8(unpacked['manifest.json']), MAX_MANIFEST) as PrivateBundleManifest;
  ensure(manifest.type === 'notesprig-private-board-bundle' && manifest.schemaVersion === 1 && manifest.private === true && typeof manifest.complete === 'boolean' && HASH.test(manifest.boardSha256) && Array.isArray(manifest.assets) && Array.isArray(manifest.missingHashes), 'Invalid private recovery manifest.');
  ensure(manifest.boardSha256 === await digest(unpacked['board.board']), 'Recovery board digest mismatch.');
  const assets: Record<string, Uint8Array> = {}, required = new Map<string, number>(); for (const asset of Object.values(board.assets)) required.set(asset.sha256, asset.byteLength);
  for (const asset of manifest.assets) {
    ensure(object(asset) && HASH.test(asset.sha256) && Number.isSafeInteger(asset.byteLength) && asset.byteLength > 0 && asset.byteLength <= BOARD_LIMITS.assetBytes && typeof asset.required === 'boolean' && !Object.hasOwn(assets, asset.sha256), 'Invalid recovery asset manifest.');
    const data = unpacked['assets/' + asset.sha256]; ensure(data && data.length === asset.byteLength && await digest(data) === asset.sha256 && asset.required === required.has(asset.sha256) && (!asset.required || required.get(asset.sha256) === data.length), 'Recovery asset verification failed.'); assets[asset.sha256] = data;
  }
  const missing = [...required.keys()].filter((hash) => !Object.hasOwn(assets, hash)).sort();
  ensure(Object.keys(unpacked).length === Object.keys(assets).length + 2 && manifest.missingHashes.length === missing.length && manifest.missingHashes.every((hash, index) => hash === missing[index]) && manifest.complete === (missing.length === 0), 'Recovery completeness manifest mismatch.');
  return { rawBoard, board, assets, manifest };
}

/** Foreign copies retain visible scene data but require an explicit host binding review. */
export function prepareImportedBoard(board: BoardDocument, context: ReferenceContext): BoardDocument {
  const copy = validateBoard(board); ensure(validContext(context), 'Invalid workspace identity.'); copy.boardId = crypto.randomUUID(); copy.referenceContext = { ...context };
  copy.scene.elements = copy.scene.elements.map((element) => { const metadata = noteMetadata(element); return metadata ? unboundCard(element, metadata.binding?.path, metadata.binding?.fragment) : element; });
  return validateBoard(copy);
}

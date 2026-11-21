import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFileData, BinaryFiles } from '@excalidraw/excalidraw/types';
import { BOARD_LIMITS } from '../../shared/board-schema.mjs';

export type NoteSnapshotStatus = 'ready' | 'missing' | 'unbound' | 'stale' | 'unavailable';
export type NoteCardSnapshot = Readonly<{ title: string; excerpt: string; status: NoteSnapshotStatus; revision?: string }>;
export type ProjectionLabels = Readonly<{ missing: string; unbound: string; stale: string; unavailable: string; untitled: string; unsupported: string }>;
export type ProjectionIssueCode = 'static-note-snapshot' | 'note-placeholder' | 'snapshot-truncated' | 'unsupported-element-placeholder' | 'missing-image-placeholder' | 'private-metadata-stripped' | 'deleted-element-omitted' | 'unused-image-omitted' | 'invalid-binding-removed' | 'frame-clipping-disabled';
export type ProjectionIssue = Readonly<{ code: ProjectionIssueCode; elementId?: string }>;
export type ExportPrivacyContract = Readonly<{ kind: 'share-static' | 'private-native'; containsLiveReferences: boolean; containsReferenceContext: boolean; containsVisibleNoteText: boolean; requiresDisclosure: boolean }>;

/** Private native bundles are recovery/transfer material, not this static projection. */
export const BOARD_EXPORT_PRIVACY: Readonly<Record<'share-static' | 'private-native', ExportPrivacyContract>> = Object.freeze({
  'share-static': Object.freeze({ kind: 'share-static', containsLiveReferences: false, containsReferenceContext: false, containsVisibleNoteText: true, requiresDisclosure: true }),
  'private-native': Object.freeze({ kind: 'private-native', containsLiveReferences: true, containsReferenceContext: true, containsVisibleNoteText: false, requiresDisclosure: true }),
});

export type SharingProjection = {
  elements: ExcalidrawElement[];
  appState: { viewBackgroundColor: string; exportBackground: boolean; exportWithDarkMode: boolean; frameRendering: { enabled: true; name: true; outline: true; clip: false } };
  files: BinaryFiles;
  report: { privacy: ExportPrivacyContract; issues: ProjectionIssue[]; noteCards: number; placeholders: number; truncatedSnapshots: number };
};
export type ProjectionOptions = {
  labels?: Partial<ProjectionLabels>;
  maxElements?: number;
  maxPoints?: number;
  maxTextCharacters?: number;
  maxSnapshotCharacters?: number;
  maxImageBytes?: number;
  maxTotalImageBytes?: number;
  maxCards?: number;
  maxImages?: number;
};
type Data = Record<string, unknown>;
const labels: ProjectionLabels = { missing: 'Missing note', unbound: 'Unbound note', stale: 'Stale reference', unavailable: 'Note preview unavailable', untitled: 'Untitled note', unsupported: 'Unsupported content' };
const nativeTypes = new Set(['rectangle', 'diamond', 'ellipse', 'arrow', 'line', 'text', 'freedraw', 'image', 'frame', 'magicframe']);
const identifier = /^[a-zA-Z\d_-]{1,128}$/;
const arrowheads = new Set(['arrow', 'bar', 'dot', 'circle', 'circle_outline', 'triangle', 'triangle_outline', 'diamond', 'diamond_outline', 'crowfoot_one', 'crowfoot_many', 'crowfoot_one_or_many']);
function record(value: unknown): value is Data { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function limit(value: number | undefined, fallback: number): number { if (value === undefined) return fallback; if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid projection limit.'); return value; }
function cleanText(value: unknown, maximum: number): string { return String(value ?? '').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').slice(0, maximum); }
function safeColor(value: unknown, fallback: string): string { return typeof value === 'string' && /^(?:#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})|transparent)$/i.test(value) ? value : fallback; }
function validId(value: unknown): value is string { return typeof value === 'string' && identifier.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value); }
function internalLink(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  let decoded = value; try { decoded = decodeURIComponent(value); } catch { /* Invalid links are discarded by safePublicLink. */ }
  return /\/_notesprig\/board-card\//i.test(decoded) || /^(?:notesprig:|#ob-note=)/i.test(decoded);
}
function safePublicLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u001f\u007f]/.test(value) || internalLink(value)) return null;
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:'].includes(url.protocol) ? value : null; } catch { return null; }
}
function binding(value: unknown): Data | null {
  if (!record(value) || !validId(value.elementId) || !finite(value.focus) || !finite(value.gap)) return null;
  const result: Data = { elementId: value.elementId, focus: value.focus, gap: value.gap };
  if (Array.isArray(value.fixedPoint) && value.fixedPoint.length === 2 && value.fixedPoint.every(finite)) result.fixedPoint = [...value.fixedPoint];
  return result;
}
function seed(id: string): number { let hash = 2166136261; for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619); return hash >>> 0; }
function base(source: Data): Data {
  const output: Data = { id: source.id, type: source.type, x: source.x, y: source.y, width: source.width, height: source.height };
  Object.assign(output, {
    strokeColor: safeColor(source.strokeColor, '#343a40'), backgroundColor: safeColor(source.backgroundColor, '#ffffff'),
    fillStyle: ['solid', 'hachure', 'cross-hatch', 'zigzag'].includes(String(source.fillStyle)) ? String(source.fillStyle) : 'solid',
    strokeWidth: finite(source.strokeWidth) ? source.strokeWidth : 1, strokeStyle: ['solid', 'dashed', 'dotted'].includes(String(source.strokeStyle)) ? String(source.strokeStyle) : 'solid',
    roughness: finite(source.roughness) ? source.roughness : 0, opacity: finite(source.opacity) ? Math.max(0, Math.min(100, source.opacity)) : 100,
    angle: finite(source.angle) ? source.angle : 0, seed: finite(source.seed) ? source.seed : seed(String(source.id)),
    version: finite(source.version) ? source.version : 1, versionNonce: finite(source.versionNonce) ? source.versionNonce : 0,
    index: typeof source.index === 'string' && /^[a-zA-Z\d]{1,128}$/.test(source.index) ? source.index : null, isDeleted: false, updated: finite(source.updated) ? source.updated : 0,
    locked: source.locked === true, link: safePublicLink(source.link),
    groupIds: Array.isArray(source.groupIds) ? source.groupIds.filter(validId).slice(0, BOARD_LIMITS.elements) : [],
    frameId: validId(source.frameId) ? source.frameId : null,
    boundElements: Array.isArray(source.boundElements) ? source.boundElements.filter(record).filter((entry) => validId(entry.id) && ['arrow', 'text'].includes(String(entry.type))).map((entry) => ({ id: entry.id, type: entry.type })) : null,
    roundness: record(source.roundness) && finite(source.roundness.type) ? { type: source.roundness.type, ...(finite(source.roundness.value) ? { value: source.roundness.value } : {}) } : null,
  });
  return output;
}

function point(value: unknown): number[] | null { return Array.isArray(value) && value.length === 2 && value.every((entry) => finite(entry) && Math.abs(entry) <= 10000000) ? [...value] : null; }
function nativeFields(source: Data): Data {
  const type = source.type, output: Data = {};
  if (['line', 'arrow', 'freedraw'].includes(String(type))) {
    if (!Array.isArray(source.points) || source.points.length > BOARD_LIMITS.pointsPerElement || source.points.some((entry) => !point(entry))) throw new Error('Invalid projection points.');
    output.points = source.points.map((entry) => point(entry)); output.lastCommittedPoint = point(source.lastCommittedPoint);
    if (type === 'freedraw') {
      if (!Array.isArray(source.pressures) || source.pressures.length > source.points.length || !source.pressures.every((entry) => finite(entry) && entry >= 0 && entry <= 1)) throw new Error('Invalid projection pressures.');
      output.pressures = [...source.pressures]; output.simulatePressure = source.simulatePressure === true;
    } else {
      output.startBinding = binding(source.startBinding); output.endBinding = binding(source.endBinding);
      output.startArrowhead = arrowheads.has(String(source.startArrowhead)) ? String(source.startArrowhead) : null;
      output.endArrowhead = arrowheads.has(String(source.endArrowhead)) ? String(source.endArrowhead) : null;
      if (type === 'arrow') {
        output.elbowed = source.elbowed === true;
        if (output.elbowed) {
          output.fixedSegments = Array.isArray(source.fixedSegments) ? source.fixedSegments.filter(record).filter((entry) => Number.isSafeInteger(entry.index) && point(entry.start) && point(entry.end)).map((entry) => ({ index: entry.index, start: point(entry.start), end: point(entry.end) })) : null;
          output.startIsSpecial = typeof source.startIsSpecial === 'boolean' ? source.startIsSpecial : null; output.endIsSpecial = typeof source.endIsSpecial === 'boolean' ? source.endIsSpecial : null;
        }
      }
    }
  } else if (type === 'text') {
    output.text = cleanText(source.text, BOARD_LIMITS.textPerElement); output.originalText = output.text;
    Object.assign(output, { fontSize: finite(source.fontSize) && source.fontSize > 0 && source.fontSize <= 10000 ? source.fontSize : 20, fontFamily: [1, 2, 3, 5, 6, 7, 8, 9, 10].includes(Number(source.fontFamily)) ? Number(source.fontFamily) : 3, textAlign: ['left', 'center', 'right'].includes(String(source.textAlign)) ? String(source.textAlign) : 'left', verticalAlign: ['top', 'middle', 'bottom'].includes(String(source.verticalAlign)) ? String(source.verticalAlign) : 'top', containerId: validId(source.containerId) ? source.containerId : null, autoResize: source.autoResize === true, lineHeight: finite(source.lineHeight) && source.lineHeight > 0 && source.lineHeight <= 10 ? source.lineHeight : 1.25 });
  } else if (type === 'image') {
    output.fileId = source.fileId; output.status = 'saved'; output.scale = Array.isArray(source.scale) && source.scale.length === 2 && source.scale.every((entry) => entry === -1 || entry === 1) ? [...source.scale] : [1, 1];
    output.crop = record(source.crop) && ['x', 'y', 'width', 'height', 'naturalWidth', 'naturalHeight'].every((key) => finite(source.crop && (source.crop as Data)[key])) ? Object.fromEntries(['x', 'y', 'width', 'height', 'naturalWidth', 'naturalHeight'].map((key) => [key, (source.crop as Data)[key]])) : null;
  } else if (type === 'frame' || type === 'magicframe') output.name = typeof source.name === 'string' ? cleanText(source.name, BOARD_LIMITS.textPerElement) : null;
  return output;
}

function fitText(text: string, width: number, maxLines: number, fontSize: number): { text: string; truncated: boolean } {
  const cells = Math.max(1, Math.floor(width / (fontSize * 0.7)));
  const lines: string[] = []; let current = '', occupied = 0;
  for (const char of text) {
    if (char === '\n') { lines.push(current); current = ''; occupied = 0; }
    else {
      const units = /[\u0300-\u036f\ufe00-\ufe0f]/u.test(char) ? 0 : char.codePointAt(0)! > 0x2e80 ? 2 : 1;
      if (occupied + units > cells && current) { lines.push(current); current = ''; occupied = 0; }
      current += char === '\t' ? ' ' : char; occupied += units;
    }
  }
  lines.push(current);
  const truncated = lines.length > maxLines;
  const visible = lines.slice(0, maxLines);
  if (truncated) visible[visible.length - 1] = Array.from(visible.at(-1) || '').slice(0, Math.max(0, cells - 1)).join('') + '…';
  return { text: visible.join('\n'), truncated };
}

/** Synchronous, side-effect-free export of one already-captured scene and snapshot set. */
export function createSharingProjection(
  scene: Readonly<{ elements: readonly ExcalidrawElement[]; appState?: object; files?: BinaryFiles }>,
  snapshots: Readonly<Record<string, NoteCardSnapshot>> = {},
  options: ProjectionOptions = {},
): SharingProjection {
  const maxElements = limit(options.maxElements, BOARD_LIMITS.elements), maxPoints = limit(options.maxPoints, BOARD_LIMITS.points), maxText = limit(options.maxTextCharacters, BOARD_LIMITS.totalText), maxSnapshot = limit(options.maxSnapshotCharacters, 2000);
  const maxImage = limit(options.maxImageBytes, BOARD_LIMITS.assetBytes), maxImages = limit(options.maxTotalImageBytes, BOARD_LIMITS.totalAssetBytes);
  const maxCards = limit(options.maxCards, BOARD_LIMITS.cards), maxImageCount = limit(options.maxImages, BOARD_LIMITS.assets);
  if (!Array.isArray(scene.elements) || scene.elements.length > maxElements) throw new Error('Projection element limit exceeded.');
  const messages = { ...labels, ...options.labels }, issues: ProjectionIssue[] = [], elements: Data[] = [];
  const ids = new Set<string>(); let pointCount = 0, textCount = 0, noteCards = 0, placeholders = 0, truncatedSnapshots = 0;
  for (const item of scene.elements) {
    if (!validId(item.id) || ids.has(item.id)) throw new Error('Duplicate or invalid projection element ID.');
    ids.add(item.id);
    if (![item.x, item.y, item.width, item.height].every((value) => finite(value) && Math.abs(value) <= 10000000) || item.width < 0 || item.height < 0) throw new Error('Invalid projection geometry.');
    const raw = item as unknown as Data;
    if (Array.isArray(raw.points)) { pointCount += raw.points.length; if (pointCount > maxPoints) throw new Error('Projection point limit exceeded.'); }
    if (typeof raw.text === 'string') { textCount += raw.text.length; if (raw.text.length > BOARD_LIMITS.textPerElement || textCount > maxText) throw new Error('Projection text limit exceeded.'); }
  }
  const sourceFiles = scene.files || {}, files: BinaryFiles = {}; let imageBytes = 0;
  function textId(id: string): string { let next = `${id}__static_text`, suffix = 1; while (ids.has(next)) next = `${id}__static_text_${suffix++}`; ids.add(next); return next; }
  function card(source: Data, text: string, code: ProjectionIssueCode) {
    const rectangle: Data = { ...base(source), type: 'rectangle', backgroundColor: '#f8f9fa', fillStyle: 'solid', link: null };
    if (Number(rectangle.width) < 16 || Number(rectangle.height) < 16) throw new Error('Card is too small for a readable sharing projection.');
    const padding = Math.min(12, Number(rectangle.width) / 8, Number(rectangle.height) / 8);
    const width = Number(rectangle.width) - padding * 2, availableHeight = Number(rectangle.height) - padding * 2;
    const fontSize = Math.min(16, availableHeight / 1.25), lineHeight = 1.25;
    const fitted = fitText(cleanText(text, maxSnapshot), width, Math.max(1, Math.floor(availableHeight / (fontSize * lineHeight))), fontSize);
    textCount += fitted.text.length; if (textCount > maxText) throw new Error('Projection text limit exceeded.');
    if (fitted.truncated || text.length > maxSnapshot) { truncatedSnapshots++; issues.push({ code: 'snapshot-truncated', elementId: String(source.id) }); }
    const height = Math.max(1, fitted.text.split('\n').length) * fontSize * lineHeight;
    const dx = padding + width / 2 - Number(rectangle.width) / 2, dy = padding + height / 2 - Number(rectangle.height) / 2, angle = Number(rectangle.angle);
    const cx = Number(rectangle.x) + Number(rectangle.width) / 2 + dx * Math.cos(angle) - dy * Math.sin(angle);
    const cy = Number(rectangle.y) + Number(rectangle.height) / 2 + dx * Math.sin(angle) + dy * Math.cos(angle);
    const child = { ...base(source), id: textId(String(source.id)), index: null, type: 'text', x: cx - width / 2, y: cy - height / 2, width, height, strokeColor: '#212529', backgroundColor: 'transparent', fillStyle: 'solid', roughness: 0, strokeWidth: 1, text: fitted.text, originalText: fitted.text, fontSize, fontFamily: 3, textAlign: 'left', verticalAlign: 'top', containerId: String(source.id), autoResize: false, lineHeight, boundElements: null, link: null };
    rectangle.boundElements = [...(Array.isArray(rectangle.boundElements) ? rectangle.boundElements.filter((entry: { type: string }) => entry.type === 'arrow') : []), { id: child.id, type: 'text' }];
    elements.push(rectangle, child); issues.push({ code, elementId: String(source.id) });
  }
  for (const item of scene.elements) {
    const source = item as unknown as Data;
    if (item.isDeleted) { issues.push({ code: 'deleted-element-omitted', elementId: item.id }); continue; }
    if (source.customData !== undefined || internalLink(source.link)) issues.push({ code: 'private-metadata-stripped', elementId: item.id });
    const metadata = record(source.customData) && record(source.customData.notesprig) ? source.customData.notesprig : null;
    if (metadata?.kind === 'note-card') {
      noteCards++; if (noteCards > maxCards) throw new Error('Projection note card limit exceeded.');
      const state = metadata.version === 1 && record(metadata.binding) ? metadata.binding.state : 'unbound';
      const snapshot = snapshots[item.id];
      const status: NoteSnapshotStatus = state === 'missing' ? 'missing' : state !== 'bound' ? 'unbound' : snapshot && ['ready', 'missing', 'unbound', 'stale', 'unavailable'].includes(snapshot.status) ? snapshot.status : 'unavailable';
      if (status === 'ready') card(source, `${cleanText(snapshot.title, maxSnapshot).trim() || messages.untitled}\n\n${cleanText(snapshot.excerpt, maxSnapshot)}`, 'static-note-snapshot');
      else { placeholders++; card(source, messages[status], 'note-placeholder'); }
      continue;
    }
    if (!nativeTypes.has(item.type)) { placeholders++; card(source, messages.unsupported, 'unsupported-element-placeholder'); continue; }
    if (item.type === 'image') {
      const id = typeof source.fileId === 'string' ? source.fileId : '', file = sourceFiles[id];
      if (file && typeof file.dataURL === 'string' && file.dataURL.length > Math.ceil(maxImage / 3) * 4 + 64) throw new Error('Projection image limit exceeded.');
      const match = file && typeof file.dataURL === 'string' && /^data:(image\/(?:png|jpeg|webp));base64,([a-z\d+/]+={0,2})$/i.exec(file.dataURL);
      if (!validId(id) || !file || !match || match[2].length % 4 !== 0 || match[1].toLowerCase() !== file.mimeType?.toLowerCase()) { placeholders++; card(source, messages.unsupported, 'missing-image-placeholder'); continue; }
      const bytes = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
      if (bytes > maxImage) throw new Error('Projection image limit exceeded.');
      if (!Object.hasOwn(files, id)) { imageBytes += bytes; if (imageBytes > maxImages || Object.keys(files).length >= maxImageCount) throw new Error('Projection total image limit exceeded.'); files[id] = { id, mimeType: match[1].toLowerCase(), dataURL: file.dataURL, created: finite(file.created) ? file.created : 0, ...(finite(file.version) ? { version: file.version } : {}) } as BinaryFileData; }
    }
    const output = { ...base(source), ...nativeFields(source) };
    elements.push(output);
  }
  const outputIds = new Set(elements.map((element) => String(element.id))), frames = new Set(elements.filter((element) => element.type === 'frame' || element.type === 'magicframe').map((element) => String(element.id)));
  if (frames.size) issues.push({ code: 'frame-clipping-disabled' });
  for (const element of elements) {
    if (element.frameId && !frames.has(String(element.frameId))) element.frameId = null;
    if (element.containerId && !outputIds.has(String(element.containerId))) element.containerId = null;
    if (Array.isArray(element.boundElements)) element.boundElements = element.boundElements.filter((entry: { id: string }) => outputIds.has(entry.id));
    for (const key of ['startBinding', 'endBinding']) if (record(element[key]) && !outputIds.has(String(element[key].elementId))) { element[key] = null; issues.push({ code: 'invalid-binding-removed', elementId: String(element.id) }); }
  }
  for (const id of Object.keys(sourceFiles)) if (!Object.hasOwn(files, id)) issues.push({ code: 'unused-image-omitted' });
  const appearance = record(scene.appState) ? scene.appState : {};
  if (elements.length > maxElements + maxCards) throw new Error('Projection output element limit exceeded.');
  return {
    elements: elements as unknown as ExcalidrawElement[],
    appState: { viewBackgroundColor: safeColor(appearance.viewBackgroundColor, '#ffffff'), exportBackground: appearance.exportBackground !== false, exportWithDarkMode: appearance.exportWithDarkMode === true, frameRendering: { enabled: true, name: true, outline: true, clip: false } },
    files,
    report: { privacy: BOARD_EXPORT_PRIVACY['share-static'], issues, noteCards, placeholders, truncatedSnapshots },
  };
}

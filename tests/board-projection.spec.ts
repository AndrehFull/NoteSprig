import { test, expect } from '@playwright/test';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { BinaryFiles } from '@excalidraw/excalidraw/types';
import { createSharingProjection, BOARD_EXPORT_PRIVACY } from '../src/boards/projection';

const marker = '/_notesprig/board-card/3de33c65-7f91-48f8-a20a-821f7eeddb50';
const privatePath = 'Private/Secret-project.md';
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
function element(id: string, type = 'rectangle', extra: Record<string, unknown> = {}): ExcalidrawElement {
  return { id, type, x: 20, y: 40, width: 320, height: 180, angle: 0, strokeColor: '#343a40', backgroundColor: '#ffffff', fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roundness: null, roughness: 0, opacity: 100, seed: 1, version: 1, versionNonce: 1, index: null, isDeleted: false, groupIds: [], frameId: null, boundElements: null, updated: 0, locked: false, link: null, ...extra } as ExcalidrawElement;
}
function card(id = 'card', extra: Record<string, unknown> = {}): ExcalidrawElement {
  return element(id, 'embeddable', { link: marker, customData: { notesprig: { version: 1, kind: 'note-card', binding: { state: 'bound', path: privatePath } }, privateEpoch: 'secret-epoch' }, ...extra });
}
function image(id: string, fileId: string): ExcalidrawElement { return element(id, 'image', { fileId, status: 'saved', scale: [1, 1], crop: null }); }
function files(extra: Record<string, unknown> = {}): BinaryFiles { return { raster: { id: 'raster', mimeType: 'image/png', dataURL: png, created: 10, ...extra } } as unknown as BinaryFiles; }

test('share projection captures static visible text and strips every live reference without reading notes', () => {
  const input = { elements: [card()], appState: { viewBackgroundColor: '#aabbcc', exportBackground: false, collaborators: { secret: privatePath }, referenceContext: { epoch: 'secret-epoch' } }, files: {} };
  const before = structuredClone(input); const snapshots = Object.freeze({ card: Object.freeze({ title: 'Project plan', excerpt: 'A visible excerpt.', status: 'ready' as const, revision: 'private-revision' }) });
  const originalFetch = globalThis.fetch; globalThis.fetch = (() => { throw new Error('Projection must never fetch.'); }) as typeof fetch;
  let output;
  try { output = createSharingProjection(input, snapshots); } finally { globalThis.fetch = originalFetch; }
  expect(input).toEqual(before);
  expect(output.elements).toHaveLength(2);
  expect(output.elements[0]).toMatchObject({ id: 'card', type: 'rectangle', x: 20, y: 40, width: 320, height: 180, link: null, boundElements: [{ id: 'card__static_text', type: 'text' }] });
  expect(output.elements[1]).toMatchObject({ type: 'text', containerId: 'card', text: 'Project plan\n\nA visible excerpt.', originalText: 'Project plan\n\nA visible excerpt.' });
  expect(output.appState).toEqual({ viewBackgroundColor: '#aabbcc', exportBackground: false, exportWithDarkMode: false, frameRendering: { enabled: true, name: true, outline: true, clip: false } });
  const serialized = JSON.stringify(output);
  for (const value of [privatePath, 'secret-epoch', 'private-revision', marker, 'customData', 'referenceContext', 'collaborators']) expect(serialized).not.toContain(value);
  expect(output.report).toMatchObject({ noteCards: 1, placeholders: 0, privacy: { kind: 'share-static', containsVisibleNoteText: true, containsLiveReferences: false, requiresDisclosure: true } });
  expect(BOARD_EXPORT_PRIVACY['private-native']).toMatchObject({ containsLiveReferences: true, containsReferenceContext: true, requiresDisclosure: true });
});

test('native bindings, rotation, opacity, frame membership and groups survive without changing the source', () => {
  const angle = Math.PI / 3;
  const elements = [element('frame', 'frame', { name: 'Planning', width: 800, height: 600 }), card('card', { angle, opacity: 42, frameId: 'frame', groupIds: ['group'], boundElements: [{ id: 'arrow', type: 'arrow' }] }), element('arrow', 'arrow', { points: [[0, 0], [200, 0]], startBinding: { elementId: 'card', focus: 0.2, gap: 8, privatePath }, endBinding: null, startArrowhead: null, endArrowhead: 'arrow', elbowed: false })];
  const result = createSharingProjection({ elements }, { card: { title: 'Title', excerpt: 'Excerpt', status: 'ready' } });
  const shape = result.elements.find((item) => item.id === 'card')!;
  const text = result.elements.find((item) => item.type === 'text')!;
  expect(shape).toMatchObject({ angle, opacity: 42, frameId: 'frame', groupIds: ['group'], boundElements: [{ id: 'arrow', type: 'arrow' }, { id: text.id, type: 'text' }] });
  expect(text).toMatchObject({ angle, opacity: 42, frameId: 'frame', groupIds: ['group'], containerId: 'card' });
  const textCenter = { x: text.x + text.width / 2, y: text.y + text.height / 2 };
  const center = { x: shape.x + shape.width / 2, y: shape.y + shape.height / 2 };
  const dx = textCenter.x - center.x, dy = textCenter.y - center.y;
  expect(dx * Math.sin(angle) + dy * Math.cos(angle)).not.toBeNaN();
  // Inverse rotation places the text at exactly the original card's inner top edge.
  expect(-dx * Math.sin(angle) + dy * Math.cos(angle)).toBeCloseTo(12 + text.height / 2 - shape.height / 2);
  expect(result.elements.find((item) => item.id === 'arrow')).toMatchObject({ startBinding: { elementId: 'card', focus: 0.2, gap: 8 } });
  expect(JSON.stringify(result)).not.toContain(privatePath);
  expect(result.appState.frameRendering).toEqual({ enabled: true, name: true, outline: true, clip: false });
  expect(result.report.issues).toContainEqual({ code: 'frame-clipping-disabled' });
});

test('missing, unbound, stale, unavailable and unknown cards use localized visible placeholders', () => {
  const source = [card('missing', { customData: { notesprig: { version: 1, kind: 'note-card', binding: { state: 'missing', path: privatePath } } } }), card('unbound', { customData: { notesprig: { version: 1, kind: 'note-card', binding: { state: 'unbound', path: privatePath } } } }), card('stale'), card('unavailable'), element('foreign', 'embeddable', { link: 'https://example.com/embed' })];
  const result = createSharingProjection({ elements: source }, { stale: { title: 'Must not leak stale text', excerpt: privatePath, status: 'stale' }, missing: { title: 'Must not use missing snapshot', excerpt: privatePath, status: 'ready' } }, { labels: { missing: 'Nota ausente', unbound: 'Nota sem vínculo', stale: 'Revisão necessária', unavailable: 'Prévia indisponível', unsupported: 'Conteúdo incompatível' } });
  expect(result.elements.filter((item) => item.type === 'text').map((item) => item.type === 'text' && item.text)).toEqual(['Nota ausente', 'Nota sem vínculo', 'Revisão necessária', 'Prévia indisponível', 'Conteúdo incompatível']);
  expect(result.report).toMatchObject({ noteCards: 4, placeholders: 5 });
  expect(JSON.stringify(result)).not.toContain(privatePath);
  expect(JSON.stringify(result)).not.toContain('Must not');
});

test('generated IDs are deterministic and collision-safe and references to omitted elements are removed', () => {
  const elements = [card(), element('card__static_text'), element('card__static_text_1'), element('deleted', 'rectangle', { isDeleted: true }), element('arrow', 'arrow', { points: [[0, 0], [10, 10]], startBinding: { elementId: 'deleted', focus: 0, gap: 0 }, endBinding: null, frameId: 'missingframe', boundElements: [{ id: 'deleted', type: 'text' }], elbowed: false })];
  const first = createSharingProjection({ elements }); const second = createSharingProjection({ elements });
  expect(first).toEqual(second);
  expect(first.elements.find((item) => item.type === 'text')?.id).toBe('card__static_text_2');
  expect(new Set(first.elements.map((item) => item.id)).size).toBe(first.elements.length);
  expect(first.elements.find((item) => item.id === 'arrow')).toMatchObject({ startBinding: null, frameId: null, boundElements: [] });
  expect(first.elements.some((item) => item.id === 'deleted')).toBe(false);
  expect(first.report.issues).toContainEqual({ code: 'invalid-binding-removed', elementId: 'arrow' });
});

test('ordinary elements cannot smuggle private fields through nested drawing fields', () => {
  const result = createSharingProjection({ elements: [element('shape', 'rectangle', { customData: { privatePath }, arbitrary: privatePath, link: 'https://example.com/%5Fnotesprig/board-card/private', groupIds: ['group', privatePath], roundness: { type: 3, privatePath }, boundElements: [{ id: 'arrow', type: 'arrow', privatePath }] }), element('arrow', 'arrow', { points: [[0, 0], [20, 30]], startBinding: { elementId: 'shape', focus: 0, gap: 8, privatePath }, endBinding: null, elbowed: true, fixedSegments: [{ index: 1, start: [0, 0], end: [20, 30], privatePath }], endArrowhead: 'arrow' }), element('label', 'text', { text: 'Visible', originalText: privatePath, fontSize: 20, fontFamily: { privatePath }, containerId: null }), image('image', 'raster')] }, undefined, {});
  expect(result.report.placeholders).toBe(1); // No supplied image bytes: explicit shape and label.
  expect(JSON.stringify(result)).not.toContain(privatePath);
  expect(JSON.stringify(result)).not.toContain('board-card');
  expect(result.elements.find((item) => item.id === 'shape')?.link).toBeNull();
  expect(result.elements.find((item) => item.id === 'label')).toMatchObject({ text: 'Visible', originalText: 'Visible', fontFamily: 3 });
  expect(() => createSharingProjection({ elements: [element('line', 'line', { points: [[0, { privatePath }]] })] })).toThrow('Invalid projection points');
});

test('portable files contain only referenced, bounded raster bytes and public primitive fields', () => {
  const sourceFiles = { ...files({ privatePath, created: { privatePath } }), unused: { id: 'unused', mimeType: 'image/png', dataURL: png, created: 0 } } as unknown as BinaryFiles;
  const result = createSharingProjection({ elements: [image('first', 'raster'), image('second', 'raster')], files: sourceFiles });
  expect(Object.keys(result.files)).toEqual(['raster']);
  expect(result.files.raster).toEqual({ id: 'raster', mimeType: 'image/png', dataURL: png, created: 0 });
  expect(result.report.issues).toContainEqual({ code: 'unused-image-omitted' });
  expect(JSON.stringify(result)).not.toContain(privatePath);
  expect(sourceFiles.raster.created).toEqual({ privatePath });
  expect(() => createSharingProjection({ elements: [image('image', 'raster')], files: files() }, undefined, { maxImageBytes: 1 })).toThrow('image limit');
  expect(() => createSharingProjection({ elements: [image('image', 'raster')], files: files() }, undefined, { maxTotalImageBytes: 1 })).toThrow('total image limit');
  for (const malformed of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,YQ=', 'https://example.com/private.png']) {
    const invalid = { raster: { id: 'raster', mimeType: 'image/png', dataURL: malformed, created: 0 } } as unknown as BinaryFiles;
    const placeholder = createSharingProjection({ elements: [image('image', 'raster')], files: invalid });
    expect(placeholder.files).toEqual({}); expect(placeholder.report.placeholders).toBe(1);
  }
});

test('bounded projections reject complexity overflow and report snapshot truncation', () => {
  expect(() => createSharingProjection({ elements: [element('same'), element('same')] })).toThrow('element ID');
  expect(() => createSharingProjection({ elements: [element('invalid', 'rectangle', { x: Infinity })] })).toThrow('geometry');
  expect(() => createSharingProjection({ elements: [element('a'), element('b')] }, undefined, { maxElements: 1 })).toThrow('element limit');
  expect(() => createSharingProjection({ elements: [card('a'), card('b')] }, undefined, { maxCards: 1 })).toThrow('card limit');
  expect(() => createSharingProjection({ elements: [element('line', 'line', { points: [[0, 0], [1, 1]] })] }, undefined, { maxPoints: 1 })).toThrow('point limit');
  expect(() => createSharingProjection({ elements: [element('label', 'text', { text: 'overflow' })] }, undefined, { maxTextCharacters: 2 })).toThrow('text limit');
  expect(() => createSharingProjection({ elements: [card()] }, { card: { title: 'Title', excerpt: 'overflow', status: 'ready' } }, { maxTextCharacters: 2 })).toThrow('text limit');
  const result = createSharingProjection({ elements: [card('card', { width: 80, height: 40 })] }, { card: { title: 'Long title', excerpt: 'Long excerpt '.repeat(1000), status: 'ready' } }, { maxSnapshotCharacters: 30 });
  expect(result.report.truncatedSnapshots).toBe(1);
  expect(result.report.issues).toContainEqual({ code: 'snapshot-truncated', elementId: 'card' });
  expect(result.elements.find((item) => item.type === 'text')?.type).toBe('text');
});

import { test, expect, type Page, type APIRequestContext, type Download } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createBoard, CARD_PREFIX } from '../shared/board-schema.mjs';
import type { ReferenceContext } from '../shared/board-schema.mjs';
import { readPrivateBoardBundle } from '../src/boards/portability';
import { buildKnowledgeGraph } from '../src/knowledge';

const unique = () => 'Integration-' + randomUUID().slice(0, 8);
async function login(page: Page) {
  const response = await page.request.post('/api/login', { data: { password: 'test-session-only' } }); expect(response.ok()).toBe(true);
  await page.addInitScript(() => { localStorage.setItem('notesprig.language', 'en'); });
}
async function context(api: APIRequestContext): Promise<ReferenceContext> { const response = await api.get('/api/boards/context'); expect(response.ok()).toBe(true); return response.json(); }
async function createEmpty(api: APIRequestContext, path: string) { const expected = await context(api); const response = await api.post('/api/boards', { data: { path, board: createBoard(expected), context: expected } }); expect(response.ok()).toBe(true); }
async function openBoard(page: Page, path: string) { await page.goto('/'); await page.locator(`button.tree-file[title="${path}"]`).click(); await expect(page.getByRole('region', { name: 'Canvas', exact: true })).toBeVisible(); }
async function content(api: APIRequestContext, path: string) { const response = await api.get('/api/note?path=' + encodeURIComponent(path)); expect(response.ok()).toBe(true); return response.json(); }
async function bytes(download: Download) { const file = await download.path(); expect(file).toBeTruthy(); return readFile(file!); }
async function cleanup(api: APIRequestContext, paths: string[]) { for (const path of paths) await api.delete('/api/note?path=' + encodeURIComponent(path), { headers: { 'Content-Type': 'application/json' } }); }

test('a guarded side editor refreshes its live card and cannot overwrite an identical-byte replacement after path reuse', async ({ page, request }) => {
  test.setTimeout(90000); await login(page);
  // A separate API context performs external structural changes without touching the browser's captured identity.
  await request.post('/api/login', { data: { password: 'test-session-only' } });
  const name = unique(), notePath = name + '.md', movedPath = name + '-moved.md', boardPath = name + '.board';
  await request.post('/api/note', { data: { path: notePath, content: '# Initial ' + name } }); await createEmpty(request, boardPath);
  try {
    await openBoard(page, boardPath);
    await page.getByRole('combobox', { name: 'Choose a note', exact: true }).selectOption(notePath);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('[data-board-card]')).toContainText('Initial ' + name);
    await expect.poll(async () => JSON.parse((await content(request, boardPath)).content).scene.elements.filter((item: any) => !item.isDeleted && item.customData?.notesprig).length).toBe(1);
    await page.locator('.board-note-list summary').click(); await page.locator('.board-note-list').getByRole('button', { name: 'Open note', exact: true }).click();
    const editor = page.locator('.secondary-pane .cm-content'); await expect(editor).toContainText('Initial ' + name);
    const live = 'Live card revision ' + name; await editor.fill('# Initial ' + name + '\n\n' + live);
    await expect.poll(async () => (await content(request, notePath)).content).toContain(live);
    // The card is a bounded snapshot. The side editor remains the authority
    // for content; opening the card always verifies and loads that live note.
    await expect(page.locator('[data-board-card]')).toContainText('Initial ' + name);
    const original = await content(request, notePath);
    expect((await request.post('/api/note/rename', { data: { oldPath: notePath, newPath: movedPath } })).ok()).toBe(true);
    expect((await request.post('/api/note', { data: { path: notePath, content: original.content } })).ok()).toBe(true);
    expect((await content(request, notePath)).hash).toBe(original.hash); // Only the reference epoch can distinguish this new logical note.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByText('Reference review required', { exact: false }).first()).toBeVisible();
    const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/note' && response.request().method() === 'PUT');
    await editor.fill(original.content + '\n\nPreserve this local draft');
    expect((await rejected).status()).toBe(409);
    expect((await content(request, notePath)).content).toBe(original.content);
    await expect(editor).toContainText('Preserve this local draft');
  } finally { await page.close(); await cleanup(request, [boardPath, notePath, movedPath]); }
});

test('Canvas imports remain unbound until explicit review and private versus public exports honor different contracts', async ({ page, request }) => {
  test.setTimeout(90000); await login(page); await request.post('/api/login', { data: { password: 'test-session-only' } });
  const name = unique(), hostPath = name + '-host.board', copyPath = name + '-copy.board'; await createEmpty(request, hostPath);
  const source = JSON.stringify({ nodes: [{ id: 'note', type: 'file', x: 30, y: 30, width: 320, height: 220, file: 'Index.md' }], edges: [], futureExtension: { preserved: true } });
  try {
    await openBoard(page, hostPath);
    await page.locator('input[accept=".canvas,.excalidraw,.board,.zip"]').setInputFiles({ name: 'Original.canvas', mimeType: 'application/json', buffer: Buffer.from(source) });
    await expect(page.getByRole('heading', { name: 'Review imported copy', exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Imported Canvas name', exact: true }).fill(name + '-copy');
    const originalDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Create imported copy', exact: true }).click();
    expect((await bytes(await originalDownload)).toString()).toBe(source);
    const imported = JSON.parse((await content(request, copyPath)).content); expect(imported.scene.elements[0].customData.notesprig.binding.state).toBe('unbound'); expect(imported.extensions.canvasSource).toBe(source);
    await page.locator(`button.tree-file[title="${copyPath}"]`).click();
    await expect(page.getByText('Reference review required', { exact: false }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Review references', exact: true }).click();
    await page.locator('.board-review select').selectOption('Index.md'); await page.getByRole('button', { name: 'Confirm reference review', exact: true }).click();
    await expect(page.locator('[data-board-card]')).toContainText('Início');
    const privateDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'Private recovery', exact: true }).click();
    const recovered = await readPrivateBoardBundle(new Uint8Array(await bytes(await privateDownload)));
    expect(recovered.manifest.complete).toBe(true); expect(recovered.board.scene.elements[0].customData?.notesprig?.binding).toMatchObject({ state: 'bound', path: 'Index.md' });
    expect(recovered.board.extensions.canvasSource).toBe(source); expect(recovered.board.referenceContext).toEqual(await context(request));
    await page.locator('.board-toolbar summary').filter({ hasText: 'Share' }).click();
    const publicDownload = page.waitForEvent('download'); await page.getByRole('button', { name: 'EXCALIDRAW', exact: true }).click();
    const drawing = JSON.parse((await bytes(await publicDownload)).toString()); expect(drawing.type).toBe('excalidraw'); expect(drawing.elements.some((item: any) => item.type === 'text' && item.text.includes('Início'))).toBe(true);
    const serialized = JSON.stringify(drawing); for (const key of ['referenceContext', 'customData', CARD_PREFIX]) expect(serialized).not.toContain(key);
    expect(drawing.elements.some((item: any) => item.type === 'embeddable')).toBe(false);
  } finally { await page.close(); await cleanup(request, [hostPath, copyPath]); }
});

test('the actual file index derives one contains edge for duplicate cards and removes stale reference edges', async ({ page, request }) => {
  await login(page); await request.post('/api/login', { data: { password: 'test-session-only' } });
  const name = unique(), boardPath = name + '.board', notePath = name + '.md';
  await request.post('/api/note', { data: { path: notePath, content: '# Graph target' } });
  const expected = await context(request), board = createBoard(expected);
  board.scene.elements = [0, 1].map((index) => ({ id: 'card_' + index, type: 'embeddable', x: index * 340, y: 0, width: 300, height: 220, angle: 0, link: CARD_PREFIX + randomUUID(), customData: { notesprig: { version: 1, kind: 'note-card', binding: { state: 'bound', path: notePath } } } }));
  expect((await request.post('/api/boards', { data: { path: boardPath, board, context: expected } })).ok()).toBe(true);
  try {
    await page.goto('/'); await page.getByRole('button', { name: 'Graph settings', exact: true }).click(); await page.getByRole('checkbox', { name: 'Attachments and Canvas', exact: true }).check();
    const files = await (await request.get('/api/files')).json(), notes = await (await request.get('/api/notes')).json();
    const indexed = files.find((file: any) => file.path === boardPath); expect(indexed.links).toEqual([{ target: notePath, embed: true, kind: 'wiki' }]);
    const graph = buildKnowledgeGraph(notes, { files, query: '', showTags: false, showUnresolved: true, showOrphans: true, showAttachments: true, depth: 1 });
    expect(graph.edges.filter((edge) => edge.source === boardPath && edge.target === notePath)).toEqual([{ source: boardPath, target: notePath, kind: 'contains' }]);
    // The shared fixture vault can contain unrelated files. Refresh the actual
    // index before asserting that the card edge is represented in the UI.
    await page.getByRole('button', { name: 'Refresh files', exact: true }).click();
    const region = page.getByRole('region', { name: 'Global graph', exact: true }).first();
    await expect.poll(async()=>Number(await region.getAttribute('data-edge-count'))).toBeGreaterThan(0);
    expect((await request.delete('/api/note?path=' + encodeURIComponent(notePath), { headers: { 'Content-Type': 'application/json' } })).ok()).toBe(true);
    const after = await (await request.get('/api/files')).json(); expect(after.find((file: any) => file.path === boardPath).links).toEqual([]);
    await page.getByRole('button', { name: 'Refresh files', exact: true }).click();
  } finally { await page.close(); await cleanup(request, [boardPath, notePath]); }
});

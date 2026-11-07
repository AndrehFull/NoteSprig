import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

test.setTimeout(60000);
const folder = () => `Verificacao-${randomUUID().slice(0, 8)}`;
async function auth(request: APIRequestContext) { expect((await request.post('/api/login', { data: { password: 'test-session-only' } })).ok()).toBe(true); }
async function create(request: APIRequestContext, path: string, content: string) { const response = await request.post('/api/note', { data: { path, content } }); expect(response.ok(), await response.text()).toBe(true); return response.json(); }
async function note(request: APIRequestContext, path: string) { const response = await request.get('/api/note?path=' + encodeURIComponent(path)); expect(response.ok(), await response.text()).toBe(true); return response.json(); }
async function remove(request: APIRequestContext, path: string) { await request.delete('/api/note?path=' + encodeURIComponent(path), { headers: { 'Content-Type': 'application/json' } }); }
async function open(page: Page, path: string) { await page.locator(`button.tree-file[title="${path}"]`).click(); }
async function command(page: Page, query: string) { await page.keyboard.press('Control+p'); await page.getByPlaceholder('Buscar comando…').fill(query); await page.keyboard.press('Enter'); }

test('Canvas preserves unknown JSON and supports editing, dragging, connections, and undo', async ({ page }) => {
  const dir = folder(), path = `${dir}/Mapa.canvas`; await auth(page.request);
  const initial = { custom: { preserve: true }, nodes: [{ id: 'one', type: 'text', text: 'Primeira ideia', x: 0, y: 0, width: 250, height: 160, extraField: 42 }, { id: 'two', type: 'text', text: 'Segunda ideia', x: 440, y: 0, width: 250, height: 160 }], edges: [{ id: 'original', fromNode: 'one', toNode: 'two', label: 'conecta', customEdge: 'preservar' }] };
  try {
    await create(page.request, path, JSON.stringify(initial)); await page.goto('/'); await open(page, path);
    const canvas = page.getByRole('region', { name: 'Canvas', exact: true }); await expect(canvas).toHaveAttribute('data-node-count', '2');
    await page.getByRole('button', { name: 'Adicionar cartão de texto', exact: true }).click(); await page.getByRole('textbox', { name: 'Texto do cartão' }).fill('Nova ideia **Markdown**'); await page.getByRole('textbox', { name: 'Texto do cartão' }).press('Escape');
    await expect(canvas).toHaveAttribute('data-node-count', '3');
    const first = page.locator('[data-canvas-node="one"]'); const box = (await first.boundingBox())!;
    await page.mouse.move(box.x + 35, box.y + 30); await page.mouse.down(); await page.mouse.move(box.x + 95, box.y + 80, { steps: 8 }); await page.mouse.up();
    const resize = first.getByRole('button', { name: 'Redimensionar sudeste', exact: true }); const corner = (await resize.boundingBox())!;
    await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2); await page.mouse.down(); await page.mouse.move(corner.x + 60, corner.y + 45, { steps: 5 }); await page.mouse.up();
    const from = (await first.getByRole('button', { name: 'Conectar cartão direito', exact: true }).boundingBox())!;
    const target = (await page.locator('[data-canvas-node="two"]').boundingBox())!;
    await page.mouse.move(from.x + 6, from.y + 6); await page.mouse.down(); await page.mouse.move(target.x + target.width - 20, target.y + target.height / 2, { steps: 10 }); await page.mouse.up();
    await expect(canvas).toHaveAttribute('data-edge-count', '2');
    await page.getByRole('button', { name: 'Desfazer no Canvas', exact: true }).click(); await expect(canvas).toHaveAttribute('data-edge-count', '1');
    await page.getByRole('button', { name: 'Refazer no Canvas', exact: true }).click(); await expect(canvas).toHaveAttribute('data-edge-count', '2');
    await expect.poll(async () => JSON.parse((await note(page.request, path)).content).nodes.length).toBe(3);
    const saved = JSON.parse((await note(page.request, path)).content); expect(saved.custom).toEqual({ preserve: true }); expect(saved.nodes.find((node: { id: string }) => node.id === 'one').extraField).toBe(42); expect(saved.edges[0].customEdge).toBe('preservar'); expect(saved.nodes.find((node: { id: string }) => node.id === 'one').x).not.toBe(0); expect(saved.nodes.find((node: { id: string }) => node.id === 'one').width).toBeGreaterThan(250);
    await page.reload(); await expect(page.getByRole('region', { name: 'Canvas', exact: true })).toHaveAttribute('data-node-count', '3');
    await page.screenshot({ path: 'test-results/canvas-completo.png' });
  } finally { await remove(page.request, dir); }
});

test('live preview, properties, tasks, embeds, math, and Mermaid work together', async ({ page }) => {
  const dir = folder(), path = `${dir}/Origem.md`, target = `${dir}/Destino.md`; await auth(page.request);
  try {
    await create(page.request, target, '# Destino\n\n## Trecho\n\nConteúdo incorporado.\n\nParágrafo referenciado. ^marca\n');
    await create(page.request, path, `---\ntags: [projetos]\nfeito: false\n---\n# Origem\n\n**Texto em negrito** e ==destaque==.\n\n- [ ] Tarefa editável\n\n![[${target.replace('.md', '')}#Trecho]]\n\n[[${target.replace('.md', '')}#^marca|Abrir bloco]]\n\n> [!tip] Dica\n> Corpo da dica.\n\n| Coluna | Valor |\n| --- | --- |\n| Exemplo | 42 |\n\n$x^2 + 1$\n\n\`\`\`mermaid\nflowchart LR\n A[Ideia] --> B[Nota]\n\`\`\`\n`);
    await page.goto('/'); await open(page, path);
    await expect(page.locator('.live-preview-editor strong')).toContainText('Texto em negrito');
    await page.getByRole('checkbox', { name: 'Alternar tarefa', exact: true }).check();
    await expect.poll(async () => (await note(page.request, path)).content).toContain('- [x] Tarefa editável');
    await page.locator('.inline-property').filter({ hasText: 'tags' }).getByRole('textbox').fill('projetos, estudo');
    await page.locator('.inline-property').filter({ hasText: 'tags' }).getByRole('textbox').press('Enter');
    await page.getByRole('button', { name: 'Ler', exact: true }).click();
    const preview = page.locator('.reading-pane [data-note-preview]');
    await expect(preview.locator('.embed-content')).toContainText('Conteúdo incorporado.'); await expect(preview.locator('.callout')).toContainText('Corpo da dica.');
    await expect(preview.locator('table')).toContainText('42'); await expect(preview.locator('.katex').first()).toBeVisible(); await expect(preview.locator('.mermaid-diagram svg')).toBeVisible({ timeout: 20000 });
    await page.screenshot({ path: 'test-results/markdown-rico.png' });
    await preview.getByRole('link', { name: 'Abrir bloco', exact: true }).click(); await expect(page.getByRole('tab', { name: 'Destino', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.reading-pane [data-block-id="marca"]')).toBeAttached();
    const saved = await note(page.request, path); expect(saved.properties.tags).toEqual(['projetos', 'estudo']);
  } finally { await remove(page.request, dir); }
});

test('history and trash restore data without overwriting an existing target', async ({ page }) => {
  const dir = folder(), path = `${dir}/Recuperar.md`; await auth(page.request);
  try {
    let current = await create(page.request, path, '# Versão inicial\n');
    const changed = await page.request.put('/api/note', { data: { path, content: '# Versão alterada\n', baseHash: current.hash } }); expect(changed.ok()).toBe(true);
    await page.goto('/'); await open(page, path); await page.getByRole('button', { name: 'Histórico de versões', exact: true }).click();
    const versions = await (await page.request.get('/api/history?path=' + encodeURIComponent(path))).json();
    let originalId = ''; for (const version of versions) { const data = await (await page.request.get(`/api/version?path=${encodeURIComponent(path)}&id=${version.id}`)).json(); if (data.content === '# Versão inicial\n') originalId = version.id; }
    expect(originalId).not.toBe(''); await page.locator(`[data-version-id="${originalId}"]`).click(); await page.getByRole('button', { name: 'Restaurar versão', exact: true }).click();
    await expect.poll(async () => (await note(page.request, path)).content).toBe('# Versão inicial\n');
    await page.getByRole('button', { name: 'Mover para lixeira', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Mover para lixeira', exact: true }).click();
    await page.getByRole('button', { name: 'Abrir lixeira', exact: true }).click();
    const entry = page.locator('.trash-entry').filter({ hasText: path }); await expect(entry).toBeVisible();
    await create(page.request, path, '# Arquivo existente\n'); await entry.getByRole('button', { name: 'Restaurar', exact: true }).click(); await expect(page.getByRole('dialog')).toContainText('Já existe um arquivo');
    await entry.getByRole('textbox').fill(`${dir}/Restaurada.md`); await entry.getByRole('button', { name: 'Restaurar', exact: true }).click();
    expect((await note(page.request, path)).content).toBe('# Arquivo existente\n'); expect((await note(page.request, `${dir}/Restaurada.md`)).content).toBe('# Versão inicial\n');
  } finally { await remove(page.request, dir); }
});

test('folder rename updates Markdown, wikilinks, and Canvas references while preserving history', async ({ request }) => {
  const dir = folder(); await auth(request);
  try {
    await create(request, `${dir}/Pasta/Alvo.md`, '# Alvo\n');
    await create(request, `${dir}/Index.md`, `[[${dir}/Pasta/Alvo#Seção|Exemplo]]\n\n[Link](Pasta/Alvo.md#Seção)\n\n\`[[${dir}/Pasta/Alvo]]\`\n`);
    await create(request, `${dir}/Mapa.canvas`, JSON.stringify({ extra: 'preservar', nodes: [{ id: 'note', type: 'file', file: `${dir}/Pasta/Alvo.md`, x: 0, y: 0, width: 200, height: 100 }], edges: [] }));
    const moved = await request.post('/api/note/rename', { data: { oldPath: `${dir}/Pasta`, newPath: `${dir}/Outra`, updateLinks: true } }); expect(moved.ok(), await moved.text()).toBe(true);
    const index = await note(request, `${dir}/Index.md`); expect(index.content).toContain('[Link](Outra/Alvo.md#Seção)'); expect(index.content).toContain(`\`[[${dir}/Pasta/Alvo]]\``);
    const canvas = JSON.parse((await note(request, `${dir}/Mapa.canvas`)).content); expect(canvas.nodes[0].file).toBe(`${dir}/Outra/Alvo.md`); expect(canvas.extra).toBe('preservar');
    const history = await request.get('/api/history?path=' + encodeURIComponent(`${dir}/Outra/Alvo.md`)); expect((await history.json()).length).toBeGreaterThan(0);
  } finally { await remove(request, dir); }
});

test('attachments, byte ranges, and ZIP export/import preserve files', async ({ request }) => {
  const dir = folder(); await auth(request);
  try {
    const bytes = Buffer.from('conteúdo binário de teste'); const upload = await request.post('/api/upload', { data: { path: `${dir}/audio.mp3`, base64: bytes.toString('base64') } }); expect(upload.ok()).toBe(true);
    const response = await request.get(`/api/attachment?path=${encodeURIComponent(`${dir}/audio.mp3`)}`, { headers: { Range: 'bytes=3-8' } }); expect(response.status()).toBe(206); expect(await response.body()).toEqual(bytes.subarray(3, 9));
    await create(request, `${dir}/Nota.md`, '# Portável\n'); const exported = await request.get('/api/export'); expect(exported.ok()).toBe(true); const entries = unzipSync(await exported.body()); expect(strFromU8(entries[`${dir}/Nota.md`])).toBe('# Portável\n'); expect(Buffer.from(entries[`${dir}/audio.mp3`])).toEqual(bytes);
    const archive = zipSync({ [`${dir}/Importada.md`]: strToU8('# Importada do ZIP\n'), [`${dir}/Nota.md`]: strToU8('# Não sobrescrever\n'), '../fora.md': strToU8('bloqueado') });
    const imported = await request.post('/api/import-zip', { data: { base64: Buffer.from(archive).toString('base64') } }); expect(imported.ok()).toBe(true); const result = await imported.json(); expect(result.imported).toBe(1); expect((await note(request, `${dir}/Nota.md`)).content).toBe('# Portável\n');
  } finally { await remove(request, dir); }
});

test('pinned tabs, split panes, and editor modes survive reload', async ({ page }) => {
  await auth(page.request); await page.goto('/'); await open(page, 'Index.md');
  await page.getByRole('button', { name: 'Fixar Index', exact: true }).click(); await page.getByRole('button', { name: 'Fechar Index', exact: true }).click(); await expect(page.getByRole('tab', { name: 'Index', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Dividir à direita', exact: true }).click(); await expect(page.locator('.secondary-pane')).toBeVisible();
  await page.locator('.secondary-pane').getByRole('button', { name: 'Ler', exact: true }).click();
  await expect(page.locator('.secondary-pane .reading-pane')).toBeVisible(); await expect(page.locator('.editor-workspace').first().locator('.cm-content')).toBeVisible();
  await page.screenshot({ path: 'test-results/workspace-dividido.png' });
  await page.reload(); await expect(page.locator('.secondary-pane .reading-pane')).toBeVisible(); await expect(page.getByRole('button', { name: 'Desafixar Index', exact: true })).toBeVisible();
});

test('offline draft survives reload and resolves conflicts after reconnection', async ({ page, context }) => {
  const dir = folder(), path = `${dir}/Offline.md`; let conflictCopy = ''; await auth(page.request);
  try {
    await create(page.request, path, '# Original\n'); await page.goto('/'); await open(page, path); await page.getByRole('button', { name: 'Fonte', exact: true }).click();
    await page.waitForFunction(async () => Boolean((await navigator.serviceWorker.ready).active)); await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true); const editor = page.locator('.cm-content'); await editor.click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nTexto criado offline.\n');
    await page.waitForFunction(async (path) => new Promise<boolean>((resolve) => { const open = indexedDB.open('notesprig-private'); open.onsuccess = () => { const request = open.result.transaction('state').objectStore('state').get(`doc:${path}`); request.onsuccess = () => resolve(Boolean(request.result?.dirty && request.result.content.includes('Texto criado offline.'))); }; }), path);
    page.once('dialog', (dialog) => dialog.accept()); await page.reload(); await expect(page.locator('.cm-content')).toContainText('Texto criado offline.'); await expect(page.locator('.titlebar')).toContainText('Offline');
    const remote = await note(page.request, path); const updated = await page.request.put('/api/note', { data: { path, content: '# Alterado em outro dispositivo\n', baseHash: remote.hash } }); expect(updated.ok()).toBe(true);
    await context.setOffline(false); await expect(page.getByRole('dialog')).toContainText('A nota mudou em outro lugar'); await page.getByRole('button', { name: 'Salvar como cópia', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/notes')).json()).some((entry: { path: string }) => entry.path.startsWith('Conflicts/Offline-'))).toBe(true);
    const list = await (await page.request.get('/api/notes')).json(); conflictCopy = list.find((entry: { path: string }) => entry.path.startsWith('Conflicts/Offline-')).path;
    expect((await note(page.request, conflictCopy)).content).toContain('Texto criado offline.'); expect((await note(page.request, path)).content).toBe('# Alterado em outro dispositivo\n');
  } finally { await context.setOffline(false); await remove(page.request, dir); if (conflictCopy) await remove(page.request, conflictCopy); }
});

test('templates and daily notes follow vault settings', async ({ page }) => {
  const dir = folder(); await auth(page.request);
  const previous = await (await page.request.get('/api/settings')).json();
  try {
    await create(page.request, `${dir}/Templates/Modelo.md`, '# {{title}}\n\nData: {{date:YYYY-MM-DD}}\n'); await create(page.request, `${dir}/Rascunho.md`, '# Rascunho\n\n');
    await page.request.put('/api/settings', { data: { templatesFolder: `${dir}/Templates`, dailyFolder: `${dir}/Diário`, dailyFormat: 'YYYY-MM-DD', dailyTemplate: `${dir}/Templates/Modelo.md`, attachmentFolder: 'attachments' } });
    await page.goto('/'); await open(page, `${dir}/Rascunho.md`); await page.getByRole('button', { name: 'Fonte', exact: true }).click(); await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
    await command(page, 'Inserir template'); await page.getByRole('dialog').getByRole('button', { name: `${dir}/Templates/Modelo.md`, exact: true }).click(); await expect(page.locator('.cm-content')).toContainText('Data:');
    await page.getByRole('button', { name: 'Nota diária', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/notes')).json()).some((entry: { path: string }) => entry.path.startsWith(`${dir}/Diário/`))).toBe(true);
    const list = await (await page.request.get('/api/notes')).json(); const dailyPath = list.find((entry: { path: string }) => entry.path.startsWith(`${dir}/Diário/`)).path; const content = (await note(page.request, dailyPath)).content; expect(content).toContain('Data:'); expect(content).not.toContain('{{');
  } finally { await page.request.put('/api/settings', { data: previous }); await remove(page.request, dir); }
});

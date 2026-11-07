import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { evaluateBase, matchesBaseFilter, type BaseRow } from '../src/bases';
const directory = () => `Extras-${randomUUID().slice(0, 8)}`;
test.use({ permissions: ['microphone'], launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] } });
async function login(page: import('@playwright/test').Page) { await page.request.post('/api/login', { data: { password: 'test-session-only' } }); }
async function create(page: import('@playwright/test').Page, path: string, content: string) { const response = await page.request.post('/api/note', { data: { path, content } }); expect(response.ok(), await response.text()).toBe(true); return response.json(); }
async function cleanup(page: import('@playwright/test').Page, path: string) { await page.request.delete('/api/note?path=' + encodeURIComponent(path), { headers: { 'Content-Type': 'application/json' } }); }
async function command(page: import('@playwright/test').Page, name: string) { await page.keyboard.press('Control+p'); await page.getByPlaceholder('Buscar comando…').fill(name); await page.keyboard.press('Enter'); }

test('Bases evaluates arithmetic, filters, and formulas without executing code', () => {
  const row: BaseRow = { file: { path: 'Livros/Exemplo.md', title: 'Exemplo', tags: ['livros'], aliases: [], links: [], size: 42, mtime: 0 }, properties: { price: 20, age: 4, status: 'reading' } };
  expect(evaluateBase('(price / age).toFixed(2)', row)).toBe('5.00');
  expect(evaluateBase('if(price, price.toFixed(2) + " reais")', row)).toBe('20.00 reais');
  expect(matchesBaseFilter({ and: ['file.hasTag("livros")', 'file.inFolder("Livros")', 'price > 5'] }, row, {})).toBe(true);
  expect(evaluateBase('formula.total + 1', row, { total: 'price * age' })).toBe(81);
  expect(() => evaluateBase('file.constructor.constructor("return globalThis")()', row)).toThrow();
  expect(() => evaluateBase('formula.loop', row, { loop: 'formula.loop' })).toThrow('Circular formula.');
});

test('Bases opens YAML, filters properties, edits cells, and switches layouts', async ({ page }) => {
  const dir = directory(); await login(page);
  try {
    await create(page, `${dir}/Livro.md`, '---\ntags: [livro]\nprice: 20\nage: 4\nstatus: reading\n---\n# Livro\n');
    await create(page, `${dir}/Lista.base`, `filters:\n  and:\n    - 'file.inFolder("${dir}")'\n    - 'file.ext == "md"'\nformulas:\n  unit: '(price / age).toFixed(2)'\nviews:\n  - type: table\n    name: Livros\n    order:\n      - file.name\n      - note.status\n      - formula.unit\n`);
    await page.goto('/'); await page.locator(`button.tree-file[title="${dir}/Lista.base"]`).click();
    const base = page.getByRole('region', { name: 'Base de propriedades', exact: true }); await expect(base.locator('tbody')).toContainText('Livro'); await expect(base.locator('tbody')).toContainText('5.00');
    const cell = base.getByRole('textbox', { name: 'note.status de Livro', exact: true }); await cell.fill('done'); await cell.press('Enter');
    await expect.poll(async () => (await (await page.request.get('/api/note?path=' + encodeURIComponent(`${dir}/Livro.md`))).json()).properties.status).toBe('done');
    await base.getByLabel('Layout da base', { exact: true }).selectOption('cards'); await expect(base.locator('.base-card')).toContainText('Livro');
    await base.getByLabel('Layout da base', { exact: true }).selectOption('kanban'); await expect(base.locator('.base-group')).toContainText('done');
    await page.screenshot({ path: 'test-results/bases-kanban.png' });
  } finally { await cleanup(page, dir); }
});

test('slides follow separators and audio records with a synthetic device', async ({ page }) => {
  const dir = directory(); let recordingPath = ''; await login(page);
  try {
    await create(page, `${dir}/Apresentação.md`, '# Primeiro slide\n\nTexto inicial.\n\n---\n\n# Segundo slide\n\nTexto final.\n');
    await page.goto('/'); await page.locator(`button.tree-file[title="${dir}/Apresentação.md"]`).click();
    await command(page, 'Slides: apresentar'); const slides = page.getByRole('dialog', { name: 'Apresentação de slides', exact: true }); await expect(slides).toContainText('Primeiro slide'); await slides.getByRole('button', { name: 'Próximo slide', exact: true }).click(); await expect(slides).toContainText('Segundo slide'); await page.getByRole('button', { name: 'Fechar apresentação', exact: true }).click();
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click(); await expect(page.locator('.recording-time')).toContainText('0:01'); await page.getByRole('button', { name: 'Parar gravação', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/files')).json()).some((file: { path: string }) => /Recording-.*\.webm$/.test(file.path))).toBe(true);
    const files = await (await page.request.get('/api/files')).json(); recordingPath = files.find((file: { path: string }) => /Recording-.*\.webm$/.test(file.path)).path;
    await expect.poll(async () => (await (await page.request.get('/api/note?path=' + encodeURIComponent(`${dir}/Apresentação.md`))).json()).content).toContain(recordingPath);
  } finally { await cleanup(page, dir); if (recordingPath) await cleanup(page, recordingPath); }
});

test('merging notes updates references and preserves the source in trash', async ({ page }) => {
  const dir = directory(); await login(page);
  try {
    await create(page, `${dir}/Origem.md`, '# Origem\n\nConteúdo da origem.\n');
    await create(page, `${dir}/Destino.md`, '# Destino\n\nConteúdo do destino.\n');
    await create(page, `${dir}/Referência.md`, `[[${dir}/Origem]]\n`);
    await page.goto('/'); await page.locator(`button.tree-file[title="${dir}/Origem.md"]`).click(); await command(page, 'Composição: mesclar');
    await page.getByRole('combobox', { name: 'Nota de destino', exact: true }).selectOption(`${dir}/Destino.md`); await expect(page.locator('.composer-preview')).toContainText('Conteúdo da origem.'); await page.getByRole('dialog').getByRole('button', { name: 'Mesclar notas', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/note?path=' + encodeURIComponent(`${dir}/Destino.md`))).json()).content).toContain('Conteúdo da origem.');
    const source = await page.request.get('/api/note?path=' + encodeURIComponent(`${dir}/Origem.md`)); expect(source.status()).toBe(404);
    const refs = await (await page.request.get('/api/note?path=' + encodeURIComponent(`${dir}/Referência.md`))).json(); expect(refs.content).toContain('Destino'); expect(refs.content).not.toContain('/Origem');
    expect((await (await page.request.get('/api/trash')).json()).some((entry: { path: string }) => entry.path === `${dir}/Origem.md`)).toBe(true);
  } finally { await cleanup(page, dir); }
});

test('extracting a selection preserves the excerpt and replaces its source with a link', async ({ page }) => {
  const dir = directory(); await login(page);
  try {
    await create(page, `${dir}/Origem.md`, '# Origem\n\nTrecho selecionado.');
    await page.goto('/'); await page.locator(`button.tree-file[title="${dir}/Origem.md"]`).click();
    await page.getByRole('button', { name: 'Fonte', exact: true }).click();
    const editor = page.locator('.cm-content'); await editor.click(); await editor.press('Control+End'); await editor.press('Home'); await editor.press('Shift+End');
    await command(page, 'Composição: extrair seleção');
    await page.getByLabel('Nome da nova nota', { exact: true }).fill(`${dir}/Trecho`); await page.getByRole('dialog').getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/note?path=' + encodeURIComponent(`${dir}/Origem.md`))).json()).content).toBe(`# Origem\n\n[[${dir}/Trecho]]`);
    const extracted = await (await page.request.get('/api/note?path=' + encodeURIComponent(`${dir}/Trecho.md`))).json(); expect(extracted.content).toBe('Trecho selecionado.');
  } finally { await cleanup(page, dir); }
});

test('recording audio while a Base is open preserves its YAML file', async ({ page }) => {
  const dir = directory(); let recordingPath = ''; await login(page);
  const yaml = 'views:\n  - type: table\n    name: Arquivos\n    order: [file.name]\n';
  try {
    await create(page, `${dir}/Lista.base`, yaml); await page.goto('/'); await page.locator(`button.tree-file[title="${dir}/Lista.base"]`).click();
    await expect(page.getByRole('region', { name: 'Base de propriedades', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click(); await expect(page.locator('.recording-time')).toContainText('0:01'); await page.getByRole('button', { name: 'Parar gravação', exact: true }).click();
    await expect.poll(async () => (await (await page.request.get('/api/files')).json()).some((file: { path: string }) => /Recording-.*\.webm$/.test(file.path))).toBe(true);
    const files = await (await page.request.get('/api/files')).json(); recordingPath = files.find((file: { path: string }) => /Recording-.*\.webm$/.test(file.path)).path;
    await expect.poll(async () => (await (await page.request.get('/api/note?path=' + encodeURIComponent(`${dir}/Lista.base`))).json()).content).toBe(yaml);
  } finally { await cleanup(page, dir); if (recordingPath) await cleanup(page, recordingPath); }
});

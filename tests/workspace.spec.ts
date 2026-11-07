import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function login(page: Page) {
  await page.request.post('/api/login', { data: { password: 'test-session-only' } });
  await page.goto('/');
  await expect(page.getByRole('tab', { name: 'Grafo global', exact: true })).toBeVisible();
}
async function openNote(page: Page, path: string) { await page.locator(`button.tree-file[title="${path}"]`).click(); }

test('graph uses real links, distinguishes ambiguous targets, and applies filters', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await login(page);
  const graph = page.getByRole('region', { name: 'Grafo global', exact: true });
  await expect(graph).toHaveAttribute('data-node-count', '9');
  await expect(graph).toHaveAttribute('data-edge-count', '7');
  await page.getByRole('button', { name: 'Configurações do grafo', exact: true }).click();
  await page.getByLabel('Somente arquivos existentes', { exact: true }).check();
  await expect(graph).toHaveAttribute('data-node-count', '7');
  await page.getByLabel('Notas órfãs', { exact: true }).uncheck();
  await expect(graph).toHaveAttribute('data-node-count', '3');
  await page.getByLabel('Notas órfãs', { exact: true }).check();
  await page.getByLabel('Filtrar arquivos no grafo').fill('path:Projetos');
  await expect(graph).toHaveAttribute('data-node-count', '1');
  await page.getByLabel('Filtrar arquivos no grafo').fill('tag:ideias');
  await expect(graph).toHaveAttribute('data-node-count', '1');
  await page.getByLabel('Filtrar arquivos no grafo').fill('');
  await page.getByRole('checkbox', { name: 'Tags', exact: true }).check();
  await expect(graph).toHaveAttribute('data-node-count', '10');
  await page.getByRole('button', { name: 'Restaurar padrões', exact: true }).click();
  await page.getByText('Grupos', { exact: true }).click();
  await page.getByRole('button', { name: 'Novo grupo', exact: true }).click();
  await page.getByLabel('Filtro do grupo 1', { exact: true }).fill('Atlas');
  await page.getByLabel('Cor do grupo 1', { exact: true }).fill('#ff6699');
  await expect.poll(() => page.locator('.editor-workspace canvas').evaluate((element: HTMLCanvasElement) => {
    const pixels = element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data;
    let count = 0;
    for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === 255 && pixels[i + 1] === 102 && pixels[i + 2] === 153 && pixels[i + 3] === 255) count++;
    return count;
  })).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Restaurar padrões', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar configurações do grafo' }).click();
  const before = await page.locator('.graph-zoom-value').innerText();
  await page.getByRole('button', { name: 'Aumentar zoom', exact: true }).click();
  await expect(page.locator('.graph-zoom-value')).not.toHaveText(before);
  await page.getByRole('button', { name: 'Enquadrar grafo', exact: true }).click();
  await page.screenshot({ path: 'test-results/grafo-global.png' });
  expect(errors).toEqual([]);
});

test('folders, tabs, and local graph open the correct notes', async ({ page }) => {
  await login(page);
  await openNote(page, 'Projetos/Atlas.md');
  await expect(page.getByRole('tab', { name: 'Atlas', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.cm-content')).toContainText('Próximas ações');
  await page.getByRole('button', { name: 'Abrir grafo local', exact: true }).click();
  const graph = page.getByRole('region', { name: 'Grafo local', exact: true }).first();
  await expect(graph).toHaveAttribute('data-node-count', '3');
  await page.getByRole('button', { name: 'Configurações do grafo', exact: true }).click();
  await page.getByLabel('Profundidade', { exact: true }).fill('2');
  await expect(graph).toHaveAttribute('data-node-count', '4');
  await page.getByRole('button', { name: 'Fechar configurações do grafo' }).click();
  await page.getByRole('button', { name: 'Lista de nós', exact: true }).click();
  await page.locator('.graph-node-list').getByRole('button', { name: /^Ligações/ }).click();
  await expect(page.getByRole('tab', { name: 'Ligações', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Atlas', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Próximas ações');
  await page.screenshot({ path: 'test-results/editor-pastas.png' });
});

test('edits are preserved when immediately opening the graph', async ({ page }) => {
  await login(page); await openNote(page, 'Órfã.md');
  const editor = page.locator('.cm-content');
  await editor.click(); await page.keyboard.press('Control+End');
  const marker = `Edição preservada ${Date.now()}`;
  await page.keyboard.insertText(`\n\n${marker}\n\n[[Projetos/Atlas]]`);
  await page.getByRole('button', { name: 'Abrir grafo global', exact: true }).click();
  await expect.poll(async () => {
    const response = await page.request.get('/api/note?path=' + encodeURIComponent('Órfã.md'));
    return (await response.json()).content;
  }).toContain(marker);
  await page.getByRole('tab', { name: 'Órfã', exact: true }).click();
  await expect(editor).toContainText(marker);
});

test('graph opens nodes through the canvas and the command palette supports keyboard navigation', async ({ page }) => {
  await login(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Isolate one existing node so a click can be located from its actual rendered pixels.
  await page.getByRole('button', { name: 'Configurações do grafo', exact: true }).click();
  await page.getByLabel('Filtrar arquivos no grafo').fill('path:Projetos');
  await page.getByRole('button', { name: 'Fechar configurações do grafo' }).click();
  const canvas = page.locator('.editor-workspace canvas');
  const findNodePixel = () => canvas.evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext('2d')!; const image = ctx.getImageData(0, 0, element.width, element.height);
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
      const i = (y * image.width + x) * 4;
      if (image.data[i] === 170 && image.data[i + 1] === 166 && image.data[i + 2] === 181 && image.data[i + 3] === 255) return { x: x / devicePixelRatio, y: y / devicePixelRatio };
    }
    throw new Error('Nenhum nó foi desenhado no canvas.');
  });
  const hit = await findNodePixel();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + 8); await page.mouse.down();
  await page.mouse.move(box.x + 68, box.y + 38, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => Math.round((await findNodePixel()).x - hit.x)).toBe(60);
  const moved = await findNodePixel();
  const zoom = await page.locator('.graph-zoom-value').innerText();
  await canvas.click({ position: moved });
  await expect(page.getByRole('tab', { name: 'Atlas', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+p');
  await page.getByPlaceholder('Buscar comando…').fill('Grafo: abrir visualização global');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Grafo global', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.graph-zoom-value')).toHaveText(zoom);
  await page.keyboard.press('Control+o');
  await page.getByPlaceholder('Abrir uma nota…').fill('Index'); await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Index', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('folder import preserves subfolders and skips existing files and configuration', async ({ page }) => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'notesprig-import-'));
  try {
    await mkdir(path.join(folder, 'Importadas')); await mkdir(path.join(folder, '.private-config'));
    await writeFile(path.join(folder, 'Importadas', 'Origem.md'), '# Origem\n\n[[Importadas/Destino]]\n');
    await writeFile(path.join(folder, 'Importadas', 'Destino.md'), '# Destino\n');
    await writeFile(path.join(folder, 'Index.md'), '# NÃO SOBRESCREVER\n');
    await writeFile(path.join(folder, '.private-config', 'ignorar.md'), 'Não deve aparecer.');
    await login(page);
    await page.getByLabel('Selecionar pasta Markdown').setInputFiles(folder);
    await expect(page.getByRole('dialog')).toContainText('3 notas encontradas');
    await page.getByRole('button', { name: 'Importar notas', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('2 notas adicionadas, 1 já existentes');
    const existing = await page.request.get('/api/note?path=Index.md');
    expect((await existing.json()).content).toContain('# Início');
    await openNote(page, 'Importadas/Origem.md');
    await page.getByRole('button', { name: 'Fonte', exact: true }).click();
    await expect(page.locator('.cm-content')).toContainText('[[Importadas/Destino]]');
  } finally { await rm(folder, { recursive: true, force: true }); }
});

test('panes resize and appearance preferences persist', async ({ page }) => {
  await login(page);
  const separator = page.getByRole('separator', { name: 'Largura do painel esquerdo' });
  const before = Number(await separator.getAttribute('aria-valuenow'));
  await separator.focus(); await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', String(before + 15));
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByLabel('Aparência', { exact: true }).selectOption('light');
  await page.getByRole('button', { name: 'Fechar configurações', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(separator).toHaveAttribute('aria-valuenow', String(before + 15));
});

test('graph renders a synthetic network of 500 notes', async ({ page }) => {
  const notes = Array.from({ length: 500 }, (_value, index) => ({
    path: `Rede/Nota ${index}.md`, title: `Nota ${index}`, aliases: [], tags: [], mtime: 0, size: 100,
    links: [{ target: `Rede/Nota ${(index + 1) % 500}`, embed: false, kind: 'wiki' }],
  }));
  await page.route('**/api/notes', (route) => route.fulfill({ json: notes }));
  await login(page);
  const graph = page.getByRole('region', { name: 'Grafo global', exact: true });
  await expect(graph).toHaveAttribute('data-node-count', '500');
  await expect(graph).toHaveAttribute('data-edge-count', '500');
  await page.getByRole('button', { name: 'Configurações do grafo', exact: true }).click();
  await page.getByLabel('Filtrar arquivos no grafo').fill('path:Nota 499');
  await expect(graph).toHaveAttribute('data-node-count', '1');
});

test('mobile layout fits the viewport and switches between explorer and graph', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await login(page);
  await page.getByRole('button', { name: 'Alternar explorador', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Grafo global', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/grafo-mobile.png' });
  await page.getByRole('button', { name: 'Alternar explorador', exact: true }).click();
  await openNote(page, 'Index.md');
  await expect(page.getByRole('tab', { name: 'Index', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'Explorador', exact: true })).not.toBeVisible();
});

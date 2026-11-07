import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.use({ storageState: { cookies: [], origins: [] } });

test('English is the default and authentication messages switch languages', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await page.getByLabel('Password', { exact: true }).fill('synthetic-incorrect-password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.form-error')).toHaveText('Incorrect password.');
  await page.getByLabel('Interface language').selectOption('pt-BR');
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
  await expect(page.getByLabel('Senha', { exact: true })).toBeVisible();
  await expect(page.locator('.form-error')).toHaveText('Senha incorreta.');
  await page.getByLabel('Idioma da interface').selectOption('en');
  await expect(page.locator('.form-error')).toHaveText('Incorrect password.');
});

test('language persists across reloads and stays in sync between tabs', async ({ page, context }) => {
  await page.goto('/');
  await page.getByLabel('Interface language').selectOption('pt-BR');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Entrar', exact: true })).toBeVisible();
  const second = await context.newPage();
  await second.goto('/');
  await expect(second.getByLabel('Idioma da interface')).toHaveValue('pt-BR');
  await page.getByLabel('Idioma da interface').selectOption('en');
  await expect(second.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await second.close();
  await page.evaluate(() => localStorage.setItem('notesprig.language', 'unsupported-locale'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('switching language offline preserves note contents, editor undo, and the selected language', async ({ page, context }) => {
  const folder = `Localization-${randomUUID().slice(0, 8)}`, file = `${folder}/Mixed.md`;
  const original = '# Hello / Olá\n\nEnglish and português remain unchanged.\n';
  await page.request.post('/api/login', { data: { password: 'test-session-only' } });
  expect((await page.request.post('/api/note', { data: { path: file, content: original } })).ok()).toBe(true);
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Mixed', exact: true }).click();
    await expect(page.locator('.cm-content')).toBeVisible();
    await page.getByRole('button', { name: 'Source', exact: true }).click();
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
    await context.setOffline(true);
    const editor = page.locator('.cm-content');
    await editor.click(); await page.keyboard.press('Control+End');
    await page.keyboard.insertText('\nUnsent multilingual draft / rascunho.');
    const before = await editor.innerText();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByLabel('Interface language').selectOption('pt-BR');
    await expect(page.getByRole('heading', { name: 'Configurações', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await editor.innerText()).toBe(before);
    await editor.click(); await page.keyboard.press('Control+z');
    await expect(editor).not.toContainText('Unsent multilingual draft');
    await expect(editor).toContainText('English and português remain unchanged.');
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nRecovered offline / recuperado.');
    await expect.poll(() => page.evaluate(async (file) => new Promise<boolean>((resolve) => {
      const open = indexedDB.open('notesprig-private');
      open.onsuccess = () => { const db = open.result, request = db.transaction('state').objectStore('state').get(`doc:${file}`); request.onsuccess = () => { db.close(); resolve(Boolean(request.result?.dirty && request.result.content.includes('Recovered offline'))); }; };
    }), file)).toBe(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR');
    await expect(page.locator('.cm-content')).toContainText('Recovered offline / recuperado.');
    await expect(page.getByRole('tab', { name: 'Mixed', exact: true })).toBeVisible();
    await context.setOffline(false);
    await expect.poll(async () => (await (await page.request.get('/api/note?path=' + encodeURIComponent(file))).json()).content).toContain('Recovered offline / recuperado.');
  } finally {
    await context.setOffline(false);
    await page.request.delete('/api/note?path=' + encodeURIComponent(folder), { headers: { 'Content-Type': 'application/json' } });
  }
});

test('graph controls, command palette, and editor search use the selected language', async ({ page }) => {
  await page.request.post('/api/login', { data: { password: 'test-session-only' } });
  await page.goto('/');
  const graph = page.getByRole('region', { name: 'Global graph', exact: true });
  await graph.getByRole('button', { name: 'Graph settings', exact: true }).click();
  await expect(graph.getByLabel('Filter graph files')).toBeVisible();
  await page.keyboard.press('Control+p');
  await expect(page.getByRole('dialog')).toContainText('Create new note');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Interface language').selectOption('pt-BR');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('region', { name: 'Grafo global', exact: true }).getByLabel('Filtrar arquivos no grafo')).toBeVisible();
  await page.getByRole('button', { name: 'Index', exact: true }).click();
  const editor = page.locator('.cm-content'); await editor.click();
  await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search').getByLabel('Localizar', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByLabel('Idioma da interface').selectOption('en');
  await page.keyboard.press('Escape');
  await editor.click(); await page.keyboard.press('Control+f');
  await expect(page.locator('.cm-search').getByLabel('Find', { exact: true })).toBeVisible();
});

import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const unique = (prefix: string) => `${prefix} ${randomUUID().slice(0, 6)}`;
async function login(request: APIRequestContext) { expect((await request.post('/api/login', { data: { password: 'test-session-only' } })).ok()).toBe(true); }
async function contextFor(request: APIRequestContext, id?: string) { const response = await request.get('/api/boards/context' + (id ? `?vault=${id}` : '')); expect(response.ok()).toBe(true); return response.json(); }
const headers = (context: unknown) => ({ 'X-NoteSprig-Context': JSON.stringify(context), 'Content-Type': 'application/json' });

test('vaults are isolated: notes, search, attachments, and export follow the workspace identity', async ({ request }) => {
  await login(request);
  const list = await (await request.get('/api/vaults')).json();
  const main = list.find((vault: { default: boolean }) => vault.default);
  expect(main).toBeTruthy();
  const name = unique('Trabalho');
  const created = await (await request.post('/api/vaults', { data: { name } })).json();
  expect(created).toMatchObject({ name, default: false });
  expect(created.id).not.toBe(main.id);
  const work = await contextFor(request, created.id), home = await contextFor(request);
  expect(work.vaultId).toBe(created.id); expect(home.vaultId).toBe(main.id);
  // A note created in the new vault exists only there.
  expect((await request.post('/api/note', { headers: headers(work), data: { path: 'Projeto.md', content: '# Projeto secreto VAULT-ISOLATION' } })).ok()).toBe(true);
  const workNotes = await (await request.get('/api/notes', { headers: headers(work) })).json();
  const homeNotes = await (await request.get('/api/notes', { headers: headers(home) })).json();
  expect(workNotes.map((note: { path: string }) => note.path)).toEqual(['Projeto.md']);
  expect(homeNotes.some((note: { path: string }) => note.path === 'Projeto.md')).toBe(false);
  expect(homeNotes.some((note: { path: string }) => note.path === 'Index.md')).toBe(true);
  expect((await (await request.get('/api/search?q=VAULT-ISOLATION', { headers: headers(home) })).json()).total).toBe(0);
  expect((await (await request.get('/api/search?q=VAULT-ISOLATION', { headers: headers(work) })).json()).total).toBeGreaterThan(0);
  // URL-addressed resources route by their context parameter.
  expect((await request.post('/api/upload', { headers: headers(work), data: { path: 'logo.png', base64: Buffer.from('png-bytes').toString('base64') } })).ok()).toBe(true);
  expect((await request.get(`/api/attachment?path=logo.png&context=${encodeURIComponent(JSON.stringify(work))}`)).status()).toBe(200);
  expect((await request.get(`/api/attachment?path=logo.png&context=${encodeURIComponent(JSON.stringify(home))}`)).status()).toBe(404);
  const exported = await request.get(`/api/export?context=${encodeURIComponent(JSON.stringify(work))}`);
  expect(exported.ok()).toBe(true); expect((await exported.body()).includes(Buffer.from('Projeto.md'))).toBe(true);
  // A context from one vault can never be replayed against another vault's data.
  expect((await request.get('/api/note?path=Projeto.md', { headers: headers({ ...home, vaultId: work.vaultId }) })).ok()).toBe(false);
});

test('vault names are validated, unique, and renamable; unknown vaults are rejected', async ({ request }) => {
  await login(request);
  const name = unique('Estudos');
  const created = await (await request.post('/api/vaults', { data: { name } })).json();
  expect((await request.post('/api/vaults', { data: { name: name.toUpperCase() } })).status()).toBe(409);
  expect((await request.post('/api/vaults', { data: { name: '   ' } })).status()).toBe(400);
  expect((await request.post('/api/vaults', { data: { name: 'x'.repeat(61) } })).status()).toBe(400);
  const traversal = await (await request.post('/api/vaults', { data: { name: unique('../../etc') } })).json();
  expect(traversal.name).toContain('../../etc');
  const renamed = await (await request.put('/api/vaults', { data: { id: created.id, name: name + ' renamed' } })).json();
  expect(renamed).toMatchObject({ id: created.id, name: name + ' renamed' });
  expect((await (await request.get('/api/vaults')).json()).some((vault: { id: string; name: string }) => vault.id === created.id && vault.name === name + ' renamed')).toBe(true);
  const missing = await request.get('/api/boards/context?vault=00000000-0000-4000-8000-000000000000');
  expect(missing.status()).toBe(404); expect((await missing.json()).code).toBe('VAULT_NOT_FOUND');
  expect((await request.get('/api/vaults', { headers: {} })).ok()).toBe(true);
});

test('vault menu creates, opens, and switches vaults like Obsidian, keeping each workspace separate', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => localStorage.setItem('notesprig.language', 'en'));
  await page.request.post('/api/login', { data: { password: 'test-session-only' } });
  await page.goto('/');
  const switcher = page.getByRole('button', { name: /^Switch vault/ });
  await expect(switcher).toContainText('My vault');
  await expect(page.locator('button.tree-file[title="Index.md"]')).toBeVisible();
  // Create and open a new vault from the menu.
  const name = unique('Research');
  await switcher.click();
  await page.getByRole('menuitem', { name: 'Manage vaults…' }).click();
  await page.getByLabel('Create a new vault').fill(name);
  await page.getByRole('button', { name: 'Create and open', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Switch vault/ })).toContainText(name);
  await expect(page.locator('header.titlebar')).toContainText(name);
  await expect(page.locator('button.tree-file[title="Index.md"]')).toHaveCount(0);
  // Work in the new vault.
  expect((await page.request.post('/api/note', { headers: headers(await contextFor(page.request, await page.evaluate(() => localStorage.getItem('notesprig.vault') || ''))), data: { path: 'Ideas.md', content: '# Ideas' } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole('button', { name: /^Switch vault/ })).toContainText(name);
  await expect(page.locator('button.tree-file[title="Ideas.md"]')).toBeVisible();
  // Switch back through the menu: the default vault and its files return.
  await page.getByRole('button', { name: /^Switch vault/ }).click();
  await expect(page.getByRole('menuitemradio', { name, exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('menuitemradio', { name: 'My vault', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Switch vault/ })).toContainText('My vault');
  await expect(page.locator('button.tree-file[title="Index.md"]')).toBeVisible();
  await expect(page.locator('button.tree-file[title="Ideas.md"]')).toHaveCount(0);
});

test('a vault removed on the server falls back to the default vault instead of locking the app', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('notesprig.language', 'en'); if (!sessionStorage.getItem('seeded')) { localStorage.setItem('notesprig.vault', '00000000-0000-4000-8000-000000000000'); sessionStorage.setItem('seeded', '1'); } });
  await page.request.post('/api/login', { data: { password: 'test-session-only' } });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /^Switch vault/ })).toContainText('My vault');
  await expect(page.locator('button.tree-file[title="Index.md"]')).toBeVisible();
});

test('removing a vault requires its exact name, keeps its folder, and never removes the default vault', async ({ request }) => {
  await login(request);
  const main = (await (await request.get('/api/vaults')).json()).find((vault: { default: boolean }) => vault.default);
  const remove = (id: string, confirmName: string) => request.delete('/api/vaults', { headers: { 'Content-Type': 'application/json' }, data: { id, confirmName } });
  expect((await remove(main.id, main.name)).status()).toBe(400);
  const name = unique('Arquivo');
  const created = await (await request.post('/api/vaults', { data: { name } })).json();
  const context = await contextFor(request, created.id);
  expect((await request.post('/api/note', { headers: headers(context), data: { path: 'Keep.md', content: '# Keep' } })).ok()).toBe(true);
  expect((await remove(created.id, name + ' typo')).status()).toBe(400);
  const removed = await remove(created.id, name);
  expect(removed.ok()).toBe(true);
  expect((await removed.json()).removedTo).toMatch(/^\.removed\//);
  expect((await (await request.get('/api/vaults')).json()).some((vault: { id: string }) => vault.id === created.id)).toBe(false);
  expect((await request.get(`/api/boards/context?vault=${created.id}`)).status()).toBe(404);
  expect((await request.get('/api/notes', { headers: headers(context) })).status()).toBe(404);
  // A new vault may reuse the name without colliding with the removed folder.
  expect((await request.post('/api/vaults', { data: { name } })).ok()).toBe(true);
});

test('the vault manager removes another vault after typed confirmation; the open and default vaults offer no remove action', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('notesprig.language', 'en'));
  await page.request.post('/api/login', { data: { password: 'test-session-only' } });
  const name = unique('Old project');
  await page.request.post('/api/vaults', { data: { name } });
  await page.goto('/');
  await page.getByRole('button', { name: /^Switch vault/ }).click();
  await page.getByRole('menuitem', { name: 'Manage vaults…' }).click();
  await expect(page.getByRole('button', { name: /^Remove vault My vault/ })).toHaveCount(0);
  await page.getByRole('button', { name: `Remove vault ${name}`, exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Remove vault', exact: true });
  await expect(confirm).toBeDisabled();
  await page.getByLabel(`Type ${name} to confirm`).fill(name);
  await confirm.click();
  await expect(page.locator('.vault-list')).not.toContainText(name);
  await expect(page.getByText('Vault removed.', { exact: false }).first()).toBeVisible();
});

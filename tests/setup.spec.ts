import { test, expect, type APIRequestContext } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// First-run setup against a real production server (HTTPS proxy, secure cookies), without configured credentials.
const PROXY = 4333, APP = 4334, base = `https://127.0.0.1:${PROXY}`;
test.describe.configure({ mode: 'serial' });
test.use({ baseURL: base, ignoreHTTPSErrors: true });

type Running = { server: ChildProcess; output: () => string };
async function start(root: string, request: APIRequestContext): Promise<Running> {
  const server = spawn(process.execPath, ['tests/production-server.mjs'], { stdio: 'pipe', env: { ...process.env, NOTESPRIG_TEST_SETUP: '1', NOTESPRIG_TEST_ROOT: root, NOTESPRIG_TEST_APP_PORT: String(APP), NOTESPRIG_TEST_PROXY_PORT: String(PROXY) } });
  let output = ''; server.stdout?.on('data', (chunk) => { output += chunk; }); server.stderr?.on('data', (chunk) => { output += chunk; });
  await expect.poll(async () => { if (server.exitCode !== null) throw new Error(output); try { return (await request.get(`${base}/api/session`)).status(); } catch { return 0; } }, { timeout: 20000 }).toBe(200);
  return { server, output: () => output };
}
async function stop(running?: Running) { if (running && running.server.exitCode === null) { const closed = new Promise<void>((resolve) => running.server.once('exit', () => resolve())); running.server.kill('SIGTERM'); await closed; } }
const setupCode = (output: string) => output.match(/setup code ([A-Z\d]{4}-[A-Z\d]{4}-[A-Z\d]{4})/)?.[1];

let root = '';
test.beforeAll(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-setup-')); });
test.afterAll(async () => { await rm(root, { recursive: true, force: true }); });

test('first run requires the log setup code once, stores only a hash, and survives restarts', async ({ playwright }) => {
  test.setTimeout(90000);
  const request = await playwright.request.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  let running = await start(root, request);
  try {
    expect(await (await request.get('/api/session')).json()).toEqual({ authenticated: false, setupRequired: true });
    expect((await request.get('/api/files')).status()).toBe(401);
    expect((await request.post('/api/login', { data: { password: 'anything-at-all-here' } })).status()).toBe(401);
    const code = setupCode(running.output());
    expect(code).toBeTruthy();
    expect((await request.post('/api/setup', { data: { code: 'AAAA-BBBB-CCCC', password: 'a-good-long-password' } })).status()).toBe(401);
    expect((await request.post('/api/setup', { data: { code, password: 'short' } })).status()).toBe(400);
    // The code is accepted case-insensitively and without separators.
    const created = await request.post('/api/setup', { data: { code: code!.toLowerCase().replace(/-/g, ''), password: 'a-good-long-password' } });
    expect(created.ok()).toBe(true);
    expect((await request.get('/api/files')).status()).toBe(200);
    expect((await request.post('/api/setup', { data: { code, password: 'another-long-password' } })).status()).toBe(409);
    expect(await (await request.get('/api/session')).json()).toEqual({ authenticated: true, setupRequired: false });
    const file = path.join(root, 'notesprig-auth.json');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    const stored = await readFile(file, 'utf8');
    expect(stored).toMatch(/"passwordHash": "scrypt\$/); expect(stored).not.toContain('a-good-long-password');
    // Restart: no new setup code, the session secret persisted, so the existing session stays valid.
    await stop(running); running = await start(root, request);
    expect(setupCode(running.output())).toBeUndefined();
    expect(await (await request.get('/api/session')).json()).toEqual({ authenticated: true, setupRequired: false });
    expect((await request.get('/api/files')).status()).toBe(200);
  } finally { await stop(running); await request.dispose(); }
});

test('changing the password signs out other devices and replaces the old password', async ({ playwright }) => {
  test.setTimeout(90000);
  const phone = await playwright.request.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  const laptop = await playwright.request.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  const running = await start(root, phone);
  try {
    expect((await phone.post('/api/login', { data: { password: 'a-good-long-password' } })).ok()).toBe(true);
    expect((await laptop.post('/api/login', { data: { password: 'a-good-long-password' } })).ok()).toBe(true);
    expect(await (await laptop.get('/api/password')).json()).toEqual({ changeable: true });
    expect((await laptop.post('/api/password', { data: { current: 'wrong-current-password', next: 'a-brand-new-password' } })).status()).toBe(401);
    expect((await laptop.post('/api/password', { data: { current: 'a-good-long-password', next: 'short' } })).status()).toBe(400);
    expect((await laptop.post('/api/password', { data: { current: 'a-good-long-password', next: 'a-brand-new-password' } })).ok()).toBe(true);
    expect((await laptop.get('/api/files')).status()).toBe(200);
    expect((await phone.get('/api/files')).status()).toBe(401);
    expect((await phone.post('/api/login', { data: { password: 'a-good-long-password' } })).status()).toBe(401);
    expect((await phone.post('/api/login', { data: { password: 'a-brand-new-password' } })).ok()).toBe(true);
  } finally { await stop(running); await phone.dispose(); await laptop.dispose(); }
});

test('the browser shows the first-run form and opens the app after setup', async ({ page, playwright }) => {
  test.setTimeout(90000);
  const fresh = await mkdtemp(path.join(os.tmpdir(), 'notesprig-setup-ui-'));
  const request = await playwright.request.newContext({ baseURL: base, ignoreHTTPSErrors: true });
  const running = await start(fresh, request);
  try {
    await page.addInitScript(() => localStorage.setItem('notesprig.language', 'en'));
    await page.goto('/');
    await page.getByLabel('Setup code').fill(setupCode(running.output())!);
    await page.getByLabel('New password').fill('my-first-password');
    await page.getByLabel('Repeat password').fill('my-first-password-typo');
    await page.getByRole('button', { name: 'Create password and open' }).click();
    await expect(page.getByText('The passwords do not match.')).toBeVisible();
    await page.getByLabel('Repeat password').fill('my-first-password');
    await page.getByRole('button', { name: 'Create password and open' }).click();
    await expect(page.getByRole('button', { name: /^Switch vault/ })).toBeVisible({ timeout: 20000 });
    // Change the password from Settings.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByText('Password', { exact: true }).click();
    await page.getByLabel('Current password').fill('my-first-password');
    await page.getByLabel('New password').fill('my-second-password');
    await page.getByLabel('Repeat password').fill('my-second-password');
    await page.getByRole('button', { name: 'Change password', exact: true }).click();
    await expect(page.getByText('Password changed. Other devices were signed out.')).toBeVisible();
    expect((await request.post('/api/login', { data: { password: 'my-second-password' } })).ok()).toBe(true);
  } finally { await stop(running); await request.dispose(); await rm(fresh, { recursive: true, force: true }); }
});

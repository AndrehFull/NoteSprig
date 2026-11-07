import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
let server: ChildProcess;
test.use({ baseURL: 'https://127.0.0.1:4319', ignoreHTTPSErrors: true });
test.beforeAll(async ({ playwright }) => {
  server = spawn(process.execPath, ['tests/production-server.mjs'], { stdio: 'pipe' }); let output = ''; server.stdout?.on('data', (chunk) => { output += chunk; }); server.stderr?.on('data', (chunk) => { output += chunk; });
  const request = await playwright.request.newContext({ ignoreHTTPSErrors: true });
  try { await expect.poll(async () => { if (server.exitCode !== null) throw new Error(output); try { return (await request.get('https://127.0.0.1:4319/api/session')).status(); } catch { return 0; } }, { timeout: 15000 }).toBe(200); } finally { await request.dispose(); }
});
test.afterAll(async () => { if (server && server.exitCode === null) { const closed = new Promise<void>((resolve) => server.once('exit', () => resolve())); server.kill('SIGTERM'); await closed; } });
test('production protects files and renders Markdown with CSP over HTTPS', async ({ page }) => {
  expect((await page.request.get('/api/files')).status()).toBe(401);
  const login = await page.request.post('/api/login', { data: { password: 'production-test-password' } }); expect(login.ok()).toBe(true);
  const cookie = (await page.context().cookies()).find((entry) => entry.name === 'notesprig_session')!;
  expect({ secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite }).toEqual({ secure: true, httpOnly: true, sameSite: 'Strict' });
  const path = 'Produção.md'; await page.request.post('/api/note', { data: { path, content: '# Produção\n\n$x^2$\n\n```mermaid\nflowchart LR\n A-->B\n```\n\n<img src=x onerror="window.__xss=1">\n<script>window.__xss=1</script>\n' } });
  const response = await page.goto('/'); expect(response?.headers()['content-security-policy']).toContain("script-src 'self'");
  await page.locator(`button.tree-file[title="${path}"]`).click(); await page.getByRole('button', { name: 'Ler', exact: true }).click();
  await expect(page.locator('.reading-pane .katex')).toBeVisible(); await expect(page.locator('.reading-pane .mermaid-diagram svg')).toBeVisible({ timeout: 15000 });
  expect(await page.evaluate(() => (window as Window & { __xss?: number }).__xss)).toBeUndefined();
});

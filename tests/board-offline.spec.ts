import { test, expect } from '@playwright/test';
import { createServer, request as proxyRequest, type Server } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { LEGACY_MEDIA } from '../src/legacy';

const origin = 'http://127.0.0.1:4326';
const dist = path.resolve('dist');
const policy = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self'; frame-src 'none'";
const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.wasm': 'application/wasm', '.txt': 'text/plain' };
let server: Server;
test.beforeAll(async () => {
  await stat(path.join(dist, '.vite/manifest.json'));
  server = createServer(async (request, response) => {
    const url = new URL(request.url!, origin);
    if (url.pathname.startsWith('/api/')) {
      const outgoing = proxyRequest(new URL(url.pathname + url.search, 'http://127.0.0.1:4318'), { method: request.method, headers: { ...request.headers, host: '127.0.0.1:4318', origin: 'http://127.0.0.1:4318' } }, (incoming) => { response.writeHead(incoming.statusCode!, { ...incoming.headers, 'content-security-policy': policy }); incoming.pipe(response); });
      outgoing.on('error', () => { response.writeHead(502); response.end(); }); request.pipe(outgoing); return;
    }
    try {
      const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
      const file = path.resolve(dist, '.' + relative);
      if (!file.startsWith(dist + path.sep)) throw new Error('Invalid path');
      const bytes = await readFile(file);
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length, 'Content-Security-Policy': policy, 'Cache-Control': file.endsWith('index.html') || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=31536000, immutable' }); response.end(bytes);
    } catch { response.writeHead(404); response.end('Missing test asset'); }
  });
  await new Promise<void>((resolve) => server.listen(4326, '127.0.0.1', resolve));
});
test.afterAll(async () => { server?.closeAllConnections(); await new Promise<void>((resolve) => server ? server.close(() => resolve()) : resolve()); });

test('production shell defers the drawing engine and verifies complete feature dependencies before offline reopening', async ({ page }) => {
  test.setTimeout(120000);
  await page.request.post(`${origin}/api/login`, { data: { password: 'test-session-only' } });
  await page.addInitScript(() => { localStorage.setItem('notesprig.boardsEnabled', 'true'); localStorage.setItem('notesprig.language', 'en'); });
  const externalResponses: string[] = [];
  page.on('response', (response) => { if (/^https?:/.test(response.url()) && new URL(response.url()).origin !== origin) externalResponses.push(response.url()); });
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const manifest = await page.evaluate(async () => {
    const url = document.querySelector<HTMLMetaElement>('meta[name="notesprig-board-manifest"]')!.content;
    return (await fetch(url)).json();
  });
  const shellUrls = await page.evaluate(async () => {
    const name = (await caches.keys()).find((key) => key.startsWith('notesprig-shell-'))!;
    return (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname);
  });
  expect(manifest.assets.length).toBeGreaterThan(10);
  expect(manifest.assets.some((asset: { url: string }) => shellUrls.includes(asset.url))).toBe(false);
  expect(shellUrls.some((url) => url.startsWith('/board-assets/'))).toBe(false);
  const name = `Offline-${randomUUID().slice(0, 8)}`;
  try {
  await page.getByRole('button', { name: 'New visual board', exact: true }).click();
  await page.getByRole('textbox', { name: 'Board name', exact: true }).fill(name);
  await page.getByRole('textbox', { name: 'Board name', exact: true }).press('Enter');
  await expect(page.getByRole('region', { name: 'Visual board', exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Choose a note', exact: true }).selectOption('Index.md');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('[data-board-card]')).toContainText('Início');
  await expect.poll(() => page.evaluate(async (version) => Boolean(await (await caches.open(`notesprig-board-feature-${version}`)).match('/__notesprig-board-feature-ready__')), manifest.version), { timeout: 60000 }).toBe(true);
  const cachedAssets = await page.evaluate(async (version) => (await (await caches.open(`notesprig-board-feature-${version}`)).keys()).map((request) => new URL(request.url).pathname), manifest.version);
  expect(manifest.assets.filter((asset: { url: string }) => !cachedAssets.includes(asset.url)).map((asset: { url: string }) => asset.url)).toEqual([]);
  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole('region', { name: 'Visual board', exact: true })).toBeVisible();
  await expect(page.locator('.excalidraw__canvas.interactive')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(externalResponses).toEqual([]);
  } finally {
    await page.context().setOffline(false);
    await page.request.delete(`${origin}/api/note?path=${encodeURIComponent(name + '.board')}`, { headers: { 'Content-Type': 'application/json' } });
  }
});

test('new service-worker activation retains old hashed public dependencies for open clients', async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  await page.evaluate(async () => { const cache = await caches.open('notesprig-shell-old-client-proof'); await cache.put('/assets/old-client-proof.js', new Response('export const preserved = true;', { headers: { 'Content-Type': 'text/javascript' } })); await navigator.serviceWorker.register('/sw.js?board-upgrade-proof', { updateViaCache: 'none' }); });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.includes('board-upgrade-proof'));
  expect(await page.evaluate(async () => (await fetch('/assets/old-client-proof.js')).text())).toContain('preserved = true');
  expect(await page.evaluate(async () => (await caches.keys()).includes('notesprig-shell-old-client-proof'))).toBe(true);
});

test('scoped offline media never resolves another workspace or an unverified legacy cache', async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const first = { vaultId: randomUUID(), restoreGeneration: randomUUID(), epoch: randomUUID() };
  const second = { vaultId: randomUUID(), restoreGeneration: randomUUID(), epoch: randomUUID() };
  const plain = '/api/attachment?path=shared.png';
  const oldUrl = `${plain}&context=${encodeURIComponent(JSON.stringify(first))}`;
  const newUrl = `${plain}&context=${encodeURIComponent(JSON.stringify(second))}`;
  const invalidUrl = `${plain}&context=invalid`;
  await page.evaluate(async ({ plain, oldUrl, newUrl, invalidUrl, legacyMedia }) => {
    const current = await caches.open('notesprig-media-v1');
    await current.put(plain, new Response('unscoped old image'));
    await current.put(oldUrl, new Response('verified old workspace image'));
    await current.put(invalidUrl, new Response('invalid context poison'));
    const previous = await caches.open(legacyMedia);
    await previous.put(newUrl, new Response('unverified legacy poison'));
  }, { plain, oldUrl, newUrl, invalidUrl, legacyMedia: LEGACY_MEDIA });
  await page.context().setOffline(true);
  const results = await page.evaluate(async ({ oldUrl, newUrl, invalidUrl }) => {
    const read = async (url: string) => { const response = await fetch(url); return { status: response.status, body: await response.text() }; };
    return { old: await read(oldUrl), next: await read(newUrl), invalid: await read(invalidUrl) };
  }, { oldUrl, newUrl, invalidUrl });
  expect(results.old).toEqual({ status: 200, body: 'verified old workspace image' });
  expect(results.next.status).toBe(503);
  expect(results.next.body).not.toContain('old image'); expect(results.next.body).not.toContain('poison');
  expect(results.invalid.status).toBe(503); expect(results.invalid.body).not.toContain('poison');
});

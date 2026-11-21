import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';

let probe: ChildProcess;
test.beforeAll(async () => {
  probe = spawn(process.execPath, ['tests/board-probe-server.mjs'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Board probe did not start')), 25000);
    probe.stdout!.on('data', (chunk) => { if (chunk.toString().includes('Board probe ready')) { clearTimeout(timer); resolve(); } });
    probe.stderr!.on('data', (chunk) => process.stderr.write(chunk));
    probe.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Board probe exited: ${code}`)); });
  });
});
test.afterAll(async () => { if (probe && probe.exitCode === null) { probe.kill('SIGTERM'); await new Promise<void>((resolve) => probe.once('exit', () => resolve())); } });

test('native engine draws, moves cards, retains arrows/images and reopens a saved scene without external requests', async ({ page }) => {
  test.setTimeout(90000);
  const external: string[] = [];
  const externalResponses: string[] = [];
  const externalFailures: string[] = [];
  page.on('request', (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== 'http://127.0.0.1:4316') external.push(request.url()); });
  page.on('response', (response) => { if (new URL(response.url()).origin !== 'http://127.0.0.1:4316') externalResponses.push(response.url()); });
  page.on('requestfailed', (request) => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== 'http://127.0.0.1:4316') externalFailures.push(request.url()); });
  await page.goto('http://127.0.0.1:4316/tests/board-probe.html');
  await page.waitForFunction(() => Boolean((window as any).__boardProbe?.api));
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('[data-board-card]')).toContainText('Início');
  const card = await page.evaluate(() => (window as any).__boardProbe.api.getSceneElements().find((element: any) => element.type === 'embeddable'));
  const canvas = page.locator('.excalidraw__canvas.interactive');
  await canvas.click({ position: { x: 850, y: 500 } });
  await page.keyboard.press('r');
  await page.mouse.move(850, 550); await page.mouse.down(); await page.mouse.move(1000, 650, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__boardProbe.api.getSceneElements().filter((element: any) => element.type === 'rectangle').length)).toBe(1);
  await page.keyboard.press('Control+z');
  await expect.poll(() => page.evaluate(() => (window as any).__boardProbe.api.getSceneElements().filter((element: any) => element.type === 'rectangle').length)).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => page.evaluate(() => (window as any).__boardProbe.api.getSceneElements().filter((element: any) => element.type === 'rectangle').length)).toBe(1);
  await page.keyboard.press('v');
  const bounds = await page.locator('[data-board-card]').boundingBox();
  // Native embeddables reserve their body for activation; their border is the drag surface.
  const dragX = bounds!.x + bounds!.width;
  await page.mouse.move(dragX, bounds!.y + 70); await page.mouse.down(); await page.mouse.move(dragX + 80, bounds!.y + 120, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => page.evaluate((id) => (window as any).__boardProbe.api.getSceneElements().find((element: any) => element.id === id).x, card.id)).toBeGreaterThan(card.x + 30);
  await page.getByRole('button', { name: 'Add image and arrow', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__boardProbe.api.getSceneElements().length)).toBe(4);
  await page.getByRole('button', { name: 'Save probe' }).click();
  await page.reload();
  await page.waitForFunction(() => (window as any).__boardProbe?.api.getSceneElements().length === 4);
  await expect(page.locator('iframe')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys((window as any).__boardProbe.api.getFiles()))).toEqual(['probe-image']);
  // Warm the local export-font byte cache while online, then prove warm offline export.
  await page.evaluate(() => (window as any).__boardProbe.exportSvg());
  await page.context().setOffline(true);
  const svg = await page.evaluate(() => (window as any).__boardProbe.exportSvg());
  expect(svg).toContain('<svg'); expect(svg).not.toContain('/_notesprig/'); expect(svg).not.toContain('"binding"'); expect(svg).not.toContain('https://esm.sh');
  await page.context().setOffline(false);
  // The pinned upstream FontFace constructor includes CDN fallbacks. CSP denies
  // those sources; no external response is allowed, including during export.
  expect(externalResponses).toEqual([]);
  expect(external.every((url) => url.startsWith('https://esm.sh/@excalidraw/excalidraw@0.18.1/dist/prod/fonts/'))).toBe(true);
  expect([...externalFailures].sort()).toEqual([...external].sort());
});

test('preview/language updates preserve geometry and undo; clipboard/drop cannot bypass the host', async ({ page }) => {
  await page.goto('http://127.0.0.1:4316/tests/board-probe.html');
  await page.waitForFunction(() => Boolean((window as any).__boardProbe?.api));
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('[data-board-card]')).toContainText('Início');
  const before = await page.evaluate(() => JSON.stringify((window as any).__boardProbe.api.getSceneElementsIncludingDeleted()));
  const count = await page.getByTestId('changes').textContent();
  await page.getByRole('button', { name: 'Refresh preview' }).click();
  await expect(page.locator('[data-board-card]')).toContainText('Updated note excerpt');
  await page.getByRole('button', { name: 'Português' }).click();
  expect(await page.evaluate(() => JSON.stringify((window as any).__boardProbe.api.getSceneElementsIncludingDeleted()))).toBe(before);
  await expect(page.getByTestId('changes')).toHaveText(count!);
  await page.locator('[data-board-engine]').dispatchEvent('paste', { bubbles: true, cancelable: true });
  await page.locator('[data-board-engine]').dispatchEvent('drop', { bubbles: true, cancelable: true });
  await expect(page.getByTestId('blocked')).toHaveText('2');
  await expect(page.locator('iframe')).toHaveCount(0);
});

test('cards resize, rotate, duplicate and delete through native interaction without changing their note', async ({ page }) => {
  await page.goto('http://127.0.0.1:4316/tests/board-probe.html');
  await page.waitForFunction(() => Boolean((window as any).__boardProbe?.api));
  await page.getByRole('button', { name: 'Add note', exact: true }).click();
  await expect(page.locator('[data-board-card]')).toContainText('Início');
  const note = await page.evaluate(async () => (await fetch('/api/note?path=Index.md')).json());
  const original = await page.evaluate(() => (window as any).__boardProbe.api.getSceneElements()[0]);
  const box = (await page.locator('[data-board-card]').boundingBox())!;
  await page.mouse.click(box.x + box.width, box.y + 70);
  await page.mouse.move(box.x + box.width + 6, box.y + box.height + 4); await page.mouse.down(); await page.mouse.move(box.x + box.width + 86, box.y + box.height + 44, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => (window as any).__boardProbe.api.getSceneElements()[0].width)).toBeGreaterThan(original.width + 30);
  await page.keyboard.press('Control+d');
  await expect.poll(() => page.evaluate(() => (window as any).__boardProbe.api.getSceneElements().length)).toBe(2);
  expect(await page.evaluate(() => (window as any).__boardProbe.api.getSceneElements().every((element: any) => element.customData.notesprig.binding.path === 'Index.md'))).toBe(true);
  await page.keyboard.press('Delete');
  await expect.poll(() => page.evaluate(() => (window as any).__boardProbe.api.getSceneElements().length)).toBe(1);
  const remaining = (await page.locator('[data-board-card]').boundingBox())!;
  await page.mouse.click(remaining.x + remaining.width, remaining.y + 70);
  const handle = await page.evaluate(() => { const api = (window as any).__boardProbe.api, element = api.getSceneElements()[0], state = api.getAppState(); return { x: (element.x + element.width / 2 + state.scrollX) * state.zoom.value + state.offsetLeft, y: (element.y + state.scrollY) * state.zoom.value + state.offsetTop - 20 }; });
  await page.mouse.move(handle.x, handle.y); await page.mouse.down(); await page.mouse.move(handle.x + 100, handle.y + 100, { steps: 10 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => Math.abs((window as any).__boardProbe.api.getSceneElements()[0].angle))).toBeGreaterThan(0.1);
  expect(await page.evaluate(() => (window as any).__boardProbe.api.getAppState().frameRendering.clip)).toBe(false);
  const after = await page.evaluate(async () => (await fetch('/api/note?path=Index.md')).json());
  expect(after.hash).toBe(note.hash); expect(after.content).toBe(note.content);
  await expect(page.locator('iframe')).toHaveCount(0);
});

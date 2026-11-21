import { test, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
// @ts-ignore Native server module.
import { Vault } from '../server/vault.mjs';
// @ts-ignore Native compatibility module.
import { environment, legacy } from '../server/legacy.mjs';
import { LEGACY_DATABASE, legacyBrowserPrefix, PRIVATE_MIGRATION } from '../src/legacy';
const exec = promisify(execFile);

test('NoteSprig identity appears on login, page title, and PWA manifest', async ({ page }) => {
  await page.goto('/'); await expect(page).toHaveTitle('NoteSprig'); await expect(page.getByRole('heading', { name: 'NoteSprig', exact: true })).toBeVisible();
  const manifest = await (await page.request.get('/manifest.webmanifest')).json(); expect(manifest.name).toBe('NoteSprig'); expect(manifest.short_name).toBe('NoteSprig');
});

test('legacy metadata migration preserves settings and history', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-migration-'));
  try {
    const before = new Vault(root); await before.initialize(); const original = await before.create('Pasta/Nota.md', '# Original'); await before.update('Pasta/Nota.md', '# Editada', original.hash); await before.settings({ dailyFolder: 'Diário', attachmentFolder: 'Anexos' });
    const versions = await before.versions('Pasta/Nota.md'); await rename(path.join(root, '.notesprig'), path.join(root, legacy.metadataDirectory));
    const after = new Vault(root); await after.initialize();
    expect((await after.read('Pasta/Nota.md')).content).toBe('# Editada'); expect(await after.settings()).toEqual({ dailyFolder: 'Diário', attachmentFolder: 'Anexos' }); expect(await after.versions('Pasta/Nota.md')).toEqual(versions);
    expect(await readdir(root)).not.toContain(legacy.metadataDirectory); await after.initialize(); expect(await after.settings()).toHaveProperty('dailyFolder', 'Diário');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('conflicting metadata directories require review without overwriting either copy', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'notesprig-migration-conflict-'));
  try {
    const vault = new Vault(root); await vault.initialize(); await vault.create('Nota.md', '# Preservar'); await vault.settings({ marker: 'atual' });
    await mkdir(path.join(root, legacy.metadataDirectory)); await writeFile(path.join(root, legacy.metadataDirectory, 'sentinel.txt'), 'anterior');
    await expect(new Vault(root).initialize()).rejects.toThrow('Two metadata directories exist.'); expect(await readFile(path.join(root, legacy.metadataDirectory, 'sentinel.txt'), 'utf8')).toBe('anterior'); expect((await vault.read('Nota.md')).content).toBe('# Preservar'); expect(await vault.settings()).toEqual({ marker: 'atual' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('legacy environment and session cookies remain readable and logout clears both cookies', async ({ request }) => {
  expect(environment('VAULT', { [`${legacy.envPrefix}_VAULT`]: '/anterior' })).toBe('/anterior');
  expect(environment('VAULT', { [`${legacy.envPrefix}_VAULT`]: '/anterior', NOTESPRIG_VAULT: '/atual' })).toBe('/atual');
  const login = await request.post('/api/login', { data: { password: 'test-session-only' } }); expect(login.ok()).toBe(true);
  const value = login.headers()['set-cookie'].split(';')[0].slice('notesprig_session='.length);
  const cookie = `${legacy.sessionCookie}=${value}`; expect((await request.get('/api/files', { headers: { Cookie: cookie } })).status()).toBe(200);
  const logout = await request.post('/api/logout', { headers: { Cookie: cookie, 'Content-Type': 'application/json' } }); expect(logout.ok()).toBe(true);
  const removed = logout.headersArray().filter((header) => header.name.toLowerCase() === 'set-cookie').map((header) => header.value);
  expect(removed.some((value) => value.startsWith('notesprig_session=') && value.includes('Max-Age=0'))).toBe(true); expect(removed.some((value) => value.startsWith(`${legacy.sessionCookie}=`) && value.includes('Max-Age=0'))).toBe(true);
});

test('legacy backup format restores using the legacy password variable', async () => {
  const work = await mkdtemp(path.join(os.tmpdir(), 'notesprig-legacy-backup-')), root = path.join(work, 'vault'), target = path.join(work, 'restore'), backup = path.join(work, 'fixture.obak');
  const env = { ...process.env, [`${legacy.envPrefix}_BACKUP_PASSWORD`]: 'synthetic-legacy-backup-password' }; delete env.NOTESPRIG_BACKUP_PASSWORD;
  try {
    const vault = new Vault(root); await vault.initialize(); await vault.create('Nota.md', '# Dados preservados');
    await exec(process.execPath, ['scripts/backup.mjs', 'create', '--vault', root, '--output', backup], { env });
    const bytes = await readFile(backup); expect(bytes.subarray(0, 8).toString()).toBe('NSPRIG01'); Buffer.from(legacy.backupMagic).copy(bytes, 0); await writeFile(backup, bytes);
    await exec(process.execPath, ['scripts/backup.mjs', 'restore', '--input', backup, '--vault', target], { env }); expect(await readFile(path.join(target, 'Nota.md'), 'utf8')).toBe('# Dados preservados');
  } finally { await rm(work, { recursive: true, force: true }); }
});

for (const hasCurrent of [false, true]) test(`unscoped legacy drafts remain quarantined ${hasCurrent ? 'without replacing a newer draft' : 'across reload'} until explicit recovery`, async ({ page }) => {
  const folder = `Migração-${randomUUID().slice(0, 8)}`, file = `${folder}/Nota.md`;
  const recoveredPaths:string[]=[];
  await page.request.post('/api/login', { data: { password: 'test-session-only' } });
  const created = await page.request.post('/api/note', { data: { path: file, content: '# Servidor' } }); const note = await created.json(); expect(created.ok()).toBe(true);
  const expected = hasCurrent ? '# Rascunho mais recente' : '# Rascunho anterior recuperado';
  try {
    await page.goto('/icon.svg');
    await page.evaluate(async ({ database, prefix, note, hasCurrent }) => {
      const seed = (name: string, content: string) => new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name, 1); open.onupgradeneeded = () => open.result.createObjectStore('state'); open.onerror = () => reject(open.error);
        open.onsuccess = () => { const db = open.result, tx = db.transaction('state', 'readwrite'), store = tx.objectStore('state'); store.put({ ...note, content, dirty: true }, `doc:${note.path}`); store.put([note], 'notes'); store.put([note], 'files'); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error); };
      });
      await seed(database, '# Rascunho anterior recuperado'); if (hasCurrent) await seed('notesprig-private', '# Rascunho mais recente');
      localStorage.setItem(`${prefix}.theme`, 'light'); localStorage.setItem(`${prefix}.bookmarks`, JSON.stringify([note.path]));
      localStorage.setItem(`${prefix}.workspace`, JSON.stringify({ tabs: [{ id: `note:${note.path}`, kind: 'note', path: note.path }], selected: `note:${note.path}`, split: 'right', modes: {} }));
      if (hasCurrent) localStorage.setItem('notesprig.theme', 'dark');
    }, { database: LEGACY_DATABASE, prefix: legacyBrowserPrefix, note, hasCurrent });
    await page.goto('/'); await expect(page).toHaveTitle('NoteSprig');
    const recovery=page.getByRole('dialog',{name:'Recuperação privada',exact:true});
    await expect(recovery).toBeVisible();
    expect((await(await page.request.get('/api/note?path='+encodeURIComponent(file))).json()).content).toBe('# Servidor');
    expect(await page.evaluate(async(file)=>new Promise((resolve,reject)=>{const open=indexedDB.open('notesprig-private');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result,store=db.transaction('state').objectStore('state'),draft=store.get('quarantine:doc:'+file);draft.onsuccess=()=>{db.close();resolve(draft.result?.content);};};}),file)).toBe(expected);
    expect(await page.evaluate(() => localStorage.getItem('notesprig.theme'))).toBe(hasCurrent ? 'dark' : 'light');
    // Compatibility keeps the old preference bytes; scoped private UI does not silently adopt their paths.
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('notesprig.bookmarks') || '[]'))).toContain(file);
    expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('notesprig.workspace')||'{}').tabs[0].path)).toBe(file);
    await expect(page.getByRole('tab',{name:'Nota',exact:true})).toHaveCount(0);
    await page.reload(); await expect(recovery).toBeVisible();
    expect((await(await page.request.get('/api/note?path='+encodeURIComponent(file))).json()).content).toBe('# Servidor');
    const exported=page.waitForEvent('download');await recovery.getByRole('button',{name:'Baixar recuperação privada deste dispositivo',exact:true}).click();
    const downloaded=await(await exported).path();expect(downloaded).toBeTruthy();
    const exportedJSON=JSON.parse(await readFile(downloaded!,'utf8'));
    expect(exportedJSON.type).toBe('notesprig-device-recovery');expect(exportedJSON.entries.some(([key,value]:[string,{content?:string}])=>key==='quarantine:doc:'+file&&value.content===expected)).toBe(true);
    if(hasCurrent)expect(exportedJSON.entries.some(([key,value]:[string,{content?:string}])=>key==='quarantine:legacy:doc:'+file&&value.content==='# Rascunho anterior recuperado')).toBe(true);
    await recovery.getByRole('button',{name:'Cancelar',exact:true}).click();
    expect((await(await page.request.get('/api/session')).json()).authenticated).toBe(true);
    await page.getByRole('button',{name:'Sair',exact:true}).click();await expect(recovery).toBeVisible();
    const copies:string[]=[];
    for(let index=0;index<(hasCurrent?2:1);index++){
      const createdCopy=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/note'&&response.request().method()==='POST');
      const recoverButton=recovery.getByRole('button',{name:'Recuperar como nova nota',exact:true}).first();await expect(recoverButton).toBeVisible();await recoverButton.click();
      const copy=await(await createdCopy).json();recoveredPaths.push(copy.path);expect(copy.path).toMatch(/^Recovered\/[^/]+\.md$/);copies.push(copy.content);
      await expect(recovery.getByRole('button',{name:'Recuperar como nova nota',exact:true})).toHaveCount((hasCurrent?2:1)-index-1);
    }
    expect(copies).toContain(expected);if(hasCurrent)expect(copies).toContain('# Rascunho anterior recuperado');
    expect((await(await page.request.get('/api/note?path='+encodeURIComponent(file))).json()).content).toBe('# Servidor');
    const discard=recovery.getByRole('button',{name:'Descartar alterações pendentes e sair',exact:true});await expect(discard).toBeDisabled();
    await recovery.getByRole('checkbox',{name:'Verifiquei o arquivo de recuperação ou escolho descartar estas alterações.',exact:true}).check();await discard.click();
    await expect(page.getByRole('heading', { name: 'NoteSprig', exact: true })).toBeVisible();
    const cacheState = await page.evaluate(async ({ database, migration }) => {
      const read = (name: string) => new Promise<unknown[]>((resolve) => { const open = indexedDB.open(name); open.onsuccess = () => { const db = open.result, request = db.transaction('state').objectStore('state').getAll(); request.onsuccess = () => { db.close(); resolve(request.result); }; }; });
      return { old: await read(database), current: await read('notesprig-private'), marker: migration };
    }, { database: LEGACY_DATABASE, migration: PRIVATE_MIGRATION });
    expect(cacheState.old).toEqual([]); expect(cacheState.current).toContain(true); expect(cacheState.current.some((value) => value && typeof value === 'object' && 'content' in value)).toBe(false);
  } finally { await page.request.post('/api/login', { data: { password: 'test-session-only' } }); await page.request.delete('/api/note?path=' + encodeURIComponent(folder), { headers: { 'Content-Type': 'application/json' } });for(const recoveredPath of recoveredPaths)await page.request.delete('/api/note?path='+encodeURIComponent(recoveredPath),{ headers: { 'Content-Type': 'application/json' } }); }
});

test('PWA migrates cached attachments and reloads offline with the current identity', async ({ page, context }) => {
  await page.request.post('/api/login', { data: { password: 'test-session-only' } }); await page.goto('/icon.svg');
  const attachment = '/api/attachment?path=legacy-cache-fixture.png';
  await page.evaluate(async ({ prefix, attachment }) => {
    const shell = await caches.open(`${prefix}-shell-fixture`); await shell.put('/index.html', new Response('<html><title>Previous shell</title></html>', { headers: { 'Content-Type': 'text/html' } }));
    const media = await caches.open(`${prefix}-media-v1`); await media.put(attachment, new Response('cached legacy attachment', { headers: { 'Content-Type': 'application/octet-stream' } }));
  }, { prefix: legacyBrowserPrefix, attachment });
  await page.goto('/'); await expect(page.getByRole('region', { name: 'Grafo global', exact: true })).toBeVisible();
  // Public old shell chunks can remain while an older client is open. Private legacy media migrates and is removed.
  await expect.poll(() => page.evaluate(async (prefix) => { const keys = await caches.keys(); return Boolean(navigator.serviceWorker.controller) && keys.includes('notesprig-media-v1') && !keys.includes(`${prefix}-media-v1`); }, legacyBrowserPrefix)).toBe(true);
  expect(await page.evaluate(async (url) => (await (await caches.open('notesprig-media-v1')).match(url))?.text(), attachment)).toBe('cached legacy attachment');
  try {
    await context.setOffline(true);
    expect(await page.evaluate(async (url) => (await fetch(url)).text(), attachment)).toBe('cached legacy attachment');
    await page.reload(); await expect(page).toHaveTitle('NoteSprig'); await expect(page.locator('.titlebar')).toContainText('NoteSprig');
  } finally { await context.setOffline(false); }
});

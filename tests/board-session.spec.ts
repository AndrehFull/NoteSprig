import { test, expect } from '@playwright/test';
import type { ViteDevServer } from 'vite';
let server:ViteDevServer;
const origin='http://127.0.0.1:4315';
const current={vaultId:'11111111-1111-4111-8111-111111111111',restoreGeneration:'22222222-2222-4222-8222-222222222222',epoch:'33333333-3333-4333-8333-333333333333'};
const other={...current,vaultId:'99999999-9999-4999-8999-999999999999'};
test.beforeAll(async()=>{const {createServer}=await import('vite');const {default:react}=await import('@vitejs/plugin-react');server=await createServer({configFile:false,plugins:[react()],server:{host:'127.0.0.1',port:4315,strictPort:true}});await server.listen();});
test.afterAll(async()=>{await server?.close();});
test.beforeEach(async({page})=>{await page.goto(`${origin}/tests/board-draft-probe.html`);await page.waitForFunction(()=>Boolean((window as any).__draftProbe?.docsReady()));});

test('a real IndexedDB abort stores neither the edited scene nor its new image and retains volatile work',async({page})=>{
  await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.open();await p.edit('unsaved image',true);p.failCheckpoint();});
  const error=await page.evaluate(async()=>{try{await(window as any).__draftProbe.checkpoint();return null;}catch(error){return String(error);}});expect(error).not.toBeNull();
  const result=await page.evaluate(async()=>{const p=(window as any).__draftProbe;return{entries:await p.entries(),state:p.state,events:p.events,assets:await p.cache(),aborts:p.aborts};});
  expect(result.aborts).toBe(1);expect(result.state.draft.dirty).toBe(true);expect(result.state.status).toBe('error');expect(result.events).not.toContain('device');
  expect(result.entries.some(([key]:[string,unknown])=>key.includes(':asset:'))).toBe(false);expect(result.entries.find(([key]:[string,unknown])=>key.endsWith(':draft'))[1].board.extensions.label).toBeUndefined();expect(Object.keys(result.assets)).toHaveLength(1);
});

test('edits made while an image upload is paused remain dirty until their own acknowledgement',async({page})=>{
  await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.open();await p.edit('first',true);p.online(true);p.holdUpload();p.startSave();});
  await expect.poll(()=>page.evaluate(()=>(window as any).__draftProbe.uploads.length)).toBe(1);
  await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.edit('second');p.holdSave();p.releaseUpload();});
  await expect.poll(()=>page.evaluate(()=>(window as any).__draftProbe.saves.length)).toBe(1);
  expect(await page.evaluate(()=>(window as any).__draftProbe.state.draft.dirty)).toBe(true);
  await page.evaluate(()=>(window as any).__draftProbe.releaseSave());expect(await page.evaluate(()=>(window as any).__draftProbe.awaitSave())).toBe(true);
  const result=await page.evaluate(async()=>{const p=(window as any).__draftProbe;return{state:p.state,saves:p.saves,remote:p.remote,pending:await p.pending()};});
  expect(result.saves.map((save:any)=>save.board.extensions.label)).toEqual(['first','second']);expect(result.saves[1].baseHash).toBe('server-1');expect(result.state.draft.dirty).toBe(false);expect(result.remote.board.extensions.label).toBe('second');expect(result.pending).toEqual([]);
});

test('lost acknowledgement keeps the exact draft and retry uses the same fingerprint',async({page})=>{
  await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.open();await p.edit('lost ack');p.online(true);p.fail('after');});
  expect(await page.evaluate(()=>(window as any).__draftProbe.save())).toBe(false);
  const before=await page.evaluate(()=>(window as any).__draftProbe.state);expect(before.draft.dirty).toBe(true);expect(before.draft.hash).toBe('server-original');
  expect(await page.evaluate(()=>(window as any).__draftProbe.save())).toBe(true);
  const result=await page.evaluate(()=>{const p=(window as any).__draftProbe;return{state:p.state,saves:p.saves,remote:p.remote};});expect(result.saves[0].board).toEqual(result.saves[1].board);expect(result.state.draft.dirty).toBe(false);expect(result.state.draft.hash).toBe(result.remote.hash);
});

test('legacy unscoped dirty drafts are quarantined and all workspace scopes block cache discard',async({page})=>{
  const result=await page.evaluate(async({current,other})=>{const p=(window as any).__draftProbe;await p.set('doc:Legacy.md',{path:'Legacy.md',content:'# old',dirty:true});await p.set('doc:Clean.md',{path:'Clean.md',dirty:false});await p.set(`workspace:${p.scope(other)}:board:foreign:draft`,{dirty:true,pending:true,board:{boardId:'foreign'}});await p.bootstrap(current);return{entries:await p.entries(),pending:await p.pending()};},{current,other});
  expect(result.entries.some(([key]:[string,unknown])=>key==='doc:Legacy.md'||key==='doc:Clean.md')).toBe(false);expect(result.pending.map(([key]:[string,unknown])=>key)).toEqual(expect.arrayContaining(['quarantine:doc:Legacy.md',`workspace:${other.vaultId}:${other.restoreGeneration}:board:foreign:draft`]));
});

test('an old session checkpoint never writes its path index into a new workspace',async({page})=>{
  const result=await page.evaluate(async({other})=>{const p=(window as any).__draftProbe;await p.open();await p.edit('old scope');await p.bootstrap(other);await p.checkpoint();return{entries:await p.entries(),scope:p.scope(other)};},{other});
  expect(result.entries.some(([key]:[string,unknown])=>key===`workspace:${result.scope}:board-path:Board.board`)).toBe(false);
});

test('disposing sessions cancels pending autosave and blocks late acknowledgements from repopulating private cache',async({page})=>{
  await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.open();await p.edit('pending');p.online(true);p.holdSave();p.startSave();});await expect.poll(()=>page.evaluate(()=>(window as any).__draftProbe.saves.length)).toBe(1);
  await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.clearSessions();await p.batch({},(await p.entries()).map(([key]:[string,unknown])=>key));p.releaseSave();});
  await page.evaluate(async()=>{try{await(window as any).__draftProbe.awaitSave();}catch{}});await page.waitForTimeout(700);
  expect(await page.evaluate(()=>(window as any).__draftProbe.entries())).toEqual([]);
});

test('a guarded card read cannot fall back to an unguarded cached note while offline',async({page})=>{
  await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.loadNote();p.noteFailure();});
  const result=await page.evaluate(async(context)=>{try{await(window as any).__draftProbe.loadNote(context);return{accepted:true};}catch(error){return{accepted:false,error:String(error)};}},current);expect(result.accepted).toBe(false);
});

test('a dirty ordinary note cannot acquire a card reference context without verifying correspondence',async({page})=>{
  await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.loadNote();p.editNote('# local edits');p.noteFailure(409);});
  const result=await page.evaluate(async(context)=>{try{await(window as any).__draftProbe.loadNote(context);return{accepted:true};}catch(error){return{accepted:false,error:String(error)};}},current);expect(result.accepted).toBe(false);
});

test('synchronous structured-clone failure aborts earlier writes in the same real IDB batch',async({page})=>{
  const result=await page.evaluate(async()=>{const p=(window as any).__draftProbe;let error;try{await p.batch({'before-clone-error':{scene:'new'},'uncloneable':()=>{}});}catch(caught){error=String(caught);}return{error,stored:await p.get('before-clone-error')};});
  expect(result.error).toContain('DataCloneError');expect(result.stored).toBeUndefined();
});

test('failed first checkpoint returns false and volatile recovery includes bytes absent from IDB',async({page})=>{
  const result=await page.evaluate(async()=>{const p=(window as any).__draftProbe;await p.open();await p.edit('not stored',true);p.online(true);p.failCheckpoint();const saved=await p.save();p.online(false);return{saved,dirty:p.dirty(),state:p.state,volatile:p.volatile(),persisted:await p.pending(),saves:p.saves};});
  expect(result.saved).toBe(false);expect(result.dirty).toBe(true);expect(result.state.status).toBe('error');expect(result.persisted).toEqual([]);expect(result.saves).toEqual([]);expect(result.volatile[0].draft.board.extensions.label).toBe('not stored');expect(Object.values(result.volatile[0].assets)).toEqual([{base64:'AQIDBA=='}]);
});

test('board checkpoints request strict browser durability when supported',async({page})=>{
  const options=await page.evaluate(async()=>{const p=(window as any).__draftProbe,original=IDBDatabase.prototype.transaction;const seen:any[]=[];IDBDatabase.prototype.transaction=function(...args:any[]){if(args[1]==='readwrite')seen.push(args[2]);return original.apply(this,args as any);};try{await p.batch({'strict-proof':true});return seen;}finally{IDBDatabase.prototype.transaction=original;}});
  expect(options).toContainEqual({durability:'strict'});
});

test('guarded note reconciliation keeps its original reference context and content after path reuse',async({page})=>{
  const result=await page.evaluate(async(context)=>{const p=(window as any).__draftProbe;p.online(true);p.connected();await p.loadNote(context);p.noteFailure(409);await p.reconcile();return{reads:p.reads(),notes:p.noteState(),errors:p.errors};},current);
  expect(result.reads).toHaveLength(2);expect(result.reads[1].context).toEqual(current);expect(result.notes['A.md'].content).toBe('# original');expect(result.notes['A.md'].referenceContext).toEqual(current);expect(result.errors).toHaveLength(1);
});

test('workspace activation retires hook memory and clears old media caches while preserving old drafts',async({page})=>{
  const result=await page.evaluate(async(other)=>{const p=(window as any).__draftProbe;await p.loadNote();p.editNote('# private local edit');const key=p.key('doc:A.md');await p.set(key,p.noteState()['A.md']);await caches.open('notesprig-media-v1');await caches.open(p.legacyMedia);await p.bootstrap(other);p.activate();return{notes:p.noteState(),old:await p.get(key),caches:await caches.keys(),pending:await p.pending()};},other);
  expect(result.notes).toEqual({});expect(result.old.content).toBe('# private local edit');expect(result.old.workspaceContext).toEqual(current);expect(result.caches).not.toContain('notesprig-media-v1');expect(result.pending).toHaveLength(1);
});

test('dirty cached board ownership is validated before any server hydration can overwrite it',async({page})=>{
  const result=await page.evaluate(async(other)=>{const p=(window as any).__draftProbe;await p.open();await p.edit('foreign recovery');await p.checkpoint();const entries=await p.entries(),[key,draft]=entries.find(([key]:[string,unknown])=>key.endsWith(':draft'));draft.workspaceContext=other;await p.set(key,draft);await p.clearSessions();let error;try{await p.open();}catch(caught){error=String(caught);}return{error,persisted:await p.get(key)};},other);
  expect(result.error).toContain('different workspace');expect(result.persisted.board.extensions.label).toBe('foreign recovery');expect(result.persisted.dirty).toBe(true);
});

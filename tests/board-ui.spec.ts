import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createBoard } from '../shared/board-schema.mjs';

test('New Canvas creates an Excalidraw board that persists note cards and opens a guarded side editor', async({page})=>{
  test.setTimeout(90000);
  await page.request.post('/api/login',{data:{password:'test-session-only'}});
  await page.goto('/');
  const name=`Board-${randomUUID().slice(0,8)}`;
  try {
  await page.getByRole('button',{name:'Novo Canvas',exact:true}).click();
  await page.getByRole('textbox',{name:'Nome do Canvas',exact:true}).fill(name);
  await page.getByRole('textbox',{name:'Nome do Canvas',exact:true}).press('Enter');
  const region=page.getByRole('region',{name:'Canvas',exact:true});
  await expect(region).toBeVisible();
  await page.getByRole('combobox',{name:'Escolha uma nota',exact:true}).selectOption('Index.md');
  await page.getByRole('button',{name:'Adicionar',exact:true}).click();
  await expect(page.locator('[data-board-card]')).toContainText('Início');
  await expect.poll(async()=>{const response=await page.request.get(`/api/note?path=${encodeURIComponent(name+'.board')}`);if(!response.ok())return 0;return JSON.parse((await response.json()).content).scene.elements.filter((e:any)=>!e.isDeleted&&e.customData?.notesprig).length;}).toBe(1);
  await page.reload();
  await expect(page.locator('[data-board-card]')).toContainText('Início');
  await page.locator('.board-note-list summary').click();
  await page.locator('.board-note-list').getByRole('button',{name:'Abrir nota',exact:true}).click();
  await expect(page.locator('.cm-content')).toContainText('Início');
  await expect(region).toBeVisible();
  const context=await(await page.request.get('/api/boards/context')).json();
  await page.request.post('/api/note/rename',{data:{oldPath:'Órfã.md',newPath:`Orphan-${name}.md`}});
  const note=await(await page.request.get('/api/note?path=Index.md')).json();
  const rejected=await page.request.put('/api/note',{data:{path:'Index.md',content:note.content,baseHash:note.hash,referenceContext:context}});
  expect(rejected.status()).toBe(409);
  } finally {
    await page.request.post('/api/note/rename',{data:{oldPath:`Orphan-${name}.md`,newPath:'Órfã.md'}});
    await page.request.delete(`/api/note?path=${encodeURIComponent(name+'.board')}`,{headers:{'Content-Type':'application/json'}});
  }
});

test('legacy .canvas files stay editable and convert to a new Canvas copy without changing the original', async({page})=>{
  test.setTimeout(60000);
  await page.request.post('/api/login',{data:{password:'test-session-only'}});
  const name=`Legacy-${randomUUID().slice(0,8)}`, source=JSON.stringify({nodes:[{id:'n',type:'text',x:0,y:0,width:200,height:80,text:'Legacy card'}],edges:[]});
  await page.request.post('/api/note',{data:{path:name+'.canvas',content:source}});
  try {
    await page.goto('/');
    await page.locator(`button.tree-file[title="${name}.canvas"]`).click();
    await expect(page.getByText('Este arquivo usa o formato antigo de Canvas.',{exact:false})).toBeVisible();
    await page.getByRole('button',{name:'Converter para o novo Canvas',exact:true}).click();
    await expect(page.getByRole('region',{name:'Canvas',exact:true})).toBeVisible();
    const board=await page.request.get(`/api/note?path=${encodeURIComponent(name+'.board')}`);expect(board.ok()).toBe(true);
    expect(JSON.parse((await board.json()).content).extensions.canvasSource).toBe(source);
    expect((await(await page.request.get(`/api/note?path=${encodeURIComponent(name+'.canvas')}`)).json()).content).toBe(source);
  } finally {
    for(const path of [name+'.canvas',name+'.board'])await page.request.delete(`/api/note?path=${encodeURIComponent(path)}`,{headers:{'Content-Type':'application/json'}});
  }
});

test('https web embeds render in a sandboxed iframe and are saved with the Canvas', async({page})=>{
  test.setTimeout(60000);
  await page.request.post('/api/login',{data:{password:'test-session-only'}});
  const name=`Embed-${randomUUID().slice(0,8)}`, path=name+'.board', url='https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const context=await(await page.request.get('/api/boards/context')).json();
  const board=createBoard(context);
  board.scene.elements=[{id:'web',type:'embeddable',x:40,y:40,width:480,height:270,angle:0,link:url} as any];
  expect((await page.request.post('/api/boards',{data:{path,board,context}})).ok()).toBe(true);
  await page.route(/youtube/, route=>route.fulfill({status:200,contentType:'text/html',body:'<p>stub</p>'}));
  try {
    await page.goto('/');
    await page.locator(`button.tree-file[title="${path}"]`).click();
    const frame=page.locator('.excalidraw iframe');
    await expect(frame).toHaveCount(1);
    await expect(frame).toHaveAttribute('src',/youtube/);
    await expect(frame).toHaveAttribute('sandbox',/allow-scripts/);
    expect(page.getByText('Embedding this url is currently not allowed',{exact:false})).toHaveCount(0);
  } finally {
    await page.request.delete(`/api/note?path=${encodeURIComponent(path)}`,{headers:{'Content-Type':'application/json'}});
  }
});

test('a bare domain typed into Web Embed is treated as https instead of a relative URL', async({page})=>{
  test.setTimeout(60000);
  await page.request.post('/api/login',{data:{password:'test-session-only'}});
  const name=`Bare-${randomUUID().slice(0,8)}`, path=name+'.board';
  const context=await(await page.request.get('/api/boards/context')).json();
  const board=createBoard(context);
  board.scene.elements=[{id:'web',type:'embeddable',x:40,y:40,width:480,height:270,angle:0,link:'example.com'} as any];
  expect((await page.request.post('/api/boards',{data:{path,board,context}})).ok()).toBe(true);
  await page.route(/example\.com/, route=>route.fulfill({status:200,contentType:'text/html',body:'<p>stub</p>'}));
  try {
    await page.goto('/');
    await page.locator(`button.tree-file[title="${path}"]`).click();
    await expect(page.locator('.excalidraw iframe')).toHaveAttribute('src','https://example.com/');
  } finally {
    await page.request.delete(`/api/note?path=${encodeURIComponent(path)}`,{headers:{'Content-Type':'application/json'}});
  }
});

test('typing a bare domain into the Web Embed tool neither freezes nor shows the upstream rejection toast', async({page})=>{
  test.setTimeout(90000);
  await page.request.post('/api/login',{data:{password:'test-session-only'}});
  await page.addInitScript(()=>localStorage.setItem('notesprig.language','en'));
  await page.route(/google\.com/, route=>route.fulfill({status:200,contentType:'text/html',body:'<p>stub</p>'}));
  const name=`Typed-${randomUUID().slice(0,8)}`;
  try {
    await page.goto('/');
    await page.getByRole('button',{name:'New Canvas',exact:true}).first().click();
    await page.getByRole('textbox',{name:'Canvas name',exact:true}).fill(name);
    await page.getByRole('textbox',{name:'Canvas name',exact:true}).press('Enter');
    const canvas=page.locator('.excalidraw__canvas.interactive'); await canvas.waitFor();
    const box=(await canvas.boundingBox())!;
    await page.locator('.App-toolbar .dropdown-menu-button').click();
    await page.getByText('Web Embed',{exact:false}).first().click();
    await page.mouse.move(box.x+260,box.y+120); await page.mouse.down(); await page.mouse.move(box.x+520,box.y+240,{steps:6}); await page.mouse.up();
    const input=page.locator('.excalidraw-hyperlinkContainer-input');
    // The engine validates every keystroke ("g", "go", ...); each must be accepted without a toast or a rewrite loop.
    await input.pressSequentially('google.com',{delay:30,timeout:15000});
    await expect(page.locator('.Toast')).toHaveCount(0);
    await input.press('Enter');
    await expect(page.locator('.excalidraw iframe')).toHaveAttribute('src','https://google.com/');
    await expect(page.locator('.Toast')).toHaveCount(0);
    expect(await page.evaluate(()=>1+1)).toBe(2);
  } finally {
    await page.request.delete(`/api/note?path=${encodeURIComponent(name+'.board')}`,{headers:{'Content-Type':'application/json'}});
  }
});

test('clipboard: links paste into the link editor and onto the canvas, while other content stays guarded', async({page,context})=>{
  test.setTimeout(90000);
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  await page.request.post('/api/login',{data:{password:'test-session-only'}});
  await page.addInitScript(()=>localStorage.setItem('notesprig.language','en'));
  await page.route(/wikipedia\.org/, route=>route.fulfill({status:200,contentType:'text/html',body:'<p>stub</p>'}));
  const name=`Paste-${randomUUID().slice(0,8)}`, path=name+'.board';
  const clip=(text:string)=>page.evaluate(value=>navigator.clipboard.writeText(value),text);
  const elements=async()=>page.evaluate(()=>document.querySelectorAll('.excalidraw iframe, [data-board-web-embed]').length);
  try {
    await page.goto('/');
    await page.getByRole('button',{name:'New Canvas',exact:true}).first().click();
    await page.getByRole('textbox',{name:'Canvas name',exact:true}).fill(name);
    await page.getByRole('textbox',{name:'Canvas name',exact:true}).press('Enter');
    const canvas=page.locator('.excalidraw__canvas.interactive'); await canvas.waitFor();
    const box=(await canvas.boundingBox())!;
    // 1. Paste into the Web Embed link editor.
    await page.locator('.App-toolbar .dropdown-menu-button').click();
    await page.getByText('Web Embed',{exact:false}).first().click();
    await page.mouse.move(box.x+260,box.y+120); await page.mouse.down(); await page.mouse.move(box.x+520,box.y+240,{steps:6}); await page.mouse.up();
    const input=page.locator('.excalidraw-hyperlinkContainer-input'); await input.waitFor();
    await clip('https://pt.wikipedia.org/wiki/Brasil');
    await input.press('Control+v');
    await expect(input).toHaveValue('https://pt.wikipedia.org/wiki/Brasil');
    await input.press('Enter');
    await expect(page.locator('.excalidraw iframe[src="https://pt.wikipedia.org/wiki/Brasil"]')).toHaveCount(1);
    await expect(page.locator('.Toast')).toHaveCount(0);
    // 2. Paste a link directly onto the canvas: it becomes an embed.
    await page.mouse.click(box.x+600,box.y+500);
    await clip('https://en.wikipedia.org/wiki/Note-taking');
    await page.keyboard.press('Control+v');
    await expect(page.locator('.excalidraw iframe[src="https://en.wikipedia.org/wiki/Note-taking"]')).toHaveCount(1);
    // 3. Other text pasted onto the canvas is still guarded.
    const before=await elements();
    await page.mouse.click(box.x+600,box.y+560);
    await clip('plain words are not imported');
    await page.keyboard.press('Control+v');
    await expect(page.getByText('Use the NoteSprig toolbar to import files.',{exact:false}).first()).toBeVisible();
    expect(await elements()).toBe(before);
    const saved=async()=>JSON.parse((await(await page.request.get(`/api/note?path=${encodeURIComponent(path)}`)).json()).content).scene.elements.filter((e:any)=>!e.isDeleted&&e.type==='text').length;
    await page.getByRole('button',{name:'Save',exact:true}).click();
    await expect.poll(saved).toBe(0);
  } finally {
    await page.request.delete(`/api/note?path=${encodeURIComponent(path)}`,{headers:{'Content-Type':'application/json'}});
  }
});

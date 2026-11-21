import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

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

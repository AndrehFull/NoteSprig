import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test.use({ serviceWorkers: 'block' });
// Slow networks (and cold CI runners) load the drawing engine after the board UI renders.
test('a slowly loading drawing engine keeps Add disabled instead of dropping the click', async({page})=>{
  test.setTimeout(60000);
  await page.request.post('/api/login',{data:{password:'test-session-only'}});
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.route(/\.(js|woff2)(\?|$)/, async route=>{ await new Promise(r=>setTimeout(r,3000)); await route.continue(); });
  const name=`Slow-${randomUUID().slice(0,8)}`;
  try {
    await page.getByRole('button',{name:'Novo Canvas',exact:true}).first().click();
    await page.getByRole('textbox',{name:'Nome do Canvas',exact:true}).fill(name);
    await page.getByRole('textbox',{name:'Nome do Canvas',exact:true}).press('Enter');
    await page.getByRole('combobox',{name:'Escolha uma nota',exact:true}).selectOption('Index.md');
    const add=page.getByRole('button',{name:'Adicionar',exact:true});
    await add.click();
    await expect(page.locator('[data-board-card]')).toContainText('Início',{timeout:20000});
  } finally { await page.request.delete(`/api/note?path=${encodeURIComponent(name+'.board')}`,{headers:{'Content-Type':'application/json'}}); }
});

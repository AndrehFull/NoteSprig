import {test,expect} from '@playwright/test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
// @ts-ignore Server module is intentionally exercised in a separate process.
import {BoardTransactions} from '../server/board-transactions.mjs';

for(const point of ['before-commit','after-commit','after-apply','before-cleanup','after-cleanup','before-ack'])test(`SIGKILL at ${point} recovers one complete transaction decision`,async()=>{
  test.skip(process.platform==='win32','This crash proof uses POSIX SIGKILL.');
  const root=await mkdtemp(path.join(os.tmpdir(),'notesprig-real-crash-'));
  try {
    await writeFile(path.join(root,'A.md'),'old A');await writeFile(path.join(root,'B.md'),'old B');
    const module=pathToFileURL(path.resolve('server/board-transactions.mjs')).href;
    const source=`import {BoardTransactions} from ${JSON.stringify(module)};const tx=await new BoardTransactions(process.argv[1],{fault:async event=>{if(event===process.argv[2])process.kill(process.pid,'SIGKILL');}}).initialize();await tx.run({writes:[{path:'A.md',content:'new A'},{path:'C.md',content:'new C'}],deletes:['B.md']});`;
    const child=spawn(process.execPath,['--input-type=module','-e',source,root,point],{stdio:['ignore','pipe','pipe']});
    let errors='';child.stderr.on('data',chunk=>errors+=chunk);
    const exited=await new Promise<{code:number|null;signal:NodeJS.Signals|null}>((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
    expect(errors).toBe('');expect(exited.signal).toBe('SIGKILL');
    const tx=await new BoardTransactions(root).initialize();
    await tx.read(async()=>{
      expect(await readFile(path.join(root,'A.md'),'utf8')).toBe(point==='before-commit'?'old A':'new A');
      if(point==='before-commit'){expect(await readFile(path.join(root,'B.md'),'utf8')).toBe('old B');await expect(readFile(path.join(root,'C.md'))).rejects.toMatchObject({code:'ENOENT'});}
      else{expect(await readFile(path.join(root,'C.md'),'utf8')).toBe('new C');await expect(readFile(path.join(root,'B.md'))).rejects.toMatchObject({code:'ENOENT'});}
    });
  } finally {await rm(root,{recursive:true,force:true});}
});

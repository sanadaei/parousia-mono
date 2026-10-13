import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {resolveStaticPath,createStaticServer} from '../src/ui/server.mjs';
test('preview URL paths cannot expose private directories or Windows alternate paths',()=>{
 const root=path.resolve('/tmp/example');
 for(const name of ['/.git/config','/.env','/%2egit/config','/x/.private/data','/x%5csecret','/file.txt%3a$DATA','/%00','/%ZZ'])assert.equal(resolveStaticPath(root,name),null,name);
 assert.equal(resolveStaticPath(root,'/src/globe/index.html'),path.join(root,'src/globe/index.html'));
});
test('local preview serves normal content and rejects symlink escapes and hidden targets',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'planet-preview-')),root=path.join(dir,'public');await fs.mkdir(root);
 await fs.writeFile(path.join(root,'page.html'),'hello');await fs.writeFile(path.join(root,'.private'),'private');await fs.writeFile(path.join(dir,'outside'),'outside');
 let symlinks=true;try{await fs.symlink(path.join(dir,'outside'),path.join(root,'escape'));await fs.symlink(path.join(root,'.private'),path.join(root,'alias'));}catch(e){if(['EPERM','EACCES','ENOSYS'].includes(e.code))symlinks=false;else throw e;}
 const server=createStaticServer({root});await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 try{const page=await fetch(url+'/page.html');assert.equal(page.status,200);assert.equal(await page.text(),'hello');assert.equal(page.headers.get('x-content-type-options'),'nosniff');assert.equal((await fetch(url+'/.private')).status,403);
  if(symlinks)for(const p of ['/escape','/alias'])assert.equal((await fetch(url+p)).status,403);
  assert.equal((await fetch(url+'/page.html',{method:'HEAD'})).status,200);assert.equal((await fetch(url+'/page.html',{method:'POST'})).status,405);
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});

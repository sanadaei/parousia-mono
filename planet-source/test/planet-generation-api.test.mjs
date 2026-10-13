import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createStaticServer} from '../src/ui/server.mjs';import {createPlanetGenerationAPI,seedDirectory} from '../scripts/planet-generation-api.mjs';
test('generation API requires same origin JSON and reuses immutable seed output',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planet-seed-api-')),seed='existing';const dir=path.join(root,seedDirectory(seed));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'manifest.json'),'{}');
 const server=createStaticServer({root,handler:createPlanetGenerationAPI(root)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{assert.equal((await fetch(base+'/api/planet-generation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seed})})).status,403);
 const result=await fetch(base+'/api/planet-generation',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({seed})});const j=await result.json();assert.equal(j.status,'complete');assert.equal(j.reused,true);assert.match(j.url,/manifest.json/);assert.equal(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'),'{}');
 const bad=await fetch(base+'/api/planet-generation',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{"seed":""}'});assert.equal(bad.status,400);
 }finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
test('local tributary UI choice has a separate immutable generation identity',()=>{const plain=seedDirectory('river-ui',32,4,100000000,false),water=seedDirectory('river-ui',32,4,100000000,true);assert.notEqual(plain,water);assert.equal(water,seedDirectory('river-ui',32,4,100000000,true));assert.throws(()=>seedDirectory('river-ui',32,4,100000000,'true'),/boolean/);});
test('generation API validates and reuses the exact local-water choice',async()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'planet-water-api-')),seed='water-existing',dir=path.join(root,seedDirectory(seed,128,8,100000000,true));fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'manifest.json'),'{}');const server=createStaticServer({root,handler:createPlanetGenerationAPI(root)});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`,post=body=>fetch(base+'/api/planet-generation',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});try{const r=await post({seed,localTributaries:true}),j=await r.json();assert.equal(j.status,'complete');assert.equal(j.reused,true);assert.ok(j.url.includes(seedDirectory(seed,128,8,100000000,true)));assert.equal((await post({seed,localTributaries:'yes'})).status,400);}finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}});

test('regional river choice has a separate immutable generation identity',()=>{
 const major=seedDirectory('river-density',128,8,100000000,true,'major');
 const regional=seedDirectory('river-density',128,8,100000000,true,'regional');
 assert.notEqual(major,regional);assert.equal(regional,seedDirectory('river-density',128,8,100000000,true,'regional'));
 assert.throws(()=>seedDirectory('a',128,8,100000000,true,'unknown'),/riverDetail/);
});

test('regional river API choice reuses only its matching saved output and rejects unsupported modes',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planet-regional-river-api-')),seed='regional-existing';
 const relative=seedDirectory(seed,128,8,100000000,false,'regional'),dir=path.join(root,relative);
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'manifest.json'),'{}');
 const server=createStaticServer({root,handler:createPlanetGenerationAPI(root)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 const post=body=>fetch(base+'/api/planet-generation',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{const r=await post({seed,riverDetail:'regional'}),j=await r.json();assert.equal(r.status,200);assert.equal(j.reused,true);assert.ok(j.url.includes(relative));assert.equal((await post({seed,riverDetail:'all'})).status,400);assert.equal(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'),'{}');}
 finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});

test('regional river request is forwarded to the generation child, not just the cache key',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planet-regional-forward-'));
 fs.mkdirSync(path.join(root,'scripts'));
 fs.writeFileSync(path.join(root,'scripts/generate-planet.mjs'),"import fs from 'node:fs';import path from 'node:path';fs.writeFileSync(path.join(process.argv[3],'manifest.json'),JSON.stringify({args:process.argv.slice(2)}));");
 const server=createStaticServer({root,handler:createPlanetGenerationAPI(root)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 try{
  const r=await fetch(base+'/api/planet-generation',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({seed:'forward',riverDetail:'regional',localTributaries:true})});assert.equal(r.status,202);
  let state,deadline=Date.now()+5000;
  do{await new Promise(r=>setTimeout(r,30));state=await(await fetch(base+'/api/planet-generation')).json();}while(state.status==='running'&&Date.now()<deadline);
  assert.equal(state.status,'complete');
  const file=path.join(root,seedDirectory('forward',128,8,100000000,true,'regional'),'manifest.json');
  const args=JSON.parse(fs.readFileSync(file)).args;assert.ok(args.includes('--river-detail=regional'));assert.ok(args.includes('--local-tributaries'));
 }finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});
test('deferred population gets a separate world cache without changing existing worlds',()=>{const a=seedDirectory('population',128,8,3000000000,false,'major','rounded',false),b=seedDirectory('population',128,8,3000000000,false,'major','rounded',true);assert.notEqual(a,b);assert.throws(()=>seedDirectory('population',128,8,3e9,false,'major','rounded','yes'),/boolean/);});

test('water-first policy separates new cache while preserving old cache identity',()=>{
 const args=['population',128,8,3e9,false,'major','rounded',true];
 const old=seedDirectory(...args),water=seedDirectory(...args,true);
 assert.equal(old,seedDirectory(...args,false));assert.notEqual(old,water);
 assert.equal(water,seedDirectory(...args,true));
 assert.throws(()=>seedDirectory(...args,'yes'),/boolean/);
 assert.throws(()=>seedDirectory('population',128,8,3e9,false,'major','rounded',false,true),/requires deferredPopulation/);
});

test('water-first API rejects invalid combinations and forwards both generation flags',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'planet-water-first-forward-'));
 fs.mkdirSync(path.join(root,'scripts'));
 fs.writeFileSync(path.join(root,'scripts/generate-planet.mjs'),"import fs from 'node:fs';import path from 'node:path';fs.writeFileSync(path.join(process.argv[3],'manifest.json'),JSON.stringify({args:process.argv.slice(2)}));");
 const old=path.join(root,seedDirectory('water-first',128,8,1e8,false,'major','rounded',true));
 fs.mkdirSync(old,{recursive:true});fs.writeFileSync(path.join(old,'manifest.json'),'{"old":true}');
 const server=createStaticServer({root,handler:createPlanetGenerationAPI(root)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`,post=body=>fetch(base+'/api/planet-generation',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  assert.equal((await post({seed:'water-first',deferredWater:true})).status,400);
  assert.equal((await post({seed:'water-first',deferredPopulation:true,deferredWater:'yes'})).status,400);
  assert.equal((await post({seed:'water-first',deferredPopulation:true,deferredWater:true})).status,202);
  let state,deadline=Date.now()+5000;
  do{await new Promise(r=>setTimeout(r,30));state=await(await fetch(base+'/api/planet-generation')).json();}while(state.status==='running'&&Date.now()<deadline);
  assert.equal(state.status,'complete');
  const relative=seedDirectory('water-first',128,8,1e8,false,'major','rounded',true,true);
  const args=JSON.parse(fs.readFileSync(path.join(root,relative,'manifest.json'))).args;
  assert.ok(args.includes('--deferred-population'));assert.ok(args.includes('--deferred-water'));
  const reused=await(await post({seed:'water-first',deferredPopulation:true,deferredWater:true})).json();assert.equal(reused.reused,true);assert.ok(reused.url.includes(relative));
  assert.equal((await post({seed:'empty-water',unpopulatedWater:true})).status,400);
  assert.equal((await post({seed:'empty-water',deferredPopulation:true,deferredWater:true,unpopulatedWater:true})).status,202);
  deadline=Date.now()+5000;do{await new Promise(r=>setTimeout(r,30));state=await(await fetch(base+'/api/planet-generation')).json();}while(state.status==='running'&&Date.now()<deadline);assert.equal(state.status,'complete');
  const emptyRelative=seedDirectory('empty-water',128,8,1e8,false,'major','rounded',true,true,true),emptyArgs=JSON.parse(fs.readFileSync(path.join(root,emptyRelative,'manifest.json'))).args;assert.ok(emptyArgs.includes('--unpopulated-water'));assert.ok(emptyArgs.includes('--deferred-water'));
  assert.equal(fs.readFileSync(path.join(old,'manifest.json'),'utf8'),'{"old":true}');
 }finally{await new Promise(r=>server.close(r));fs.rmSync(root,{recursive:true,force:true});}
});

test('generation form keeps water-first opt-in and clears it when deferred villages are disabled',async()=>{
 const {runInNewContext}=await import('node:vm');
 const html=fs.readFileSync(new URL('../src/globe/index.html',import.meta.url),'utf8');
 const input=html.match(/<input\b[^>]*id="deferred-water"[^>]*>/)?.[0];assert.ok(input);assert.doesNotMatch(input,/\bchecked\b/);
 const app=fs.readFileSync(new URL('../src/globe/app.mjs',import.meta.url),'utf8');
 const start=app.indexOf('const syncDeferredWaterChoice='),end=app.indexOf("$('generation-panel').ontoggle",start);assert.ok(start>=0&&end>start);
 const fields={};for(const id of ['deferred-population','deferred-water','unpopulated-water','generate-world','generate-submit','generated-world','world-seed','population-count','site-count','detail-count','local-tributaries','river-detail','landform-shape','generate-status'])fields[id]={checked:false,disabled:false,value:'',addEventListener(type,callback){this[type]=callback;}};
 fields['deferred-population'].checked=true;fields['world-seed'].value='ui';fields['population-count'].value='3000000000';fields['site-count'].value='0';fields['detail-count'].value='0';fields['river-detail'].value='major';fields['landform-shape'].value='rounded';
 let sent;runInNewContext(app.slice(start,end),{$:id=>fields[id],generationPoll:null,clearTimeout(){},pollGeneration:async()=>{},fetch:async(url,options)=>{sent=JSON.parse(options.body);return{ok:true,status:202,json:async()=>({})};}});
 assert.equal(fields['deferred-water'].disabled,false);assert.equal(fields['unpopulated-water'].disabled,true);fields['deferred-water'].checked=true;fields['deferred-water'].change();assert.equal(fields['unpopulated-water'].disabled,false);fields['unpopulated-water'].checked=true;
 await fields['generate-world'].onsubmit({preventDefault(){}});assert.equal(sent.deferredWater,true);assert.equal(sent.deferredPopulation,true);assert.equal(sent.unpopulatedWater,true);
 fields['deferred-population'].checked=false;fields['deferred-population'].change();assert.equal(fields['deferred-water'].disabled,true);assert.equal(fields['deferred-water'].checked,false);
 await fields['generate-world'].onsubmit({preventDefault(){}});assert.equal(sent.deferredWater,false);assert.equal(sent.deferredPopulation,false);assert.equal(sent.unpopulatedWater,false);assert.equal(fields['unpopulated-water'].checked,false);
 fields['deferred-population'].checked=true;fields['deferred-population'].change();assert.equal(fields['deferred-water'].disabled,false);assert.equal(fields['deferred-water'].checked,false);
});

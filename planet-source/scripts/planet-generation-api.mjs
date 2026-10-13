import {SETTLEMENT_RUNTIME_VERSION} from '../src/core/settlement-catalogue.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {requireVerificationMemory} from './verification-runtime.mjs';
export function seedDirectory(seed,sites=128,settlements=8,population=100000000,localTributaries=false,riverDetail='major',landformShape='rounded',deferredPopulation=false,deferredWater=false,unpopulatedWater=false){
 if(typeof seed!=='string'||!seed.trim()||seed.length>128)throw new RangeError('seedは1〜128文字で入力してください');
 if(!Number.isSafeInteger(sites)||sites<0||sites>512||!Number.isSafeInteger(settlements)||settlements<0||settlements>32)throw new RangeError('集落数の範囲が不正です');
 if(!Number.isSafeInteger(population)||population<0||population>1e10)throw new RangeError('人口の範囲が不正です');
 if(!['rounded','stratified'].includes(landformShape))throw new RangeError('landformShape must be rounded or stratified');
 if(!['major','regional'].includes(riverDetail))throw new RangeError('riverDetail must be major or regional');
 if(typeof deferredPopulation!=='boolean')throw new RangeError('deferredPopulation must be boolean');
 if(typeof unpopulatedWater!=='boolean'||(unpopulatedWater&&!deferredWater))throw new RangeError('unpopulatedWater requires deferredWater');
 if(typeof deferredWater!=='boolean')throw new RangeError('deferredWater must be boolean');
 if(deferredWater&&!deferredPopulation)throw new RangeError('deferredWater requires deferredPopulation');
 if(typeof localTributaries!=='boolean')throw new RangeError('localTributaries must be boolean');
 return 'examples/planet/seeds/'+createHash('sha256').update('planet-ui-generator@19-l2-settlement-handoff\0'+SETTLEMENT_RUNTIME_VERSION+'\0'+JSON.stringify([seed,sites,settlements,population,localTributaries,riverDetail,...(landformShape==='rounded'?[]:[landformShape]),...(deferredPopulation?['on-reference-population@1','adjacent-committed-sites@1']:[]),...(deferredWater?[unpopulatedWater?'shared-regional-water-regions@1':'settlement-zone-interior-water@1']:[])])).digest('hex').slice(0,24);
}
export function populationUpgradeRequest(root,pathname){
 if(typeof pathname!=='string'||!pathname.startsWith('/examples/planet/')||!pathname.endsWith('/manifest.json')||pathname.includes('\\')||pathname.includes('\0'))throw new Error('Invalid saved-world path');
 const allowed=fs.realpathSync(path.join(root,'examples/planet')),source=fs.realpathSync(path.resolve(root,'.'+pathname));
 if(!source.startsWith(allowed+path.sep)||fs.statSync(source).size>8*1024*1024)throw new Error('World is outside allowed generated files');
 const metadata=JSON.parse(fs.readFileSync(source,'utf8'));
 if(!metadata.population||typeof metadata.planetSnapshot!=='string')throw new Error('気候・人口データのある世界を先に生成してください');
 const snapshot=fs.realpathSync(path.resolve(path.dirname(source),metadata.planetSnapshot));if(!snapshot.startsWith(allowed+path.sep))throw new Error('Snapshot outside world directory');
 const relative='examples/planet/seeds/'+createHash('sha256').update('settlement-upgrade@3/'+SETTLEMENT_RUNTIME_VERSION+'/'+metadata.canonicalWorldId).digest('hex').slice(0,24);
 return{source,relative,seed:metadata.name??'保存世界'};
}
// Explicit localhost-only POST, bounded one-child queue; never overwrite an existing world.
export function createPlanetGenerationAPI(root){
 let job=null;
 const reply=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 return(req,res,url)=>{
  if(url.pathname!=='/api/planet-generation')return false;
  if(req.method==='GET'){reply(res,200,job?{...job,child:undefined}:{status:'idle'});return true;}
  if(req.method!=='POST'){reply(res,405,{error:'POST required'});return true;}
  if(req.headers.origin!==`http://${req.headers.host}`||!/^application\/json(?:;|$)/.test(req.headers['content-type']??'')){reply(res,403,{error:'同じ画面からのみ生成できます'});return true;}
  if(job?.status==='running'){reply(res,409,{error:'生成中です。完了を待ってください'});return true;}
  let body='',tooLarge=false;
  req.on('data',chunk=>{body+=chunk;if(Buffer.byteLength(body)>1024){tooLarge=true;body='';}});
  req.on('end',()=>{try{
   if(job?.status==='running'){reply(res,409,{error:'生成中です'});return;}
   if(tooLarge)throw new Error('Request too large');const input=JSON.parse(body),{sites=128,settlements=8,population=100000000,localTributaries=false,riverDetail='major',landformShape='rounded',deferredPopulation=false,deferredWater=false,unpopulatedWater=false}=input;
   const upgrade=input.action==='populate'?populationUpgradeRequest(root,input.manifest):null,seed=upgrade?.seed??input.seed,relative=upgrade?.relative??seedDirectory(seed,sites,settlements,population,localTributaries,riverDetail,landformShape,deferredPopulation,deferredWater,unpopulatedWater),directory=path.join(root,relative),manifest=path.join(directory,'manifest.json');
   if(fs.existsSync(manifest)){job={seed,status:'complete',url:`/src/globe/index.html?world=/${relative}/manifest.json`,reused:true};reply(res,200,job);return;}
   requireVerificationMemory();
   if(fs.existsSync(directory))throw new Error('以前の不完全な生成フォルダがあります。別のseedを使うか、内容を確認してください。');
   fs.mkdirSync(directory,{recursive:true});
   job={seed,status:'running',startedAt:new Date().toISOString()};
   const args=upgrade?[path.join(root,'scripts/populate-saved-world.mjs'),upgrade.source,directory]:[path.join(root,'scripts/generate-planet.mjs'),seed,directory,`--sites=${sites}`,`--settlements=${settlements}`,`--population=${population}`,`--river-detail=${riverDetail}`,...(landformShape==='rounded'?[]:[`--landform-shape=${landformShape}`]),...(localTributaries?['--local-tributaries']:[]),...(deferredPopulation?['--deferred-population']:[]),...(deferredWater?['--deferred-water']:[]),...(unpopulatedWater?['--unpopulated-water']:[])];
   const child=spawn(process.execPath,['--max-old-space-size=256',...args],{cwd:root,stdio:['ignore','pipe','pipe']});
   let error='';child.stdout.on('data',()=>{});child.stderr.on('data',b=>{error=(error+b.toString()).slice(-2000);});
   const timer=setTimeout(()=>{error+='\n生成時間の上限に達しました';child.kill();},180000);
   child.on('error',e=>{clearTimeout(timer);job={seed,status:'failed',error:e.message};});
   child.on('close',code=>{clearTimeout(timer);job=code===0&&fs.existsSync(manifest)?{seed,status:'complete',url:`/src/globe/index.html?world=/${relative}/manifest.json`}:{seed,status:'failed',error:error||`生成終了コード ${code}`};});
   reply(res,202,{seed,status:'running'});
  }catch(e){reply(res,400,{error:e.message});}});return true;
 };
}

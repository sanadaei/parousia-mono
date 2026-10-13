import {createPlanetGenerationAPI} from './planet-generation-api.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createStaticServer } from '../src/ui/server.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function startPlanet({port=3000,attempts=10,root=ROOT,software=false}={}){
  if(!Number.isSafeInteger(port)||port<0||port>65535||!Number.isSafeInteger(attempts)||attempts<1||attempts>10)throw new RangeError('Invalid preview port range');
  for(const file of ['examples/planet/generated/manifest.json','examples/planet/generated/world.snapshot.json'])
    if(!fs.existsSync(path.join(root,file)))throw new Error(`Generated world is missing: ${file}. Run npm run planet:generate first.`);
  for(let i=0;i<attempts&&port+i<=65535;i++){
    const server=createStaticServer({root,handler:createPlanetGenerationAPI(root)});
    try{
      await new Promise((resolve,reject)=>{const fail=e=>reject(e);server.once('error',fail);server.listen(port?port+i:0,'127.0.0.1',()=>{server.removeListener('error',fail);resolve();});});
      const actual=server.address().port,url=`http://127.0.0.1:${actual}/src/globe/index.html${software?'?renderer=software':''}`;
      return{server,url,port:actual};
    }catch(e){server.close();if(e.code!=='EADDRINUSE'||i===attempts-1)throw e;}
  }
  throw new Error('No free preview port in the requested range');
}
function openBrowser(url){
  const platform=process.platform,command=platform==='win32'?'cmd.exe':platform==='darwin'?'open':'xdg-open',
    args=platform==='win32'?['/d','/s','/c',`start "" "${url}"`]:[url];
  const child=spawn(command,args,{stdio:'ignore',detached:true});child.once('error',()=>console.log('Open the URL above in your browser.'));child.unref();
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2);for(const a of args)if(!['--no-open','--software'].includes(a)&&!/^--port=\d+$/.test(a))throw new Error(`Unknown option: ${a}`);
    const chosen=args.find(a=>a.startsWith('--port=')),{server,url}=await startPlanet({port:chosen?Number(chosen.slice(7)):3000,software:args.includes('--software')});
    console.log(`Planet is ready: ${url}\nNo build or world regeneration was run. Close this terminal or press Ctrl+C to stop.`);
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{server.close();server.closeAllConnections?.();});
    if(!args.includes('--no-open'))openBrowser(url);
  }catch(e){console.error(`Unable to start Planet: ${e.message}`);process.exitCode=1;}
}

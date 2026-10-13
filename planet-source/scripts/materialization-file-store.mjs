import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
/** Shared by independent references/processes. Commit by exclusive hard link,
 * never overwrite the winning record. This directory is world-save data, not
 * a disposable mesh cache. */
export function createFileMaterializationStorage(directory,{maxRecordBytes=16*1024*1024}={}){
 fs.mkdirSync(directory,{recursive:true});
 const file=key=>path.join(directory,createHash('sha256').update(key).digest('hex')+'.json');
 const get=async key=>{const p=file(key);try{if(fs.statSync(p).size>maxRecordBytes)throw new RangeError('Saved world record exceeds budget');return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
 return{get,async putIfAbsent(key,value){const text=JSON.stringify(value);if(Buffer.byteLength(text)>maxRecordBytes)throw new RangeError('Saved world record exceeds budget');const temp=path.join(directory,`.writing-${randomUUID()}`);let fd;
  try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,text);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;try{fs.linkSync(temp,file(key));}catch(e){if(e.code!=='EEXIST')throw e;}return await get(key);}
  finally{if(fd!=null)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }};
}

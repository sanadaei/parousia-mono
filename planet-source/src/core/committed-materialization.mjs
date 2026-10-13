import {copyJson,hashJson} from './json-contract.mjs';
const SCHEMA='committed-materialization@1';
const abort=signal=>{if(signal?.aborted)throw new DOMException('Cancelled','AbortError');};
/** The storage adapter must atomically return the existing record or insert the
 * candidate. A cache is not a storage adapter. No generator version in the key:
 * a software update must not silently replace an already committed world. */
export class CommittedMaterializer{
 constructor(storage,{maxRecordBytes=16*1024*1024}={}){
  if(!storage?.get||!storage?.putIfAbsent)throw new TypeError('Atomic materialization storage required');
  if(!Number.isSafeInteger(maxRecordBytes)||maxRecordBytes<1)throw new RangeError('Invalid record budget');
  this.storage=storage;this.maxRecordBytes=maxRecordBytes;
 }
 async resolve({worldId,entityId,conditions,generator,generate,signal}){
  if(![worldId,entityId,generator].every(v=>typeof v==='string'&&v.length>0&&v.length<=1024)||typeof generate!=='function')throw new TypeError('Invalid materialization identity');
  abort(signal);const key=JSON.stringify([worldId,entityId]),conditionsHash=hashJson(copyJson(conditions));
  const read=record=>{
   if(record.schema!==SCHEMA||record.key!==key||record.conditionsHash!==conditionsHash)throw new Error('Saved materialization conditions changed; explicit migration required');
   if(hashJson(record.value)!==record.contentHash)throw new Error('Corrupt materialization record');
   return copyJson(record.value);
  };
  const existing=await this.storage.get(key);abort(signal);if(existing)return read(existing);
  const value=copyJson(await generate());abort(signal);
  const record={schema:SCHEMA,key,worldId,entityId,conditionsHash,generator,contentHash:hashJson(value),value};
  if(new TextEncoder().encode(JSON.stringify(record)).length>this.maxRecordBytes)throw new RangeError('Materialization record exceeds storage budget');
  // Cancellation after this atomic commit does not undo world history. The next
  // reference reads the winning record, including across concurrent instances.
  const winner=await this.storage.putIfAbsent(key,record);abort(signal);return read(winner);
 }
}

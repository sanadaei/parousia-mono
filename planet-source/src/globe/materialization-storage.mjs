import {encodeMaterializationArchive,decodeMaterializationArchive,MATERIALIZATION_ARCHIVE_LIMIT,MATERIALIZATION_ARCHIVE_COUNT} from '../core/materialization-archive.mjs';
const sharedStores=new WeakMap();
/** Durable within this browser origin. Unlike ByteLRU, these records are never
 * removed on camera movement. Clearing site data still deletes them; exports include committed results only; original planet files remain required. */
export function createBrowserMaterializationStorage(factory=globalThis.indexedDB){
 if(!factory)return null;
 if(sharedStores.has(factory))return sharedStores.get(factory);
 let opened=null;
 // A failed/blocked open must not poison every later save attempt. Identity
 // guards keep a late event from an abandoned request off a newer connection.
 const db=()=>{
  if(opened)return opened.promise;
  const attempt={promise:null,abandoned:false};opened=attempt;
  attempt.promise=new Promise((resolve,reject)=>{
   const fail=error=>{attempt.abandoned=true;if(opened===attempt)opened=null;reject(error);};
   let request;try{request=factory.open('planet-materialized-worlds',1);}catch(error){fail(error);return;}
   request.onupgradeneeded=()=>request.result.createObjectStore('records');
   request.onsuccess=()=>{
    const database=request.result;
    if(attempt.abandoned){database.close();return;}
    const forget=()=>{if(opened===attempt)opened=null;};
    database.onversionchange=()=>{database.close();forget();};
    database.onclose=forget;
    resolve(database);
   };
   request.onerror=()=>fail(request.error??new Error('Cannot open world storage'));
   request.onblocked=()=>fail(new Error('World storage upgrade blocked by another window'));
  });
  return attempt.promise;
 };
 async function transaction(key,candidate){
  const database=await db();return new Promise((resolve,reject)=>{
   const tx=database.transaction('records',candidate?'readwrite':'readonly'),store=tx.objectStore('records');let result;
   const request=store.get(key);
   request.onsuccess=()=>{result=request.result;if(result==null&&candidate){result=candidate;store.add(candidate,key);}};
   tx.oncomplete=()=>resolve(result??null);
   tx.onabort=()=>reject(tx.error??new Error('World result could not be saved'));
   tx.onerror=()=>{}; // onabort reports failure; never publish an unsaved result.
  });
 }
 async function exportArchive(){
  const database=await db();return new Promise((resolve,reject)=>{
   const tx=database.transaction('records','readonly'),records=[];let bytes=0,failure;
   const request=tx.objectStore('records').openCursor();
   request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;try{const record=cursor.value;bytes+=new TextEncoder().encode(JSON.stringify(record)).length;if(records.length>=MATERIALIZATION_ARCHIVE_COUNT||bytes>MATERIALIZATION_ARCHIVE_LIMIT)throw new RangeError('Archive exceeds bounded transfer size');if(cursor.key!==record.key)throw new Error('Saved record key mismatch');records.push(record);cursor.continue();}catch(e){failure=e;tx.abort();}};
   tx.oncomplete=()=>{try{resolve(encodeMaterializationArchive(records));}catch(e){reject(e);}};
   tx.onabort=()=>reject(failure??tx.error??new Error('Archive read failed'));tx.onerror=()=>{};
  });
 }
 async function importArchive(text){
  const records=decodeMaterializationArchive(text),database=await db();return new Promise((resolve,reject)=>{
   const tx=database.transaction('records','readwrite'),store=tx.objectStore('records');let inserted=0,existing=0,failure;
   for(const record of records){const request=store.get(record.key);request.onsuccess=()=>{if(failure)return;try{if(request.result==null){store.add(record,record.key);inserted++;}else{if(JSON.stringify(request.result)!==JSON.stringify(record))throw new Error('Saved choices conflict; import cancelled without overwriting');existing++;}}catch(e){failure=e;tx.abort();}};}
   tx.oncomplete=()=>resolve({inserted,existing,requiresOriginalPlanet:true});
   tx.onabort=()=>reject(failure??tx.error??new Error('Archive import failed'));tx.onerror=()=>{};
  });
 }
 const adapter={get:key=>transaction(key),putIfAbsent:(key,value)=>transaction(key,value),exportArchive,importArchive};sharedStores.set(factory,adapter);return adapter;
}

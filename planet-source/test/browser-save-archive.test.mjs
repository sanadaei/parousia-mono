import test from 'node:test';import assert from 'node:assert/strict';
import {createBrowserMaterializationStorage} from '../src/globe/materialization-storage.mjs';
import {CommittedMaterializer} from '../src/core/committed-materialization.mjs';
import {encodeMaterializationArchive,decodeMaterializationArchive} from '../src/core/materialization-archive.mjs';
// Transaction-lifecycle test double, not browser IndexedDB acceptance.
function factory(){let rows=new Map();const api={snapshot:()=>structuredClone(rows),open(){const r={result:{transaction(_name,mode){const work=structuredClone(rows);let pending=0,aborted=false,finished=false;const tx={abort(){if(aborted)return;aborted=true;setImmediate(()=>tx.onabort?.());},objectStore(){return{get(key){return request(()=>structuredClone(work.get(key)));},add(value,key){return request(()=>{if(work.has(key)){tx.error=Error('duplicate');tx.abort();return;}work.set(key,structuredClone(value));});},openCursor(){const entries=[...work].sort(([a],[b])=>a.localeCompare(b));let i=0;const r={};function advance(){schedule(()=>{const entry=entries[i++];r.result=entry?{key:entry[0],value:structuredClone(entry[1]),continue:advance}:null;r.onsuccess?.();});}advance();return r;}};}};
 function schedule(f){pending++;setImmediate(()=>{if(!aborted)f();pending--;if(!pending&&!aborted&&!finished){finished=true;if(mode==='readwrite')rows=work;tx.oncomplete?.();}});}
 function request(f){const r={};schedule(()=>{r.result=f();if(!aborted)r.onsuccess?.();});return r;}
 // Empty transactions still finish after the caller sets event callbacks.
 setImmediate(()=>{if(!pending&&!aborted&&!finished){finished=true;tx.oncomplete?.();}});return tx;}}};setImmediate(()=>r.onsuccess?.());return r;}};return api;}
const req={worldId:'A',entityId:'village',conditions:{population:4},generator:'first'};
async function fill(store,entityId,value){return new CommittedMaterializer(store).resolve({...req,entityId,generate:()=>({value})});}
test('browser adapter exports and restores first choices including repeated imports',async()=>{const a=createBrowserMaterializationStorage(factory());await fill(a,'village',7);const text=await a.exportArchive();assert.equal(decodeMaterializationArchive(text).length,1);const b=createBrowserMaterializationStorage(factory());assert.deepEqual(await b.importArchive(text),{inserted:1,existing:0,requiresOriginalPlanet:true});assert.deepEqual(await b.importArchive(text),{inserted:0,existing:1,requiresOriginalPlanet:true});assert.equal((await new CommittedMaterializer(b).resolve({...req,generator:'changed',generate:()=>{throw Error('regenerated');}})).value,7);});
test('conflicting browser import rolls back even earlier inserts',async()=>{const source=createBrowserMaterializationStorage(factory());await fill(source,'a-new',1);await fill(source,'z-conflict',2);const targetFactory=factory(),target=createBrowserMaterializationStorage(targetFactory);await fill(target,'z-conflict',99);const before=targetFactory.snapshot();await assert.rejects(target.importArchive(await source.exportArchive()),/conflict/);assert.deepEqual(targetFactory.snapshot(),before);});
test('corrupt browser archive is rejected before opening a transaction',async()=>{let opened=0;const f={open(){opened++;throw Error('must not open');}},store=createBrowserMaterializationStorage(f);await assert.rejects(store.importArchive('{"schema":"bad"}'),/corrupt/);assert.equal(opened,0);});
test('empty browser archive round trips and foreign key storage corruption is rejected',async()=>{const f=factory(),store=createBrowserMaterializationStorage(f);assert.deepEqual(await store.importArchive(encodeMaterializationArchive([])),{inserted:0,existing:0,requiresOriginalPlanet:true});assert.deepEqual(decodeMaterializationArchive(await store.exportArchive()),[]);await store.putIfAbsent('wrong',{key:'other'});await assert.rejects(store.exportArchive(),/key mismatch/);});

test('failed storage opens can retry without losing first committed choices',async()=>{
 const underlying=factory();let opens=0;
 const f={open(){opens++;if(opens===1){const r={error:Error('temporary failure')};setImmediate(()=>r.onerror());return r;}return underlying.open();}};
 const store=createBrowserMaterializationStorage(f);await assert.rejects(store.get('x'),/temporary failure/);
 await fill(store,'village',7);assert.equal(opens,2);await fill(store,'village',99);
 assert.equal((await new CommittedMaterializer(store).resolve({...req,generate:()=>{throw Error('regenerated');}})).value,7);
 assert.equal(opens,2);
});
test('blocked open closes a late connection without replacing the successful retry',async()=>{
 const underlying=factory();let blocked,opens=0,closed=0;
 const f={open(){opens++;if(opens===1){blocked={};setImmediate(()=>blocked.onblocked());return blocked;}return underlying.open();}};
 const store=createBrowserMaterializationStorage(f);await assert.rejects(store.get('x'),/blocked/);await fill(store,'village',3);
 blocked.result={close(){closed++;}};blocked.onsuccess();blocked.onerror();assert.equal(closed,1);
 assert.equal((await new CommittedMaterializer(store).resolve({...req,generate:()=>{throw Error('regenerated');}})).value,3);assert.equal(opens,2);
});
test('version changes close the connection and next read reopens existing saved choices',async()=>{
 const underlying=factory();let connection,opens=0,closed=0;
 const f={open(){opens++;const r=underlying.open();connection=r.result;connection.close=()=>{closed++;};return r;}};
 const store=createBrowserMaterializationStorage(f);await fill(store,'village',4);connection.onversionchange();assert.equal(closed,1);
 assert.equal((await new CommittedMaterializer(store).resolve({...req,generate:()=>{throw Error('regenerated');}})).value,4);assert.equal(opens,2);
});
test('synchronous open errors leave storage retryable',async()=>{
 const underlying=factory();let opens=0;const f={open(){if(++opens===1)throw Error('temporarily unavailable');return underlying.open();}},store=createBrowserMaterializationStorage(f);
 await assert.rejects(store.get('x'),/temporarily unavailable/);assert.equal(await store.get('x'),null);assert.equal(opens,2);
});

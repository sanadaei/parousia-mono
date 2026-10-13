import {makeShapeFirstDraft,readShapeFirstDraft,saveShapeFirstDraft,validateShapeFirstDraft} from './shape-first-drafts.mjs';
import {prepareShapeFirstModel,sha256Text} from './shape-first-model.mjs';
/** Same verified source is consumed by planet and regional inspection views. */
export async function loadShapeFirstModel({fetchImpl=globalThis.fetch,signal,seed=null}={}) {
  if(seed!==null){
    const saved=await readShapeFirstDraft(seed);
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    if(saved.record){const model=await validateShapeFirstDraft(saved.record,seed);return {...model,draftId:saved.record.sourceSha256,storageStatus:saved.persistent?'saved':'memory-only',storageWarning:saved.warning};}
    const {generateShapeFirstBundle,prepareGeneratedShapeFirstModel}=await import('./shape-first-generated.mjs');
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    let bundle;
    if(typeof Worker==='undefined')bundle=generateShapeFirstBundle(seed);
    else bundle=await new Promise((resolve,reject)=>{
      const worker=new Worker(new URL('./shape-first-generation-worker.mjs',import.meta.url),{type:'module'});
      const finish=(error,result)=>{worker.terminate();signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
      const abort=()=>finish(new DOMException('Aborted','AbortError'));
      signal?.addEventListener('abort',abort,{once:true});
      worker.onmessage=event=>event.data.ok?finish(null,event.data.bundle):finish(new Error(event.data.error));
      worker.onerror=event=>finish(new Error(event.message||'Shape generation worker failed'));
      worker.postMessage({seed});
    });
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    await prepareGeneratedShapeFirstModel(bundle,seed);
    if(signal?.aborted)throw new DOMException('Aborted','AbortError');
    const kept=await saveShapeFirstDraft(makeShapeFirstDraft(seed,bundle));
    const model=await validateShapeFirstDraft(kept.record,seed);
    return {...model,draftId:kept.record.sourceSha256,storageStatus:kept.persistent?'saved':'memory-only',storageWarning:kept.warning};
  }
  const paths=['../../fixtures/shape-first/river-first-candidate.json','../../reports/shape-first-region/region-pyramid.json','../../reports/shape-first-water/water-annotation.json','../../fixtures/shape-first/river-first-terrain.json'];
  const texts=await Promise.all(paths.map(async path=>{const response=await fetchImpl(new URL(path,import.meta.url),{signal});if(!response.ok)throw new Error(`${path}: HTTP ${response.status}`);return response.text();}));
  const model=await prepareShapeFirstModel({candidateText:texts[0],pyramid:JSON.parse(texts[1]),water:JSON.parse(texts[2])}),terrain=JSON.parse(texts[3]);
  if(await sha256Text(JSON.stringify(terrain))!==model.water.preservation.before.terrain||model.water.preservation.before.terrain!==model.water.preservation.after.terrain)throw new Error('Water annotation and native river metadata source mismatch');
  if(terrain.rivers?.length!==model.rivers.length||!terrain.rivers.every((r,i)=>r.id===model.rivers[i]?.id&&r.parent===model.rivers[i]?.parent&&r.direction==='downstream_to_upstream'))throw new Error('River ID, parent or direction mismatch');
  return {...model,nativeTerrain:terrain,sourceLabel:'保存した形状 A',pointOrder:'downstream_to_upstream',storageStatus:'bundled'};
}

/** User-requested candidate survey only; regular frame updates do not run it. */
export async function inspectVisibleCrossings(layer){
 if(!layer?.proceduralSource)return[];
 const ids=new Set(layer.stats().routes.filter(r=>r.status==='requires-regional-crossing-plan').map(r=>r.id)),descriptors=layer.proceduralSource.descriptors().filter(d=>ids.has(d.roadLink?.id)).slice(0,2),results=[];
 for(const d of descriptors){const result=layer.featureWorker?(await layer.featureWorker.generate({...d,inspectionOnly:true,crossingInspection:true},layer.controller.signal)).recipe:await layer.proceduralSource.crossingSites(d,layer.controller.signal);if(result)results.push(result);}
 return results;
}

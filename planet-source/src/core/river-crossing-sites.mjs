import {createSphericalProjection} from './spherical.mjs';
/** Finite geographic survey for a previously saved crossing requirement.
 * Candidates are not operating ferries or engineered bridges. */
export async function surveyRiverCrossingSites(base,route,{sampleSpacingM=5,offsetsM=[-1000,-500,0,500,1000],marginM=1200,maxSamples=16384,signal,yieldWork=async()=>{}}={}){
 if(route?.status!=='requires-regional-crossing-plan'||!route.crossingAssessment?.runs?.length)throw new TypeError('Saved crossing referral required');
 if(!Number.isFinite(sampleSpacingM)||sampleSpacingM<2||sampleSpacingM>20||!Array.isArray(offsetsM)||!offsetsM.length||offsetsM.length>9||offsetsM.some(x=>!Number.isFinite(x)||Math.abs(x)>2000)||!Number.isFinite(marginM)||marginM<100||marginM>2000||!Number.isSafeInteger(maxSamples)||maxSamples<1||maxSamples>32768)throw new RangeError('Invalid crossing survey budget');
 const radiusM=base.frame.radiusM,projection=createSphericalProjection({centerLatDeg:route.fromPoint.latDeg,centerLonDeg:route.fromPoint.lonDeg,radiusM,maxRadiusM:Math.min(radiusM*.1,70000)}),end=projection.toLocal(route.toPoint.latDeg,route.toPoint.lonDeg),length=Math.hypot(end.xM,end.yM);
 if(!Number.isFinite(length)||length<=0||length>60000)throw new RangeError('Crossing proposal outside local survey');
 const ux=end.xM/length,uy=end.yM/length,candidates=[],withheld=[];let sampled=0;
 for(const [runIndex,run] of route.crossingAssessment.runs.entries()){
  if(!Number.isFinite(run.startDistanceM)||!Number.isFinite(run.endDistanceM)||run.startDistanceM<0||run.endDistanceM<run.startDistanceM||run.endDistanceM>length+1)throw new TypeError('Invalid saved water run');
  if(runIndex>=4){withheld.push({reason:'run-budget',runIndex});break;}
  for(const offsetM of [...new Set(offsetsM)].sort((a,b)=>a-b)){
   const first=Math.max(0,run.startDistanceM-marginM),last=Math.min(length+marginM,run.endDistanceM+marginM),steps=Math.ceil((last-first)/sampleSpacingM);
   if(!Number.isFinite(first)||!Number.isFinite(last)||last<=first)throw new TypeError('Invalid saved water run');
   if(sampled+steps+1>maxSamples){withheld.push({runIndex,offsetM,reason:'sample-budget'});continue;}
   const points=[];
   for(let i=0;i<=steps;i++){
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
    const stationM=first+(last-first)*i/steps,p=projection.toGeographic(ux*stationM-uy*offsetM,uy*stationM+ux*offsetM),s=await base.sampleSurfaceAt(p.latDeg,p.lonDeg);
    if(!Number.isFinite(s.groundElevationM)||!Number.isFinite(s.waterDepthM)||s.waterDepthM<0)throw new TypeError('Unknown crossing surface');
    points.push({...p,stationM,groundElevationM:s.groundElevationM,waterDepthM:s.waterDepthM,sourceIds:s.waterSourceIds??[]});sampled++;if(sampled%128===0)await yieldWork();
   }
   let found=false;
   for(let a=0;a<points.length;a++){
    if(!(points[a].waterDepthM>0))continue;const firstWet=a;while(a+1<points.length&&points[a+1].waterDepthM>0)a++;const lastWet=a;
    if(firstWet<1||lastWet+1>=points.length)continue;
    const wet=points.slice(firstWet,lastWet+1),sources=wet[0].sourceIds.filter(id=>id.startsWith('river:')&&wet.every(p=>p.sourceIds.includes(id)));if(!sources.length)continue;
    const near=points[firstWet-1],far=points[lastWet+1],bankSteps=Math.max(1,Math.ceil(20/sampleSpacingM)),nearOuter=points[Math.max(0,firstWet-1-bankSteps)],farOuter=points[Math.min(points.length-1,lastWet+1+bankSteps)];
    if(nearOuter.waterDepthM||farOuter.waterDepthM)continue;
    const grade=(a,b)=>Math.abs(a.groundElevationM-b.groundElevationM)/Math.max(1,Math.abs(a.stationM-b.stationM));
    candidates.push({id:`${route.id}/crossing-candidate:${runIndex}:${offsetM}:${firstWet}`,runIndex,offsetM,sourceId:sources.sort()[0],nearBank:near,farBank:far,sampledWetLengthM:wet.at(-1).stationM-wet[0].stationM,maximumSampledDepthM:Math.max(...wet.map(p=>p.waterDepthM)),nearBankGrade:grade(near,nearOuter),farBankGrade:grade(far,farOuter),status:'geographic-candidate-only'});found=true;
   }
   if(!found)withheld.push({runIndex,offsetM,reason:'no-enclosed-common-river-run'});
  }
 }
 return{schema:'river-crossing-sites@1',connectionId:route.id,candidates,withheld,sampled,sampleSpacingM,built:false,limitations:['Finite transects; no optimum crossing guarantee','Bank slopes are sampled, not certified landing foundations','No currents, flood, navigation, operating rights or approach-road assessment','No ferry, bridge, landing or traversable connection constructed']};
}

export async function commitRiverCrossingSites(materializer,{worldId,baseWorldId,base,route,signal,yieldWork}){
 return materializer.resolve({worldId,entityId:`crossing-sites:${route.id}`,conditions:{baseWorldId,route,policy:'river-crossing-sites@1'},generator:'river-crossing-sites@1',signal,generate:()=>surveyRiverCrossingSites(base,route,{signal,yieldWork})});
}

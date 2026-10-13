import {collectorCells} from './catchment-capture.mjs';
import {positiveNumber,finiteNumber,integerDimension,copyNumericField} from './contract-validation.mjs';
import {sizeCircularCulvert} from './culvert-hydraulics.mjs';

/** Fixed D8 sampling of supplied ground. No depression filling: flats and the
 * edge of the observation window remain uncertainty, not invented outlets. */
export function delineateGridCatchments({columns,rows,cellSizeM,originXM=0,originYM=0,groundElevationM,outlets}){
 integerDimension(columns,'columns');integerDimension(rows,'rows');positiveNumber(cellSizeM,'cell size');
 finiteNumber(originXM,'origin X');finiteNumber(originYM,'origin Y');
 const n=columns*rows;if(!Number.isSafeInteger(n)||n>65536)throw new RangeError('Catchment grid exceeds 65536 cells');
 if(!Array.isArray(outlets)||outlets.length>4096)throw new RangeError('Invalid outlet list');
 if(n*outlets.filter(p=>p.capturePolyline!=null).length>2000000)throw new RangeError('Collector catchment budget exceeded');
 const g=copyNumericField(groundElevationM,n,'ground'),next=new Int32Array(n).fill(-1),count=new Uint32Array(n).fill(1),
   distance=new Float64Array(n),edge=new Uint8Array(n),flat=new Uint8Array(n),links=new Float64Array(n),ids=new Set();
 for(let i=0;i<n;i++){
  const x=i%columns,y=Math.floor(i/columns);edge[i]=+(x===0||y===0||x===columns-1||y===rows-1);let grade=0;
  for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
   if(!(dx||dy)||x+dx<0||x+dx>=columns||y+dy<0||y+dy>=rows)continue;
   const j=(y+dy)*columns+x+dx,drop=g[i]-g[j],length=cellSizeM*Math.hypot(dx,dy);
   if(Math.abs(drop)<=1e-9)flat[i]=1;
   if(drop>1e-9&&drop/length>grade){grade=drop/length;next[i]=j;links[i]=length;}
  }
 }
 // Strict downhill edges make elevation order a topological order.
 const order=Array.from({length:n},(_,i)=>i).sort((a,b)=>g[b]-g[a]||a-b);
 for(const i of order){const j=next[i];if(j<0)continue;count[j]+=count[i];distance[j]=Math.max(distance[j],distance[i]+links[i]);edge[j]|=edge[i];flat[j]|=flat[i];}
 if(!Number.isFinite(cellSizeM**2*n)||!Number.isFinite(originXM+columns*cellSizeM)||!Number.isFinite(originYM+rows*cellSizeM))throw new RangeError('Catchment extent overflow');
 const catchments=outlets.map(p=>{
  if(typeof p.id!=='string'||!p.id||ids.has(p.id))throw new TypeError('Unique outlet IDs required');ids.add(p.id);
  finiteNumber(p.xM,'outlet X');finiteNumber(p.yM,'outlet Y');
  const x=Math.floor((p.xM-originXM)/cellSizeM),y=Math.floor((p.yM-originYM)/cellSizeM);
  if(x<0||y<0||x>=columns||y>=rows)return{id:p.id,status:'outside-grid',cellIndex:null,areaM2:null};
  const i=y*columns+x,reasons=[];
  if(p.capturePolyline!=null){
   const capture=collectorCells({columns,rows,cellSizeM,originXM,originYM},p.capturePolyline,p),included=new Uint8Array(n),paths=new Float64Array(n);
   for(const c of capture.cellIndices)included[c]=1;
   // Receivers are strictly lower. Reverse order visits each receiver before
   // its upstream cells; union membership prevents double-counting branches.
   for(let k=order.length-1;k>=0;k--){const c=order[k],j=next[c];if(!included[c]&&j>=0&&included[j]){included[c]=1;paths[c]=paths[j]+links[c];}}
   let contributingCells=0,longest=0,touchesEdge=capture.outside,hasFlat=false;
   for(let c=0;c<n;c++)if(included[c]){contributingCells++;longest=Math.max(longest,paths[c]);touchesEdge ||= !!edge[c];hasFlat ||= !!flat[c];}
   if(touchesEdge)reasons.push('upstream-touches-window-edge');if(hasFlat)reasons.push('unresolved-flat-adjacent-to-upstream');
   if(!contributingCells)return{id:p.id,status:'outside-grid',cellIndex:null,areaM2:null};
   return{id:p.id,status:reasons.length?'partial-catchment':'delineated-within-grid',reasons,cellIndex:i,
    captureMethod:'authored-line-supercover@1',captureCellIndices:capture.cellIndices,capturePolyline:capture.polyline,collectorLengthM:capture.lengthM,
    contributingCells,areaM2:contributingCells*cellSizeM**2,longestPathM:longest+capture.lengthM+cellSizeM*Math.SQRT2,outletIsLocalSink:null,
    collectionAssumption:'Ideal interception of every intersected grid cell and conveyance along the authored line to the mouth. Collector grade, storage and conveyance capacity are not validated.'};
  }
  if(edge[i])reasons.push('upstream-touches-window-edge');if(flat[i])reasons.push('unresolved-flat-adjacent-to-upstream');
  return{id:p.id,status:reasons.length?'partial-catchment':'delineated-within-grid',reasons,cellIndex:i,
   cellCenter:{xM:originXM+(x+.5)*cellSizeM,yM:originYM+(y+.5)*cellSizeM},mouthToCellCenterM:Math.hypot(p.xM-(originXM+(x+.5)*cellSizeM),p.yM-(originYM+(y+.5)*cellSizeM)),
   contributingCells:count[i],areaM2:count[i]*cellSizeM**2,longestPathM:distance[i]+cellSizeM*Math.SQRT2,
   outletIsLocalSink:next[i]<0};
 });
 return{schema:outlets.some(p=>p.capturePolyline!=null)?'sampled-d8-catchments@2':'sampled-d8-catchments@1',grid:{columns,rows,cellSizeM,originXM,originYM},catchments,
  diagnostics:{cells:n,sinks:next.reduce((s,j)=>s+(j<0),0),scope:outlets.some(p=>p.capturePolyline!=null)?'Strict downhill D8 union upstream of explicitly authored ideal collector cells. No validated ditch grade/capacity, depression overflow, storm storage or external drainage.':'strict downhill D8 on fixed sampled ground; outlet is its containing cell, not an exact point capture. No depression overflow, storm storage, underground flow or drainage outside this window.'}};
}

/** Rational peak estimate with explicit storm/runoff/travel assumptions. Never
 * relabel a truncated catchment or short storm as a complete design flow. */
export function estimateCatchmentPeak(catchment,{rainfallMmPerHour,durationSeconds,runoffCoefficient,travelSpeedMPerSecond}){
 positiveNumber(rainfallMmPerHour,'rainfall');positiveNumber(durationSeconds,'duration');positiveNumber(travelSpeedMPerSecond,'travel speed');finiteNumber(runoffCoefficient,'runoff coefficient');
 if(rainfallMmPerHour>500||durationSeconds>86400||travelSpeedMPerSecond>20||runoffCoefficient<=0||runoffCoefficient>1)throw new RangeError('Storm assumptions exceed supported bounds');
 if(catchment.status==='outside-grid')return{status:'unresolved',reasons:['outlet-outside-grid'],estimatedPeakM3PerSecond:null};
 positiveNumber(catchment.areaM2,'catchment area');positiveNumber(catchment.longestPathM,'flow path');
 const concentrationSeconds=catchment.longestPathM/travelSpeedMPerSecond,requiredDurationSeconds=Math.max(600,concentrationSeconds),reasons=[...(catchment.reasons??[])];
 if(!['partial-catchment','delineated-within-grid'].includes(catchment.status))throw new TypeError('Invalid catchment status');
 if(catchment.status==='partial-catchment'&&!reasons.length)reasons.push('partial-catchment');
 if(durationSeconds<requiredDurationSeconds)reasons.push('storm-shorter-than-concentration-window');
 if(catchment.areaM2>800000)reasons.push('area-exceeds-small-catchment-scope');
 return{status:reasons.length?'estimate-only':'eligible-with-explicit-assumptions',reasons,
  estimatedPeakM3PerSecond:runoffCoefficient*rainfallMmPerHour/3600000*catchment.areaM2,concentrationSeconds,requiredDurationSeconds,
  assumptions:{rainfallMmPerHour,durationSeconds,runoffCoefficient,travelSpeedMPerSecond,uniformRainfall:true,storageIgnored:true},
  scope:'Rational peak on the sampled contributing area; authored constant travel speed and runoff coefficient, not calibrated climatology, a hydrograph or a guaranteed full physical watershed.'};
}

export function validateCatchmentAssumptions(storm,design){
 estimateCatchmentPeak({status:'delineated-within-grid',areaM2:1,longestPathM:1,reasons:[]},storm);
 if(!design)throw new TypeError('Explicit pipe design assumptions required');
 const {diametersM,upstreamDepthM,downstreamDepthM,safetyFactor=1.2}=design;
 finiteNumber(upstreamDepthM,'upstream depth');finiteNumber(downstreamDepthM,'downstream depth');
 if(upstreamDepthM<=0||downstreamDepthM<0)throw new RangeError('Explicit nonnegative heads required');
 sizeCircularCulvert({geometry:{model:'circular-quasi-steady@1',lengthM:1,roughnessN:.015,entranceLoss:.5,exitLoss:1,inletInvertM:0,outletInvertM:0},diametersM,safetyFactor,
 conditions:[{id:'validate',targetFlowM3PerSecond:1,upstreamLevelM:1,downstreamLevelM:0}]});
}
export function assessCatchmentCulverts(grid,culverts,storm,design){
 validateCatchmentAssumptions(storm,design);
 const {diametersM,upstreamDepthM,downstreamDepthM,safetyFactor=1.2}=design;
 finiteNumber(upstreamDepthM,'upstream depth');finiteNumber(downstreamDepthM,'downstream depth');
 if(upstreamDepthM<=0||downstreamDepthM<0)throw new RangeError('Explicit nonnegative heads required');
 const delineation=delineateGridCatchments({...grid,outlets:culverts.map(c=>({id:c.id,...c.upstream,...(c.capturePolyline?{capturePolyline:c.capturePolyline}:{})}))});
 const assessments=delineation.catchments.map((catchment,i)=>{
  const peak=estimateCatchmentPeak(catchment,storm),c=culverts[i];let sizing=null;
  if(peak.status==='eligible-with-explicit-assumptions'&&c.hydraulics)sizing=sizeCircularCulvert({geometry:c.hydraulics,diametersM,safetyFactor,
   conditions:[{id:'sampled-catchment-storm',targetFlowM3PerSecond:peak.estimatedPeakM3PerSecond,upstreamLevelM:c.hydraulics.inletInvertM+upstreamDepthM,downstreamLevelM:c.hydraulics.outletInvertM+downstreamDepthM}]});
  return{id:c.id,catchment,peak,sizing,savedDiameterM:c.hydraulics?.diameterM??null,status:!c.hydraulics?'legacy-pipe-without-geometry':sizing?.status??'insufficient-catchment-evidence'};
 });
 return{schema:'catchment-culvert-assessment@1',delineation,assumptions:{storm:structuredClone(storm),diametersM:[...diametersM],upstreamDepthM,downstreamDepthM,safetyFactor},assessments};
}

import {analyzeLocalDrainage} from './local-drainage.mjs';
import {createSphericalProjection,greatCircle,sphereBasis} from './spherical.mjs';

export const LOCAL_PONDS_SCHEMA='planet-local-ponds@1';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

/** Wet-season standing water in actual closed hollows, with no excavation.
 * A moisture threshold and partial fill are explicit scenario assumptions,
 * not a groundwater / evaporation balance or a perennial-water guarantee. */
export function deriveRegionalPonds(base,regions,climate,{maxPonds=64,maxCandidatesPerRegion=4,fillFraction=.65}={}){
 if(!Array.isArray(regions)||regions.length>128||!Number.isSafeInteger(maxPonds)||maxPonds<0||maxPonds>128||!Number.isSafeInteger(maxCandidatesPerRegion)||maxCandidatesPerRegion<1||maxCandidatesPerRegion>16||!(fillFraction>0&&fillFraction<1))throw new RangeError('Invalid local pond work budget');
 const radiusM=base.frame.radiusM,w=climate?.grid?.columns,h=climate?.grid?.rows;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>32768||climate.annualPrecipitationMm?.length!==w*h||climate.annualMeanTemperatureC?.length!==w*h)throw new TypeError('Local ponds require a bounded climate field');
 const bodies=[],rejections={},diagnostics={regionsConsidered:0,regionsSurveyed:0,coarseSamples:0,refinedCandidates:0,accepted:0,rejections};
 const reject=why=>rejections[why]=(rejections[why]??0)+1;
 for(const region of regions){
  diagnostics.regionsConsidered++;if(bodies.length>=maxPonds){reject('pond-budget');continue;}
  const n=region.gridSize,step=region.cellSizeM,center=region.center,half=(n-1)*step/2;
  if(!Number.isSafeInteger(n)||n<5||n>255||!Number.isFinite(step)||step<=0||Math.SQRT2*half>radiusM*.02)throw new RangeError('Invalid pond survey region');
  const cell=clamp(Math.floor((90-center.latDeg)/180*h),0,h-1)*w+((Math.floor(center.lonDeg/360*w)%w)+w)%w;
  if(!(climate.annualPrecipitationMm[cell]>=500&&climate.annualMeanTemperatureC[cell]>0)){reject('dry-or-frozen-climate-scenario');continue;}
  diagnostics.regionsSurveyed++;
  const projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM,maxRadiusM:Math.SQRT2*half+32}),elevation=[],wet=[];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const p=projection.toGeographic(x*step-half,y*step-half),s=base.sampleSurfaceAt(p.latDeg,p.lonDeg);if(!Number.isFinite(s.groundElevationM)||s.waterDepthM==null)throw new Error('Pond survey requires known ground and water');elevation.push(s.groundElevationM);wet.push(s.waterDepthM>0);}
  diagnostics.coarseSamples+=n*n;
  const analysis=analyzeLocalDrainage({columns:n,rows:n,cellSizeM:step,elevation}),seen=new Uint8Array(n*n),candidates=[];
  for(let i=0;i<n*n;i++){
   if(seen[i]||wet[i]||analysis.filledElevationM[i]-elevation[i]<.3)continue;
   const queue=[i],cells=[];seen[i]=1;
   while(queue.length){const q=queue.pop();cells.push(q);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=q%n+dx,y=Math.floor(q/n)+dy,j=y*n+x;if(x<=0||x>=n-1||y<=0||y>=n-1||seen[j]||wet[j]||analysis.filledElevationM[j]-elevation[j]<.3||Math.abs(analysis.filledElevationM[j]-analysis.filledElevationM[i])>1e-5)continue;seen[j]=1;queue.push(j);}}
   let lowest=cells[0];for(const q of cells)if(elevation[q]<elevation[lowest])lowest=q;
   const depth=analysis.filledElevationM[i]-elevation[lowest];
   if(depth<.5||depth>5||cells.length*step*step>50000)continue;
   candidates.push({cell:lowest,depth,...projection.toGeographic(lowest%n*step-half,Math.floor(lowest/n)*step-half)});
  }
  candidates.sort((a,b)=>b.depth-a.depth||a.cell-b.cell);
  let surveyed=0;
  for(const candidate of candidates){
   if(surveyed>=maxCandidatesPerRegion||bodies.length>=maxPonds)break;
   if(bodies.some(p=>greatCircle(p.center,candidate,radiusM).distanceM<2*Math.SQRT2*128+4)){reject('overlapping-survey');continue;}
   surveyed++;diagnostics.refinedCandidates++;
   const result=surveyPondHollow(base,candidate,{id:`${region.id}/pond:${candidate.cell}`,fillFraction});
   if(result.body)bodies.push({...result.body,climateScenario:{annualPrecipitationMm:climate.annualPrecipitationMm[cell],annualMeanTemperatureC:climate.annualMeanTemperatureC[cell]}});else reject(result.reason);
  }
 }
 diagnostics.accepted=bodies.length;
 return{schema:LOCAL_PONDS_SCHEMA,radiusM,bodies,diagnostics,assumptions:{season:'wet-season-static-scenario',fillFraction,minAnnualPrecipitationMm:500,waterBalance:'not-simulated'},limitations:['Bounded fixed river neighbourhoods only, not planet-wide pond coverage','Finite 8 m ground and 4 m rim surveys; sub-grid leaks are not certified','No groundwater, evaporation, seepage or seasonal persistence simulation']};
}

export function surveyPondHollow(base,center,{id,fillFraction=.65}={}){
 if(typeof id!=='string'||!id||!(fillFraction>0&&fillFraction<1))throw new TypeError('Explicit pond identity and partial fill are required');
 const radiusM=base.frame.radiusM,projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM,maxRadiusM:200}),n=33,step=8,half=128,elevation=[];
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const p=projection.toGeographic(x*step-half,y*step-half),s=base.sampleSurfaceAt(p.latDeg,p.lonDeg);if(!Number.isFinite(s.groundElevationM)||s.waterDepthM!==0)return{body:null,reason:'existing-or-unknown-water'};elevation.push(s.groundElevationM);}
 const analysis=analyzeLocalDrainage({columns:n,rows:n,cellSizeM:step,elevation}),central=elevation.map((z,i)=>({i,z,fill:analysis.filledElevationM[i]-z})).filter(v=>Math.abs(v.i%n-16)<=5&&Math.abs(Math.floor(v.i/n)-16)<=5&&v.fill>.3).sort((a,b)=>b.fill-a.fill||a.i-b.i)[0];
 if(!central)return{body:null,reason:'no-refined-hollow'};
 const level=central.z+Math.min(3,central.fill*fillFraction),maxDepthM=level-Math.min(...elevation),areaM2=elevation.filter(z=>z<level).length*step*step;
 if(maxDepthM>3||areaM2<128||areaM2>20000)return{body:null,reason:'depth-or-area-limit'};
 let minRimM=Infinity;
 for(let j=0;j<=64;j++)for(const [x,y]of[[-half,-half+j*4],[half,-half+j*4],[-half+j*4,-half],[-half+j*4,half]]){const p=projection.toGeographic(x,y),s=base.sampleSurfaceAt(p.latDeg,p.lonDeg);if(!Number.isFinite(s.groundElevationM)||s.waterDepthM!==0)return{body:null,reason:'unknown-or-wet-rim'};minRimM=Math.min(minRimM,s.groundElevationM-level);}
 if(minRimM<.15)return{body:null,reason:'open-or-low-rim'};
 return{body:{id,kind:'natural-hollow-pond',center:{latDeg:center.latDeg,lonDeg:center.lonDeg},projection:projection.contract,bounds:{minXM:-half,maxXM:half,minYM:-half,maxYM:half},levelElevationM:level,spillLevelM:analysis.filledElevationM[central.i],survey:{gridSize:n,cellSizeM:step,rimStepM:4,minRimM,maxDepthM,estimatedWetAreaM2:areaM2},margin:{method:'surveyed-wet-season-margin@1',gridSize:n,cellSizeM:step,originXM:-half,originYM:-half,wetCells:elevation.flatMap((z,i)=>z<level?[i]:[]),reachM:16,maxHeightAboveWaterM:.6},wetFocus:projection.toGeographic(central.i%n*step-half,Math.floor(central.i/n)*step-half)},reason:null};
}

/** A fixed saved footprint clips a horizontal surface against the real bed.
 * No camera state, generated mesh, terrain excavation or random query input. */
export function createLocalPondSampler(model){
 if(model==null)return null;
 if(model.schema!==LOCAL_PONDS_SCHEMA||!Number.isFinite(model.radiusM)||model.radiusM<=0||!Array.isArray(model.bodies)||model.bodies.length>128)throw new TypeError('Invalid local pond model');
 const ids=new Set(),bodies=model.bodies.map(b=>{
  if(typeof b.id!=='string'||!b.id||ids.has(b.id)||!Number.isFinite(b.levelElevationM)||!Number.isFinite(b.spillLevelM)||b.levelElevationM>=b.spillLevelM||b.projection?.radiusM!==model.radiusM)throw new TypeError('Invalid local pond body');ids.add(b.id);
  const q=b.bounds;if(!q||![q.minXM,q.maxXM,q.minYM,q.maxYM].every(Number.isFinite)||q.minXM>=q.maxXM||q.minYM>=q.maxYM||Math.max(...Object.values(q).map(Math.abs))>512)throw new RangeError('Invalid local pond support');
  const projection=createSphericalProjection(b.projection),up=sphereBasis({latDeg:b.projection.centerLatDeg,lonDeg:b.projection.centerLonDeg}).up,extent=Math.hypot(Math.max(Math.abs(q.minXM),Math.abs(q.maxXM)),Math.max(Math.abs(q.minYM),Math.abs(q.maxYM)));
  let margin=null;if(b.margin){const m=b.margin;if(m.method!=='surveyed-wet-season-margin@1'||m.gridSize!==33||m.cellSizeM!==8||m.originXM!==-128||m.originYM!==-128||m.reachM!==16||m.maxHeightAboveWaterM!==.6||!Array.isArray(m.wetCells)||m.wetCells.length>1089||m.wetCells.some(i=>!Number.isInteger(i)||i<0||i>=1089))throw new TypeError('Invalid pond margin survey');margin={...m,cells:new Set(m.wetCells)};}
  return{...b,margin,projection,up,cosine:Math.cos((extent+1)/model.radiusM)};
 });
 return(lat,lon,ground)=>{const up=sphereBasis({latDeg:lat,lonDeg:lon}).up;let selected=null;
  for(const b of bodies){if(!(ground<b.levelElevationM+(b.margin?.maxHeightAboveWaterM??0))||up.reduce((s,v,i)=>s+v*b.up[i],0)<b.cosine)continue;const p=b.projection.toLocalIfWithin(lat,lon),q=b.bounds;if(!p||p.xM<q.minXM||p.xM>q.maxXM||p.yM<q.minYM||p.yM>q.maxYM)continue;
   let margin=false;if(ground>=b.levelElevationM&&b.margin){const m=b.margin,cx=Math.round((p.xM-m.originXM)/m.cellSizeM),cy=Math.round((p.yM-m.originYM)/m.cellSizeM);for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){const x=cx+dx,y=cy+dy;if(x>=0&&x<33&&y>=0&&y<33&&m.cells.has(y*33+x)&&Math.hypot(p.xM-(m.originXM+x*8),p.yM-(m.originYM+y*8))<=m.reachM)margin=true;}if(!margin)continue;}
   if(!selected||b.levelElevationM>selected.levelElevationM)selected={...b,isMargin:margin};}
  return selected?{hydrologyStatus:'modeled-scenario',surfaceKind:selected.isMargin?'seasonal-pond-margin':'natural-hollow-pond',waterLevelElevationM:selected.levelElevationM,waterSurfaceElevationM:selected.isMargin?null:selected.levelElevationM,waterDepthM:Math.max(0,selected.levelElevationM-ground),waterSourceIds:selected.isMargin?[]:[selected.id],...(selected.isMargin?{waterContextIds:[selected.id]}:{})}:null;
 };
}

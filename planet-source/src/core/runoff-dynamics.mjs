import {compileStorage} from './runoff-storage.mjs';
import { validateFaceObstructions, openFaceHead } from './runoff-obstacles.mjs';
import { circularCulvertFlow, validateCircularCulvert } from './culvert-hydraulics.mjs';
import { positiveNumber, finiteNumber } from './contract-validation.mjs';
/** Full, submerged circular barrel: reservoir head difference balanced against
 * entrance/exit losses and Manning barrel friction, SI units. Partial-barrel
 * flow and inlet-control curves require a different solver, never guessed. */
export function submergedPipeFlow({diameterM,lengthM,roughnessN,entranceLoss=0.5,exitLoss=1,inletInvertM,outletInvertM,upstreamLevelM,downstreamLevelM}){
 for(const [k,v]of Object.entries({diameterM,lengthM,roughnessN}))positiveNumber(v,k);
 for(const [k,v]of Object.entries({entranceLoss,exitLoss,inletInvertM,outletInvertM,upstreamLevelM,downstreamLevelM}))finiteNumber(v,k);
 if(entranceLoss<0||exitLoss<0)throw new RangeError('Pipe losses must be nonnegative');
 if(upstreamLevelM<inletInvertM+diameterM||downstreamLevelM<outletInvertM+diameterM)return{status:'unsupported-partial-barrel',flowM3PerSecond:null};
 const area=Math.PI*diameterM*diameterM/4,radius=diameterM/4,head=upstreamLevelM-downstreamLevelM,g=9.80665,loss=entranceLoss+exitLoss+2*g*roughnessN**2*lengthM/radius**(4/3);
 const velocity=Math.sign(head)*Math.sqrt(2*g*Math.abs(head)/loss);
 return{status:'modeled-full-barrel',flowM3PerSecond:area*velocity,velocityMPerSecond:velocity,headDifferenceM:head,lossCoefficient:loss};
}
/** Conservative finite-volume reservoir routing on a fixed simulation grid.
 * Conductance is explicit (m²/s). This does not solve momentum, waves, erosion,
 * or turbulence. Rendering LOD never defines these simulation cells. */
export function createRunoffState({columns,rows,cellSizeM,groundElevationM,waterDepthM=null}){
 const n=columns*rows;if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<2||rows<2||n>131072)throw new RangeError('Invalid runoff grid');positiveNumber(cellSizeM,'cellSizeM');waterDepthM??=Array(n).fill(0);
 for(const [name,values]of Object.entries({groundElevationM,waterDepthM}))if(!Array.isArray(values)||values.length!==n||!values.every(v=>Number.isFinite(v)&&(name!=='waterDepthM'||v>=0)))throw new RangeError(`Invalid ${name}`);
 return{schema:'planet-reservoir-runoff@1',columns,rows,cellSizeM,groundElevationM:[...groundElevationM],waterVolumeM3:waterDepthM.map(v=>v*cellSizeM**2),elapsedSeconds:0};
}
function advanceRunoff(input,{seconds,rainfallMPerSecond=0,infiltrationMPerSecond=0,conductanceM2PerSecond=1,culverts=[],boundaries=[]}={}){
 if(!['planet-reservoir-runoff@1','planet-reservoir-runoff@2'].includes(input?.schema)||!Number.isFinite(input.elapsedSeconds)||input.elapsedSeconds<0)throw new TypeError('Invalid runoff state');positiveNumber(seconds,'seconds');
 if(input.schema==='planet-reservoir-runoff@1'&&input.storageObstructions!=null||input.schema==='planet-reservoir-runoff@2'&&!Array.isArray(input.storageObstructions))throw new TypeError('Storage volumes require explicit runoff schema @2');
 for(const [k,v]of Object.entries({rainfallMPerSecond,infiltrationMPerSecond,conductanceM2PerSecond})){finiteNumber(v,k);if(v<0)throw new RangeError(`${k} must be nonnegative`);}
 const {columns:w,rows:h,cellSizeM:cell,groundElevationM:ground}=input,n=w*h,area=cell*cell;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<2||h<2||!Array.isArray(ground)||!Array.isArray(input.waterVolumeM3)||!Number.isSafeInteger(n)||n<4||n>131072||ground.length!==n||input.waterVolumeM3.length!==n||!ground.every(Number.isFinite)||!input.waterVolumeM3.every(v=>Number.isFinite(v)&&v>=0)||!Number.isFinite(area)||area<=0)throw new RangeError('Invalid runoff state fields');
 if(!Array.isArray(culverts)||culverts.length>4096)throw new RangeError('Invalid culverts');
 const faceObstructions=validateFaceObstructions(input.faceObstructions??[],w,h);
 const initial=input.waterVolumeM3.reduce((s,v)=>s+v,0),rain=rainfallMPerSecond*seconds*area,vol=input.waterVolumeM3.map(v=>v+rain);let infiltratedM3=0;
 for(let i=0;i<n;i++){const amount=Math.min(vol[i],infiltrationMPerSecond*seconds*area);vol[i]-=amount;infiltratedM3+=amount;}
 const storage=compileStorage(input.storageObstructions??[],input),levels=vol.map((v,i)=>storage.levelAtVolume(i,v)),flows=[],out=Array(n).fill(0);const add=(a,b,rate,kind)=>{if(rate<0){[a,b]=[b,a];rate=-rate;}const volume=rate*seconds;if(!Number.isFinite(volume))throw new RangeError('Runoff flux overflow');if(volume>0){flows.push({from:a,to:b,volumeM3:volume,kind});if(a>=0)out[a]+=volume;}};
 const surface=(a,b)=>{const sill=Math.max(ground[a],ground[b]),from=levels[a]>=levels[b]?a:b,to=from===a?b:a,head=openFaceHead(faceObstructions.get(`${a}/${b}`),levels[from],Math.max(levels[to],sill));add(from,to,head*conductanceM2PerSecond,'surface');};
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;if(x+1<w)surface(i,i+1);if(y+1<h)surface(i,i+w);}
 const hydraulicStates=[];const ids=new Set();for(const c of culverts){if(typeof c.id!=='string'||ids.has(c.id)||![c.fromCell,c.toCell].every(i=>Number.isSafeInteger(i)&&i>=0&&i<n)||c.fromCell===c.toCell)throw new TypeError('Invalid culvert endpoints');ids.add(c.id);
 if(c.hydraulics){
   const a=c.fromCell,b=c.toCell,result=circularCulvertFlow(c.hydraulics,levels[a],levels[b]),from=result.flowM3PerSecond>=0?a:b,to=from===a?b:a;
   const invert=from===a?c.hydraulics.inletInvertM:c.hydraulics.outletInvertM;
   const available=input.storageObstructions?.length?Math.max(0,vol[from]-storage.volumeAtLevel(from,Math.max(ground[from],invert))):Math.max(0,levels[from]-Math.max(ground[from],invert))*area;
   let equilibrium=Math.abs(levels[a]-levels[b])*area/2;
   if(input.storageObstructions?.length){let lo=Math.min(levels[a],levels[b]),hi=Math.max(levels[a],levels[b]);for(let k=0;k<48;k++){const mid=(lo+hi)/2;if(storage.volumeAtLevel(a,mid)+storage.volumeAtLevel(b,mid)>vol[a]+vol[b])hi=mid;else lo=mid;}equilibrium=Math.max(0,vol[from]-storage.volumeAtLevel(from,(lo+hi)/2));}
   const rate=Math.min(Math.abs(result.flowM3PerSecond),available/seconds,equilibrium/seconds);
   add(from,to,rate,c.id);hydraulicStates.push({id:c.id,...result,limitedFlowM3PerSecond:(from===a?1:-1)*rate});continue;
 }
 for(const [k,v]of Object.entries({capacityM3PerSecond:c.capacityM3PerSecond,conductanceM2PerSecond:c.conductanceM2PerSecond})){finiteNumber(v,k);if(v<0)throw new RangeError('Negative culvert capacity');}
 finiteNumber(c.invertM,'culvert invert');const a=c.fromCell,b=c.toCell,from=levels[a]>=levels[b]?a:b,to=from===a?b:a,head=Math.max(0,levels[from]-Math.max(levels[to],c.invertM));add(from,to,Math.min(c.capacityM3PerSecond,head*c.conductanceM2PerSecond),c.id);}
 if(!Array.isArray(boundaries)||boundaries.length>8192)throw new RangeError('Invalid runoff boundaries');
 const boundaryIds=new Set(),faces=new Set();
 for(const b of boundaries){const i=b.cell,x=i%w,y=Math.floor(i/w),face=`${i}/${b.edge}`;
 if(typeof b.id!=='string'||boundaryIds.has(b.id)||faces.has(face)||!Number.isSafeInteger(i)||i<0||i>=n||!({west:x===0,east:x===w-1,north:y===0,south:y===h-1}[b.edge]))throw new TypeError('Invalid boundary cell or face');
 boundaryIds.add(b.id);faces.add(face);finiteNumber(b.levelElevationM,'boundary level');finiteNumber(b.sillElevationM,'boundary sill');nonnegativeBoundary(b.conductanceM2PerSecond);
 const outside=b.levelElevationM,sill=Math.max(ground[i],b.sillElevationM),outward=levels[i]>=outside;
 const head=Math.max(0,(outward?levels[i]:outside)-Math.max(outward?outside:levels[i],sill));
 add(outward?i:-1,outward?-1:i,head*b.conductanceM2PerSecond,`boundary:${b.id}`);
 }
 const next=[...vol];for(const f of flows){const moved=f.volumeM3*(f.from<0?1:Math.min(1,vol[f.from]/out[f.from]));if(f.from>=0)next[f.from]-=moved;if(f.to>=0)next[f.to]+=moved;f.volumeM3=moved;}
 for(let i=0;i<n;i++){if(next[i]<-1e-8)throw new Error('Negative water volume');next[i]=Math.max(0,next[i]);if(!Number.isFinite(next[i]))throw new RangeError('Runoff volume overflow');}
 const rainM3=rain*n,final=next.reduce((s,v)=>s+v,0),boundaryInM3=flows.filter(f=>f.from<0).reduce((n,f)=>n+f.volumeM3,0),boundaryOutM3=flows.filter(f=>f.to<0).reduce((n,f)=>n+f.volumeM3,0),balanceErrorM3=final-initial-rainM3+infiltratedM3-boundaryInM3+boundaryOutM3;
 return{...input,groundElevationM:[...ground],waterVolumeM3:next,elapsedSeconds:input.elapsedSeconds+seconds,diagnostics:{initialM3:initial,finalM3:final,rainM3,infiltratedM3,balanceErrorM3,boundaryInM3,boundaryOutM3,boundaryTransfers:flows.filter(f=>f.from<0||f.to<0),culvertTransfers:flows.filter(f=>f.kind!=='surface'&&f.from>=0&&f.to>=0),boundary:boundaries.length?'prescribed-head':'closed',hydraulicStates,model:'linear-head surface reservoirs with optional circular hydraulic links; momentum not modeled'}};
}

function nonnegativeBoundary(v){finiteNumber(v,'boundary conductance');if(v<0)throw new RangeError('Negative boundary conductance');}
export function stepRunoff(input,options={}) {
  options={boundaries:input?.boundaries??[],culverts:input?.culverts??[],...options};
  if(!Array.isArray(options.culverts)||options.culverts.length>4096||!Array.isArray(options.boundaries)||options.boundaries.length>8192)throw new RangeError('Runoff connection budget exceeded');
  positiveNumber(options.seconds,'seconds');
  const n=input?.columns*input?.rows,area=input?.cellSizeM**2,k=options.conductanceM2PerSecond??1;
  let hasHydraulics=false;const extras=new Map();for(const c of options.culverts??[]){if(c.hydraulics){validateCircularCulvert(c.hydraulics);hasHydraulics=true;}else for(const i of[c.fromCell,c.toCell])extras.set(i,(extras.get(i)??0)+c.conductanceM2PerSecond);}
  for(const b of options.boundaries){nonnegativeBoundary(b.conductanceM2PerSecond);extras.set(b.cell,(extras.get(b.cell)??0)+b.conductanceM2PerSecond);}
  const minimumArea=input?.storageObstructions?.length?compileStorage(input.storageObstructions,input).minimumAreaM2:area;
  const maxConductance=4*k+Math.max(0,...extras.values()),stableSeconds=maxConductance>0?.45*minimumArea/maxConductance:options.seconds;
  const steps=Math.max(1,Math.ceil(options.seconds/Math.min(stableSeconds,hasHydraulics?1:Infinity)));
  if(!Number.isFinite(steps)||steps>4096||steps*n>5000000)throw new RangeError('Runoff step exceeds stable work budget; use a shorter duration');
  let state=input,rain=0,infiltration=0,inflow=0,outflow=0,initial=null;const pipes=new Map(),boundaryTotals=new Map();
  for(let i=0;i<steps;i++){state=advanceRunoff(state,{...options,seconds:options.seconds/steps});const d=state.diagnostics;initial??=d.initialM3;rain+=d.rainM3;infiltration+=d.infiltratedM3;inflow+=d.boundaryInM3;outflow+=d.boundaryOutM3;
    for(const f of d.boundaryTransfers){const key=`${f.kind}/${f.from}/${f.to}`,previous=boundaryTotals.get(key);boundaryTotals.set(key,{...f,volumeM3:f.volumeM3+(previous?.volumeM3??0)});}
    for(const f of d.culvertTransfers){const key=`${f.kind}/${f.from}/${f.to}`,previous=pipes.get(key);pipes.set(key,{...f,volumeM3:f.volumeM3+(previous?.volumeM3??0)});}}
  state.diagnostics={...state.diagnostics,initialM3:initial,rainM3:rain,infiltratedM3:infiltration,boundaryInM3:inflow,boundaryOutM3:outflow,balanceErrorM3:state.diagnostics.finalM3-initial-rain+infiltration-inflow+outflow,boundaryTransfers:[...boundaryTotals.values()],culvertTransfers:[...pipes.values()],substeps:steps,stepSeconds:options.seconds/steps};return state;
}
export function runoffFromTerrain(terrain,{bounds=terrain.bounds,cellSizeM,initialWater='source'}={}){
  if(terrain.frame?.kind==='sphere-geographic')throw new TypeError('Runoff requires a fixed metric simulation chart');positiveNumber(cellSizeM,'cellSizeM');
  if(!['source','dry'].includes(initialWater))throw new TypeError('Invalid initial water mode');
  const columns=(bounds.maxXM-bounds.minXM)/cellSizeM,rows=(bounds.maxYM-bounds.minYM)/cellSizeM;
  if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<2||rows<2||columns*rows>131072)throw new RangeError('Runoff bounds must be integral grid cells');
  const groundElevationM=[],waterDepthM=[];
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){const px=bounds.minXM+(x+.5)*cellSizeM,py=bounds.minYM+(y+.5)*cellSizeM,s=terrain.sampleAt(px,py);groundElevationM.push(s.groundElevationM);
    if(initialWater==='source'&&s.waterDepthM==null)throw new TypeError('Source water is unknown; specify an explicit dry scenario or supply water');waterDepthM.push(initialWater==='dry'?0:s.waterDepthM);}
  return{...createRunoffState({columns,rows,cellSizeM,groundElevationM,waterDepthM}),sourceWorldId:terrain.worldId??null,sourceRegionId:terrain.regionId??null,originXM:bounds.minXM,originYM:bounds.minYM,initialWater};
}

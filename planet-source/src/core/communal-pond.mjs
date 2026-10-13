import {WATER_SCHEMA} from './water-model.mjs';
import {createPlanarRiverBed,PLANAR_C1_BED} from './planar-river-bed.mjs';
export const COMMUNAL_POND_POLICY='surveyed-communal-pond@1';
export const ADAPTIVE_COMMUNAL_POND_POLICY='surveyed-communal-pond@2';
/** An explicitly constructed storage pond, not an inferred natural lake.
 * The same compact bed is used for siting and the exported terrain recipe.
 * Supply, seepage and seasonal water balance are not simulated. */
export function planCommunalPond({id,ground,water,occupied=()=>false,policy=COMMUNAL_POND_POLICY}){
 if(policy===ADAPTIVE_COMMUNAL_POND_POLICY)return planAdaptivePond({id,ground,water,occupied});
 if(policy!==COMMUNAL_POND_POLICY)throw new RangeError('Unknown communal pond policy');
 const candidates=[];
 for(const [x,y] of [[-95,65],[95,65],[-95,-65],[95,-65]]){
  const bounds={minXM:x-27,maxXM:x+27,minYM:y-20,maxYM:y+20},heights=[];let valid=true;
  for(let yy=bounds.minYM;yy<=bounds.maxYM;yy+=2)for(let xx=bounds.minXM;xx<=bounds.maxXM;xx+=2){const z=ground(xx,yy);if(!Number.isFinite(z)||water(xx,yy).waterDepthM>0||occupied(xx,yy)){valid=false;break;}heights.push(z);}
  if(valid&&heights.length&&Math.max(...heights)-Math.min(...heights)<=.7)candidates.push({x,y,bounds,low:Math.min(...heights)});
 }
 candidates.sort((a,b)=>a.low-b.low||a.x-b.x||a.y-b.y);const c=candidates[0];if(!c)return null;
 const level=c.low-.2,pondId=`${id}/communal-pond`,nodes=[{id:pondId+'/a',xM:c.x-7,yM:c.y,waterLevelElevationM:level},{id:pondId+'/b',xM:c.x+7,yM:c.y,waterLevelElevationM:level}];
 const model={schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',bed:{method:PLANAR_C1_BED,maxIncisionM:3},nodes,edges:[{id:pondId,from:nodes[0].id,to:nodes[1].id,points:nodes.map(n=>({...n,halfWidthM:8,bankWidthM:8,depthM:1.5}))}],bodies:[],topologyOrder:nodes.map(n=>n.id),basins:null};
 const field=createPlanarRiverBed(model,c.bounds);
 return{id:pondId,model,bounds:c.bounds,center:{xM:c.x,yM:c.y},waterLevelElevationM:level,sample:(x,y)=>{const v=field.sample(x,y,ground(x,y)),existing=water(x,y),waterLevelElevationM=v.waterLevelElevationM??existing.waterLevelElevationM??null;return{...v,waterLevelElevationM,waterSourceIds:v.waterLevelElevationM==null?(existing.waterSourceIds??[]):v.waterSourceIds,waterDepthM:waterLevelElevationM==null?0:Math.max(0,waterLevelElevationM-v.groundElevationM)};},limitations:['Constructed storage pond under an explicit communal scenario','No supply, seepage or seasonal water balance simulation']};
}

/** Search modest storage-pond footprints near the settlement rather than four
 * hardcoded, almost perfectly flat pads. The bed is excavated, never a blue
 * rectangle draped over a slope. A maintained water supply is a declared
 * scenario, not a conclusion drawn from the terrain survey. */
function planAdaptivePond({id,ground,water,occupied}){
 const candidates=[],memo=new Map();let samples=0;
 const inspect=(x,y)=>{const key=x+','+y;if(memo.has(key))return memo.get(key);samples++;const z=ground(x,y),s=water(x,y),v={z,safe:Number.isFinite(z)&&s.waterDepthM===0&&!occupied(x,y)};memo.set(key,v);return v;};
 for(let y=-160;y<=160;y+=40)for(let x=-160;x<=160;x+=40){
  if((Math.hypot(x,y)<65||Math.hypot(x,y)>145)||Math.abs(x)<20||Math.abs(y)<20)continue;
  const p=inspect(x,y),around=[inspect(x-10,y),inspect(x+10,y),inspect(x,y-10),inspect(x,y+10)];
  if(!p.safe||around.some(v=>!v.safe))continue;
  const relief=Math.max(p.z,...around.map(v=>v.z))-Math.min(p.z,...around.map(v=>v.z));
  candidates.push({x,y,score:relief*100+Math.hypot(x,y)*.05});
 }
 candidates.sort((a,b)=>a.score-b.score||a.y-b.y||a.x-b.x);
 const sizes=[{halfLengthM:7,halfWidthM:8,bankWidthM:8,depthM:1.5},{halfLengthM:5,halfWidthM:6,bankWidthM:6,depthM:1.3},{halfLengthM:3,halfWidthM:4,bankWidthM:5,depthM:1}];
 for(const c of candidates.slice(0,24))for(const size of sizes){
  const hx=size.halfLengthM+size.halfWidthM+size.bankWidthM+2,hy=size.halfWidthM+size.bankWidthM+2,bounds={minXM:c.x-hx,maxXM:c.x+hx,minYM:c.y-hy,maxYM:c.y+hy};
  if(bounds.minXM< -190||bounds.maxXM>190||bounds.minYM< -220||bounds.maxYM>220)continue;
  const nx=Math.ceil(2*hx/2),ny=Math.ceil(2*hy/2),heights=[];let valid=true;
  for(let j=0;j<=ny&&valid;j++)for(let i=0;i<=nx;i++){const s=inspect(bounds.minXM+2*hx*i/nx,bounds.minYM+2*hy*j/ny);if(!s.safe){valid=false;break;}heights.push(s.z);}
  if(!valid)continue;
  const low=Math.min(...heights),high=Math.max(...heights),level=low-.2,requiredIncisionM=high-level+size.depthM;
  if(requiredIncisionM>2.9)continue;
  const pondId=id+'/communal-pond',nodes=[{id:pondId+'/a',xM:c.x-size.halfLengthM,yM:c.y,waterLevelElevationM:level},{id:pondId+'/b',xM:c.x+size.halfLengthM,yM:c.y,waterLevelElevationM:level}];
  const model={schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',bed:{method:PLANAR_C1_BED,maxIncisionM:3},nodes,edges:[{id:pondId,from:nodes[0].id,to:nodes[1].id,points:nodes.map(n=>({...n,halfWidthM:size.halfWidthM,bankWidthM:size.bankWidthM,depthM:size.depthM}))}],bodies:[],topologyOrder:nodes.map(n=>n.id),basins:null};
  const field=createPlanarRiverBed(model,bounds);
  return{id:pondId,model,bounds,center:{xM:c.x,yM:c.y},waterLevelElevationM:level,survey:{method:ADAPTIVE_COMMUNAL_POND_POLICY,candidateBudget:24,groundSamples:samples,reliefM:high-low,requiredIncisionM,dimensions:size},sample:(x,y)=>{const v=field.sample(x,y,ground(x,y)),existing=water(x,y),waterLevelElevationM=v.waterLevelElevationM??existing.waterLevelElevationM??null;return{...v,waterLevelElevationM,waterSourceIds:v.waterLevelElevationM==null?(existing.waterSourceIds??[]):v.waterSourceIds,waterDepthM:waterLevelElevationM==null?0:Math.max(0,waterLevelElevationM-v.groundElevationM)};},limitations:['Constructed communal storage under an explicit maintained-water scenario; not a natural pond','Supply, seepage and seasonal water balance are not simulated','Two-metre finite terrain survey, not a continuous ground certificate']};
 }
 return null;
}

export const DEFERRED_POPULATION='on-reference-population@1';
import {copyJson} from './json-contract.mjs';
const TYPES=[['ruralPopulation','villages'],['townPopulation','towns'],['cityPopulation','cities']];
const radians=Math.PI/180;
function integer(n){if(!Number.isSafeInteger(n)||n<0||n>1e10)throw new RangeError('Invalid population zone budget');return n;}
function validate(zone){
 integer(zone.population);let sum=0;for(const [people,count]of TYPES){integer(zone[people]);integer(zone[count]);if((zone[people]===0)!==(zone[count]===0)||zone[count]>zone[people])throw new RangeError('Inconsistent settlement budget');sum+=zone[people];}
 if(sum!==zone.population)throw new RangeError('Zone population does not match its parts');
 const b=zone.bounds;if(!b||![b.west,b.east,b.south,b.north].every(Number.isFinite)||b.west<0||b.east>360||b.east<=b.west||b.south< -90||b.north>90||b.north<=b.south)throw new RangeError('Invalid zone bounds');
 if(typeof zone.id!=='string'||zone.id.length>512||!Number.isInteger(zone.depth)||zone.depth<0||zone.depth>24)throw new RangeError('Invalid zone identity');
}
/** Root regions reuse the actual saved census. They are distributions, not a
 * second census and not lists of instantiated villages or people. */
export function populationRootZone(population,cellIndex){
 const {columns:w,rows:h}=population.grid,c=population.cells[cellIndex];
 if(!c||c.cellIndex!==cellIndex||!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||cellIndex>=w*h)throw new RangeError('Invalid population root');
 const row=Math.floor(cellIndex/w),col=cellIndex%w;
 const zone={id:`population-zone:${cellIndex}`,rootCell:cellIndex,depth:0,bounds:{west:col*360/w,east:(col+1)*360/w,north:90-row*180/h,south:90-(row+1)*180/h},population:c.population,...Object.fromEntries(TYPES.flatMap(([p,n])=>[[p,c[p]],[n,c[n]]]))};validate(zone);return zone;
}
export function populationChildBounds(zone){
 validate(zone);if(zone.depth>=24)throw new RangeError('Population zone depth budget');
 const {west,east,south,north}=zone.bounds,x=(west+east)/2,
 y=Math.asin((Math.sin(south*radians)+Math.sin(north*radians))/2)/radians;
 return[{west,east:x,south:y,north},{west:x,east,south:y,north},{west,east:x,south,north:y},{west:x,east,south,north:y}];
}
/** Exact integer apportionment, without rounding drift at billions of people.
 * Quantized weights are a declared placement preference, not measured capacity. */
function allocate(total,weights){
 const sum=weights.reduce((s,n)=>s+BigInt(n),0n);if(sum===0n)return [0,0,0,0];
 const terms=weights.map((w,i)=>{const v=BigInt(total)*BigInt(w);return{i,n:Number(v/sum),r:v%sum};});
 let left=total-terms.reduce((s,x)=>s+x.n,0);for(const t of [...terms].sort((a,b)=>a.r===b.r?a.i-b.i:a.r>b.r?-1:1)){if(!left)break;t.n++;left--;}
 return terms.map(t=>t.n);
}
export function splitPopulationZone(zone,weights){
 const bounds=populationChildBounds(zone);
 if(!Array.isArray(weights)||weights.length!==4||!weights.every(n=>Number.isInteger(n)&&n>=0&&n<=1000000))throw new RangeError('Four integer suitability weights required');
 const children=bounds.map((b,i)=>({id:`${zone.id}/${i}`,rootCell:zone.rootCell,depth:zone.depth+1,bounds:b,population:0,...Object.fromEntries(TYPES.flatMap(([p,n])=>[[p,0],[n,0]]))}));
 for(const [people,count]of TYPES){
  const counts=allocate(zone[count],weights),small=zone[count]?Math.floor(zone[people]/zone[count]):0,extra=zone[count]?zone[people]%zone[count]:0;let offset=0;
  for(let i=0;i<4;i++){const n=counts[i],p=small*n+Math.max(0,Math.min(n,extra-offset));children[i][count]=n;children[i][people]=p;children[i].population+=p;offset+=n;}
 }
 children.forEach(validate);
 return{schema:'population-zone-split@1',parentId:zone.id,weights:[...weights],children,unallocatedPopulation:zone.population-children.reduce((s,c)=>s+c.population,0),interpretation:'Estimated settlement distribution. Weights are relative suitability, not a certified local food capacity.'};
}
export function containsPopulationZone(zone,latDeg,lonDeg){
 if(!Number.isFinite(latDeg)||!Number.isFinite(lonDeg)||latDeg< -90||latDeg>90)return false;
 const lon=((lonDeg%360)+360)%360,b=zone.bounds;
 return lon>=b.west&&lon<b.east&&latDeg<=b.north&&(latDeg>b.south||(b.south===-90&&latDeg===-90));
}
export function populationZoneAreaM2(zone,radiusM){if(!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('Invalid sphere radius');const b=zone.bounds;return radiusM**2*(b.east-b.west)*radians*(Math.sin(b.north*radians)-Math.sin(b.south*radians));}
/** Persist all four siblings together before choosing the requested child.
 * Survey can use new algorithms/randomness; once saved, it is not called again.
 * Geometry LOD is deliberately absent from this API. */
export class PopulationZoneHierarchy{
 constructor(population,materializer,{survey,conditions={}}={}){if(!materializer||typeof survey!=='function')throw new TypeError('Persistent materializer and zone survey required');this.population=population;this.materializer=materializer;this.survey=survey;this.conditions=copyJson(conditions);}
 root(i){return populationRootZone(this.population,i);}
 async split(zone,signal){validate(zone);return this.materializer.resolve({worldId:`${this.population.sourceWorldId}/${this.population.id}`,entityId:zone.id,conditions:{populationId:this.population.id,zone,environment:this.conditions},generator:'population-zone-distribution@1',signal,generate:async()=>splitPopulationZone(zone,await this.survey(populationChildBounds(zone),zone,signal))});}
 async at(cellIndex,latDeg,lonDeg,depth,{signal}={}){
  if(!Number.isInteger(depth)||depth<0||depth>24)throw new RangeError('Invalid requested population depth');
  let zone=this.root(cellIndex);if(!containsPopulationZone(zone,latDeg,lonDeg))throw new RangeError('Reference is outside population root');
  const ancestry=[];while(zone.depth<depth){const split=await this.split(zone,signal);ancestry.push({parentId:zone.id,unallocatedPopulation:split.unallocatedPopulation});if(split.unallocatedPopulation)return{zone,status:'unallocated',ancestry};zone=split.children.find(c=>containsPopulationZone(c,latDeg,lonDeg));if(!zone)throw new Error('Population partition has a gap');}
  return{zone,status:'distribution-only',ancestry};
 }
}

/** Nine area-distributed samples per child. Uses the same saved coarse food
 * suitability plus local wetness/slope. This is a siting preference, not a new
 * population count, flood safety claim or a complete soil/irrigation model. */
export function surveyPopulationZoneWeights(base,population,bounds){
 if(base.worldId!==population.sourceWorldId)throw new Error('Population survey geography mismatch');
 const {columns:w,rows:h}=population.grid,R=base.frame.radiusM;
 return bounds.map(b=>{let sum=0;for(let y=0;y<3;y++)for(let x=0;x<3;x++){
  const latDeg=Math.asin(Math.sin(b.south*radians)+(Math.sin(b.north*radians)-Math.sin(b.south*radians))*(y+.5)/3)/radians,lonDeg=b.west+(b.east-b.west)*(x+.5)/3;
  const s=base.sampleSurfaceAt(latDeg,lonDeg);if(s.waterDepthM>0||!Number.isFinite(s.groundElevationM))continue;
  const step=30/R/radians,north=Math.min(90,latDeg+step),east=lonDeg+step/Math.max(.01,Math.cos(latDeg*radians));
  const grade=Math.hypot((base.groundElevationAt(north,lonDeg)-s.groundElevationM)/30,(base.groundElevationAt(latDeg,east)-s.groundElevationM)/30);
  const row=Math.min(h-1,Math.floor((90-latDeg)/180*h)),col=Math.floor(((lonDeg%360+360)%360)/360*w),suitability=population.cells[row*w+col]?.suitability??0;
  sum+=Math.max(0,Math.min(1,suitability))*Math.max(0,1-grade/.12);
 }return Math.round(sum/9*1000000);});
}

export {validate as validatePopulationZone};

/** One placement partition for a world. Zoom may display coarser/finer census
 * zones, but must not create overlapping parent and child settlement plans. */
export function isLocalPopulationZone(zone,radiusM){
 const b=zone.bounds,spanM=Math.max(b.north-b.south,(b.east-b.west)*Math.cos((b.north+b.south)*Math.PI/360))*Math.PI/180*radiusM;
 return(spanM<=32000&&zone.villages+zone.towns+zone.cities<=512)||zone.depth>=12;
}

import {BIOMES} from './planet-climate.mjs';
import {hashJson} from './json-contract.mjs';
import {greatCircle} from './spherical.mjs';
export const TERRITORY_SCENARIO='provisional-territorial-access@1';
/** Read a saved regional assignment without generating settlements or geometry.
 * The result is provisional control, never a deed or household ownership. */
export function territoryAt(scenario,{latDeg,lonDeg}){
 if(!Number.isFinite(latDeg)||latDeg< -90||latDeg>90||!Number.isFinite(lonDeg))throw new RangeError('Finite geographic coordinates required');
 const w=scenario?.grid?.columns,h=scenario?.grid?.rows;
 if(scenario?.method!==TERRITORY_SCENARIO||!Number.isInteger(w)||!Number.isInteger(h)||w<4||h<2||w*h>32768||scenario.owner?.length!==w*h||!Array.isArray(scenario.territories))throw new Error('Invalid saved territory scenario');
 const row=Math.min(h-1,Math.floor((90-latDeg)/180*h)),column=Math.floor(((lonDeg%360+360)%360)/360*w),cellIndex=row*w+column,owner=scenario.owner[cellIndex];
 if(!Number.isInteger(owner)||owner< -1||owner>=scenario.territories.length)throw new Error('Invalid saved territory owner');
 const territory=owner<0?null:scenario.territories[owner];
 if(territory&&typeof territory.id!=='string')throw new Error('Missing saved territory ID');
 return{scenarioId:scenario.id,sourceWorldId:scenario.sourceWorldId,cellIndex,territoryId:territory?.id??null,territoryName:territory?.name??null,relation:'provisional-territorial-control',resolution:'regional-cell',status:territory?'assigned':'unassigned-or-water'};
}
/** Optional political scenario over existing regional cells, not historical
 * fact, parcel ownership, or a change to physical terrain. No camera inputs.
 * Capitals compete over connected dry land; unseeded islands stay unassigned. */
export function createTerritoryScenario(climate,population,{count=24,radiusM=6371000}={}){
 const {columns:w,rows:h}=climate.grid,n=w*h;
 if(!Number.isInteger(w)||!Number.isInteger(h)||w<4||h<2||n>32768||!Number.isInteger(count)||count<1||count>64||!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('Invalid bounded territory scenario');
 if(!population||population.climateId!==climate.id||population.sourceWorldId!==climate.sourceWorldId||population.cells.length!==n||climate.biome.length!==n)throw new Error('Matching climate and population required');
 if(climate.biome.some(b=>!Object.hasOwn(BIOMES,b)))throw new Error('Unknown biome cannot imply territorial land');
 const dry=climate.biome.map(b=>b!=='ocean'&&b!=='lake'),point=i=>({latDeg:90-(Math.floor(i/w)+.5)*180/h,lonDeg:(i%w+.5)*360/w});
 if(population.grid&&(population.grid.columns!==w||population.grid.rows!==h))throw new Error('Territory grid mismatch');
 const eligible=population.cells.filter((c,i)=>dry[i]&&c.population>0);
 for(let i=0;i<n;i++)if(population.cells[i].cellIndex!==i||!Number.isFinite(population.cells[i].population)||population.cells[i].population<0||!Number.isFinite(population.cells[i].suitability)||population.cells[i].suitability<0||population.cells[i].suitability>1)throw new Error('Invalid population cell');
 const seeds=[],nearest=new Float64Array(n).fill(Infinity);
 for(let k=0;k<Math.min(count,eligible.length);k++){
  let chosen=null,best=-1;
  for(const c of eligible){if(seeds.includes(c.cellIndex))continue;const score=k?nearest[c.cellIndex]*Math.log1p(c.population):c.population;if(score>best){best=score;chosen=c.cellIndex;}}
  if(chosen==null)break;seeds.push(chosen);for(const c of eligible)nearest[c.cellIndex]=Math.min(nearest[c.cellIndex],greatCircle(point(chosen),point(c.cellIndex),radiusM).distanceM);
 }
 const owner=new Int32Array(n).fill(-1),cost=new Float64Array(n).fill(Infinity),heap=[];
 const less=(a,b)=>a.cost<b.cost||a.cost===b.cost&&(a.owner<b.owner||a.owner===b.owner&&a.i<b.i);
 function push(v){let i=heap.length;heap.push(v);while(i){const p=(i-1)>>1;if(!less(v,heap[p]))break;heap[i]=heap[p];i=p;}heap[i]=v;}
 function pop(){const v=heap[0],last=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let j=i*2+1;if(j+1<heap.length&&less(heap[j+1],heap[j]))j++;if(!less(heap[j],last))break;heap[i]=heap[j];i=j;}heap[i]=last;}return v;}
 seeds.forEach((i,k)=>{owner[i]=k;cost[i]=0;push({i,owner:k,cost:0});});
 const neighbours=i=>{const y=Math.floor(i/w),x=i%w;return[y*w+(x+w-1)%w,y*w+(x+1)%w,...(y?[i-w]:[]),...(y<h-1?[i+w]:[])];};
 let visited=0;
 while(heap.length){const q=pop();if(q.cost!==cost[q.i]||q.owner!==owner[q.i])continue;visited++;
  for(const j of neighbours(q.i)){if(!dry[j])continue;
   // Suitability is only a provisional access proxy; not a road/war simulation.
   const edge=greatCircle(point(q.i),point(j),radiusM).distanceM*(1+2*(1-(population.cells[q.i].suitability+population.cells[j].suitability)/2)),next=q.cost+edge;
   if(next<cost[j]||next===cost[j]&&q.owner<owner[j]){cost[j]=next;owner[j]=q.owner;push({i:j,owner:q.owner,cost:next});}
  }
 }
 const prefix=hashJson({method:TERRITORY_SCENARIO,world:climate.sourceWorldId,climate:climate.id,population:population.id,count,radiusM}).slice(7,19);
 const territories=seeds.map((i,k)=>({id:`realm:${prefix}:${i}`,name:`領域 ${k+1}`,capitalCellIndex:i,...point(i),population:0,cells:0}));
 for(let i=0;i<n;i++)if(owner[i]>=0){territories[owner[i]].population+=population.cells[i].population;territories[owner[i]].cells++;}
 const boundaries=[];for(let i=0;i<n;i++){const y=Math.floor(i/w),x=i%w;for(const j of [y*w+(x+1)%w,...(y<h-1?[i+w]:[])])if(dry[i]&&dry[j]&&owner[i]!==owner[j])boundaries.push({a:i,b:j,left:owner[i],right:owner[j]});}
 const data={method:TERRITORY_SCENARIO,sourceWorldId:climate.sourceWorldId,climateId:climate.id,populationId:population.id,grid:{columns:w,rows:h},settings:{count,radiusM},territories,owner:Array.from(owner),boundaries,diagnostics:{visited,unassignedDryCells:dry.filter((v,i)=>v&&owner[i]<0).length},limitations:['Provisional territorial control, not simulated history or household ownership','Coarse cell borders; no surveyed local boundary','No sea transport, war, vassal hierarchy, overlapping claims or taxation']};return {...data,id:hashJson(data)};
}

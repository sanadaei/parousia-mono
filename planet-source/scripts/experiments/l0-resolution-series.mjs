import {createPlanetMacroSampler} from '../../src/core/planet-macro.mjs';
import {derivePlanetHydrology} from '../../src/core/planet-hydrology.mjs';
import {hashJson} from '../../src/core/json-contract.mjs';
/** Explicit, bounded generation stages. Viewing a level never regenerates it.
 * Shared recipe is inherited; drainage connectivity is NOT yet constrained
 * by the previous stage. The resulting objects are planning data, not worlds.
 */
export function createL0ResolutionSeries(snapshot,{levels=3,beforeLevel=()=>{}}={}){
 const {columns:baseW,rows:baseH}=snapshot.grid??{};
 if(!Number.isSafeInteger(baseW)||!Number.isSafeInteger(baseH)||baseW<16||baseH<8||!Number.isSafeInteger(levels)||levels<1||levels>5||baseW*baseH*4**(levels-1)>131072)throw new RangeError('Resolution series exceeds bounded 131072-cell planning budget');
 const radiusM=snapshot.frame?.radiusM,seaLevelM=snapshot.references?.sea?.levelElevationM,recipe=snapshot.references?.macroRecipe;
 if(typeof snapshot.worldId!=='string'||!snapshot.worldId)throw new RangeError('Parent world identity required');
 const sample=createPlanetMacroSampler(recipe,{radiusM,seaLevelM});
 const cases=[];let parentId=snapshot.worldId;
 for(let stage=0;stage<levels;stage++){
  beforeLevel({stage,columns:baseW*2**stage,rows:baseH*2**stage});
  const columns=baseW*2**stage,rows=baseH*2**stage,started=performance.now();
  const elevation=Array.from({length:columns*rows},(_,i)=>sample({latDeg:90-(Math.floor(i/columns)+.5)*180/rows,lonDeg:(i%columns+.5)*360/columns}));
  for(const row of [0,rows-1]){const mean=elevation.slice(row*columns,(row+1)*columns).reduce((a,z)=>a+z/columns,0);for(let x=0;x<columns;x++)elevation[row*columns+x]=mean;}
  const water=derivePlanetHydrology({elevation,columns,rows,seaLevelM,lakeFillFraction:.2,routingMode:'steepest-filled'});
  const area=Array.from({length:columns*rows},(_,i)=>{const y=Math.floor(i/columns);return radiusM**2*2*Math.PI/columns*(Math.sin((90-y*180/rows)*Math.PI/180)-Math.sin((90-(y+1)*180/rows)*Math.PI/180));});
  const incoming=Array(area.length).fill(0),queue=[],upstreamAreaM2=area.map((v,i)=>water.oceanCells[i]?0:v);
  for(const j of water.downstream)if(j>=0)incoming[j]++;
  for(let i=0;i<area.length;i++)if(!incoming[i])queue.push(i);
  for(let k=0;k<queue.length;k++){const i=queue[k],j=water.downstream[i];if(j>=0){upstreamAreaM2[j]+=upstreamAreaM2[i];if(!--incoming[j])queue.push(j);}}
  if(queue.length!==area.length)throw Error('Cyclic stage drainage');
  const content={schema:'l0-resolution-level@1',stage,sourceWorldId:snapshot.worldId,parentId,columns,rows,elevation,water,upstreamAreaM2};
  const id=hashJson(content);cases.push({...content,id,measurement:{elapsedMs:performance.now()-started,heapUsedMiB:process.memoryUsage().heapUsed/1048576,rssMiB:process.memoryUsage().rss/1048576}});parentId=id;
 }
 return {schema:'l0-resolution-series@1',sourceWorldId:snapshot.worldId,recipe,cases,status:'progressive macro sampling; drainage topology recomputed per stage',limits:['Parent recipe and sea threshold remain fixed','Parent drainage topology is not yet inherited','Not driven by camera zoom','No settlements or local terrain generated','Climate-dependent discharge not calculated; area is not flow'],id:hashJson({sourceWorldId:snapshot.worldId,levelIds:cases.map(c=>c.id)})};
}

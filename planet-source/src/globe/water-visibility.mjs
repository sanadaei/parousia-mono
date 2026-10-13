import {usesWaterFirst} from '../core/water-first-population-region.mjs';
/** Water is an overlay above the bed, not part of its ground-error interval.
 * Saved manifests are immutable. Latitude envelopes deliberately overinclude
 * longitude: they cannot hide a lake across the date line or at a pole. */
const envelopes=new WeakMap();
export function waterVisibilityUpperBound(manifest,bound){
 let saved=envelopes.get(manifest);
 if(!saved){
  const rows=manifest.base.grid.rows,columns=manifest.base.grid.columns;
  const lakes=(manifest.lakes??[]).map(lake=>{
   let low=Infinity,high=-Infinity;
   for(const cell of lake.cells??[]){const y=Math.floor(cell/columns);low=Math.min(low,Math.PI/2-(y+2)*Math.PI/rows);high=Math.max(high,Math.PI/2-(y-1)*Math.PI/rows);}
   return {low,high,level:lake.levelElevationM};
  });
  // A river water profile interpolates between its saved endpoint levels.
  // Missing spatial metadata uses a global bound rather than dropping water.
  const rivers=(manifest.rivers?.profiles??[]).map((profile,i)=>({descriptor:manifest.riverDescriptors?.length===manifest.rivers.profiles.length?manifest.riverDescriptors[i]:null,level:Math.max(-Infinity,...profile.points.map(p=>p.waterLevelElevationM))}));
  const ponds=(manifest.localPonds?.bodies??[]).map(p=>{const latitude=p.projection.centerLatDeg*Math.PI/180,b=p.bounds,extent=Math.hypot(Math.max(Math.abs(b.minXM),Math.abs(b.maxXM)),Math.max(Math.abs(b.minYM),Math.abs(b.maxYM)))/manifest.base.frame.radiusM;return{low:latitude-extent,high:latitude+extent,level:p.levelElevationM};});
  saved={lakes,rivers,ponds};envelopes.set(manifest,saved);
 }
 let upper=manifest.sea?.levelElevationM??-Infinity;
 if(usesWaterFirst(manifest.settlementCatalogue?.waterMaterializationPolicy))upper=Math.max(upper,(manifest.elevationRangeM?.[1]??Infinity)+.05);
 const latitude=Math.asin(Math.max(-1,Math.min(1,bound.center[2])));
 for(const lake of [...saved.lakes,...saved.ponds])if(latitude+bound.angular+1e-8>=lake.low&&latitude-bound.angular-1e-8<=lake.high)upper=Math.max(upper,lake.level);
 for(const river of saved.rivers){const d=river.descriptor;if(!d||Math.acos(Math.max(-1,Math.min(1,bound.center.reduce((sum,v,i)=>sum+v*d.center[i],0))))<=bound.angular+d.angularRadius+1e-8)upper=Math.max(upper,river.level);}
 return upper;
}

/** Prove that every interpolation patch intersecting a spherical cap selects
 * one constant, wet reservoir. Unknown / legacy / mixed patches stay unknown.
 * This is a region check, not a centre-point water sample. */
export function uniformReservoir(manifest,bound,groundMaximum){
 if(usesWaterFirst(manifest.settlementCatalogue?.waterMaterializationPolicy))return null;
 if(!envelopes.has(manifest))waterVisibilityUpperBound(manifest,bound);
 const saved=envelopes.get(manifest),grid=manifest.base.grid,w=grid.columns,h=grid.rows;
 if(!Number.isInteger(w)||!Number.isInteger(h)||!Number.isFinite(groundMaximum))return null;
 if(!saved.cells){saved.cells=new Map();saved.modern=true;for(const lake of manifest.lakes??[]){if(lake.membershipMethod!=='interpolation-support@1')saved.modern=false;for(const cell of lake.cells)saved.cells.set(cell,lake);}}
 if(!saved.modern)return null;
 const lat=Math.asin(Math.max(-1,Math.min(1,bound.center[2]))),a=bound.angular+1e-10;
 if(Math.abs(lat)+a>=Math.PI/2)return null;
 if(saved.ponds.some(p=>lat+a>=p.low&&lat-a<=p.high))return null;
 const dl=Math.asin(Math.min(1,Math.sin(a)/Math.cos(lat))),lon=Math.atan2(bound.center[1],bound.center[0]);
 const x0=Math.floor((lon-dl)/(2*Math.PI)*w-.5),x1=Math.floor((lon+dl)/(2*Math.PI)*w-.5);
 const y0=Math.floor(Math.max(0,Math.min(h-1,(Math.PI/2-lat-a)/Math.PI*h-.5))),y1=Math.floor(Math.max(0,Math.min(h-1,(Math.PI/2-lat+a)/Math.PI*h-.5)));
 if((x1-x0+1)*(y1-y0+1)>64)return null;
 let result=null;
 for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
  const candidates=new Set();for(const yy of [y,Math.min(h-1,y+1)])for(const xx of [x,x+1]){const lake=saved.cells.get(yy*w+(xx%w+w)%w);if(lake)candidates.add(lake);}
  // Even dry neighbours can become wet within the cap. Do not resolve mixed
  // lake supports using a single sampled ground height.
  if(candidates.size>1)return null;
  const reservoir=candidates.size?[...candidates][0]:manifest.sea;
  if(!reservoir||!(groundMaximum<reservoir.levelElevationM))return null;
  const value={levelElevationM:reservoir.levelElevationM,sourceId:reservoir.id};
  if(result&&(result.levelElevationM!==value.levelElevationM||result.sourceId!==value.sourceId))return null;result=value;
 }
 if(!result)return null;
 for(const river of saved.rivers){const d=river.descriptor,overlaps=!d||Math.acos(Math.max(-1,Math.min(1,bound.center.reduce((sum,v,i)=>sum+v*d.center[i],0))))<=bound.angular+d.angularRadius+1e-8;if(overlaps&&river.level>result.levelElevationM)return null;}
 return result;
}

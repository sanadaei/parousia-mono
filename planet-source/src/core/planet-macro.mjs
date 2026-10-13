import {createSphericalNoise} from './spherical-noise.mjs';
import {sphereBasis} from './spherical.mjs';
import {describeSettlementDistribution} from './settlement-distribution.mjs';
export const EARTHLIKE_L0='earthlike-l0@1';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
/** Statistical Earthlike geography. These are explicit game-world priors, not
 * tectonic simulation. Keep coastal continentality separate from uplift so
 * that continental interiors are not automatically kilometre-high plateaus. */
export function createPlanetMacroTerrain({seed,columns,rows,radiusM,seaLevelM=0,landFraction=.33}){
 if(typeof seed!=='string'||!seed.trim()||!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<16||rows<8||columns*rows>32768||!Number.isFinite(radiusM)||radiusM<=0||!Number.isFinite(seaLevelM)||!Number.isFinite(landFraction)||landFraction<.1||landFraction>.7)throw new RangeError('Invalid bounded L0 recipe');
 const n=columns*rows,noise=(name,scale)=>createSphericalNoise(seed+'/'+name,radiusM,radiusM/scale),continent=noise('continents',2.6),coast=noise('coast-shape',9),mountain=noise('mountains',9),province=noise('uplift-province',4),lowland=noise('lowland',13);
 const vectors=Array.from({length:n},(_,i)=>sphereBasis({latDeg:90-(Math.floor(i/columns)+.5)*180/rows,lonDeg:(i%columns+.5)*360/columns}).up);
 const weights=vectors.map((_,i)=>Math.cos((Math.floor(i/columns)+.5)*Math.PI/rows-Math.PI/2)),total=weights.reduce((s,v)=>s+v,0),continentality=vectors.map(v=>.86*continent(v)+.14*coast(v));
 const ranked=continentality.map((v,i)=>({v,i})).sort((a,b)=>a.v-b.v||a.i-b.i);let area=0,shoreThreshold=0;
 for(const {v,i} of ranked){area+=weights[i];if(area>=total*(1-landFraction)){shoreThreshold=v;break;}}
 const elevation=continentality.map((v,i)=>{
  const d=v-shoreThreshold;if(d<=0)return seaLevelM-5000*(1-Math.exp(d*5));
  const inland=clamp(d/.4),belt=Math.exp(-((mountain(vectors[i])/.17)**2)),uplift=clamp((province(vectors[i])+.35)/.6),coastalFade=clamp(d/.1);
  return seaLevelM+(60+380*inland**1.3+Math.max(0,lowland(vectors[i]))*180+4300*belt*uplift**2)*coastalFade;
 });
 // One polar cap value, independent of longitude. Resolution is saved source
 // discretisation, never driven by camera zoom.
 for(const row of [0,rows-1]){const mean=elevation.slice(row*columns,(row+1)*columns).reduce((s,v)=>s+v/columns,0);for(let x=0;x<columns;x++)elevation[row*columns+x]=mean;}
 const emerged=weights.reduce((s,a,i)=>s+(elevation[i]>seaLevelM?a:0),0)/total;
 return{elevation,recipe:{schema:EARTHLIKE_L0,climateModel:'earthlike-zonal@2',seed,landFractionTarget:landFraction,emergedLandFraction:emerged,shoreThreshold,sourceGrid:{columns,rows},assumptions:['area-weighted continental threshold','separate lowland and regional uplift fields','static prescribed lake filling, not an equilibrium water balance'],limits:['not plate tectonics','source resolution is fixed when the world is created','no settlement or local channel positions fixed by L0']}};
}
/** Read-only parent evidence for a region. A raster sample is a coarse trend,
 * not a claim that every point in that cell shares that elevation or biome.
 * This contract describes inputs; it does not pretend an L1 solver exists. */
export function describeL0Region(snapshot,climate,cellIndices,settlementDistribution){
 const {columns,rows}=snapshot.grid,n=columns*rows;
 if(climate.sourceWorldId!==snapshot.worldId||climate.grid.columns!==columns||climate.grid.rows!==rows||!Array.isArray(cellIndices)||!cellIndices.length||cellIndices.length>n||new Set(cellIndices).size!==cellIndices.length||cellIndices.some(i=>!Number.isSafeInteger(i)||i<0||i>=n))throw new RangeError('L0 region requires matching unique source cells');
 const cells=[...cellIndices].sort((a,b)=>a-b),range=a=>{let min=Infinity,max=-Infinity;for(const i of cells){min=Math.min(min,a[i]);max=Math.max(max,a[i]);}return{min,max};},biomeAreaM2={};
 for(const i of cells)biomeAreaM2[climate.biome[i]]=(biomeAreaM2[climate.biome[i]]??0)+climate.cellAreaM2[i];
 const region={schema:'l0-region-conditions@1',sourceWorldId:snapshot.worldId,climateId:climate.id,cellIndices:cells,sourceGrid:{columns,rows},areaM2:cells.reduce((s,i)=>s+climate.cellAreaM2[i],0),fixed:{radiusM:snapshot.frame.radiusM,verticalDatum:snapshot.frame.verticalDatum??snapshot.frame.sourceVerticalDatum,seaLevelM:snapshot.references.sea.levelElevationM},coarseEvidence:{groundElevationM:range(snapshot.fields.groundElevationM),annualMeanTemperatureC:range(climate.annualMeanTemperatureC),annualPrecipitationMm:range(climate.annualPrecipitationMm),biomeAreaM2},unresolved:['subcell terrain and shoreline geometry','minor streams and groundwater','local biome mixtures','settlement sites and roads'],refinementRules:['preserve already committed neighbour boundaries and receiving waters','do not interpret sampled extrema as hard bounds on every local point','derive local detail before settlement placement','commit choices before publication; replay without regeneration'],solverStatus:'parent evidence only; regional constraint solver is separate'};
 if(settlementDistribution===undefined)return region;
 // A supplied distribution must describe this same world, climate and grid before
 // its aggregate budget can be attached. Settlement sites and roads stay unresolved.
 if(settlementDistribution.layer!=='L0'||settlementDistribution.sourceWorldId!==snapshot.worldId||settlementDistribution.climateId!==climate.id||settlementDistribution.grid?.columns!==columns||settlementDistribution.grid?.rows!==rows)throw new RangeError('Settlement distribution must be an L0 distribution matching this world, climate and grid');
 const described=describeSettlementDistribution(settlementDistribution,cells);
 return{...region,settlementBudget:{...described.budgets,populatedCells:described.populatedCells,layer:described.layer,distributionId:settlementDistribution.id},status:'terrain, climate and settlement budget evidence; sites and roads unresolved'};
}

/** Evaluate the frozen macro recipe for a separate, bounded hydrology plan.
 * Keeps the saved shoreline threshold instead of recomputing land quantiles
 * at a new resolution. This is a coarse prior, not committed local terrain.
 */
export function createPlanetMacroSampler(recipe,{radiusM,seaLevelM=0}){
 if(recipe?.schema!==EARTHLIKE_L0||typeof recipe.seed!=='string'||!recipe.seed.trim()||!Number.isFinite(recipe.shoreThreshold)||!Number.isFinite(radiusM)||radiusM<=0||!Number.isFinite(seaLevelM))throw new RangeError('Frozen supported macro recipe required');
 const noise=(name,scale)=>createSphericalNoise(recipe.seed+'/'+name,radiusM,radiusM/scale),continent=noise('continents',2.6),coast=noise('coast-shape',9),mountain=noise('mountains',9),province=noise('uplift-province',4),lowland=noise('lowland',13);
 return ({latDeg,lonDeg})=>{
  if(!Number.isFinite(latDeg)||latDeg< -90||latDeg>90||!Number.isFinite(lonDeg))throw new RangeError('Valid geographic point required');
  const vector=sphereBasis({latDeg,lonDeg}).up,v=.86*continent(vector)+.14*coast(vector),d=v-recipe.shoreThreshold;
  if(d<=0)return seaLevelM-5000*(1-Math.exp(d*5));
  const inland=clamp(d/.4),belt=Math.exp(-((mountain(vector)/.17)**2)),uplift=clamp((province(vector)+.35)/.6),coastalFade=clamp(d/.1);
  return seaLevelM+(60+380*inland**1.3+Math.max(0,lowland(vector))*180+4300*belt*uplift**2)*coastalFade;
 };
}

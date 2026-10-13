import {copyJson,hashJson} from './json-contract.mjs';
import {createSettlementSizePolicy, settlementStableUnit, settlementCountFor} from './settlement-size-model.mjs';
const clamp=v=>Math.max(0,Math.min(1,v));
/** Explicit rain-fed cereal scenario, not inferred soil or historical census.
 * Population lives in bounded regional aggregates; no village meshes allocated.
 *
 * @2 additionally saves an explicit settlement sizePolicy and uses it to derive
 * the village/town/city population split. The cell total population and the food
 * capacity are unchanged from @1; only the assumed settlement magnitudes are
 * made explicit. This still places no house, road, field or settlement site. */
export const AGRICULTURE_POPULATION_SCHEMA = 'agriculture-population@2';
export function planAgriculturePopulation(snapshot,climate,{targetPopulation=100000000,cultivatedFraction=.15,soilMultiplier=1,grainKgPerHa=800,foodKgPerPersonYear=250,retainedHarvestFraction=.55,ruralFraction=.9,meanVillagePopulation=300,meanTownPopulation=4000,meanCityPopulation=50000}={}){
 const {columns:w,rows:h}=snapshot.grid,n=w*h;
 if(n>32768||climate.grid.columns!==w||climate.grid.rows!==h||climate.sourceWorldId!==snapshot.worldId)throw new Error('Climate and geography must match');
 if(!Number.isSafeInteger(targetPopulation)||targetPopulation<0||targetPopulation>1e10||![cultivatedFraction,retainedHarvestFraction,ruralFraction].every(v=>Number.isFinite(v)&&v>=0&&v<=1)||![soilMultiplier,grainKgPerHa,foodKgPerPersonYear,meanVillagePopulation,meanTownPopulation,meanCityPopulation].every(v=>Number.isFinite(v)&&v>0))throw new RangeError('Invalid population scenario');
 const sizePolicy=createSettlementSizePolicy({meanVillagePopulation,meanTownPopulation,meanCityPopulation});
 const settings={targetPopulation,cultivatedFraction,soilMultiplier,grainKgPerHa,foodKgPerPersonYear,retainedHarvestFraction,ruralFraction,meanVillagePopulation,meanTownPopulation,meanCityPopulation};
 const z=snapshot.fields.groundElevationM,radius=snapshot.frame.radiusM;
 const cells=z.map((height,i)=>{
  const row=Math.floor(i/w),x=i%w,lat=(90-(row+.5)*180/h)*Math.PI/180,dx=Math.max(1,2*Math.PI*radius/w*Math.cos(lat)),dy=Math.PI*radius/h;
  const grade=Math.max(Math.abs(z[row*w+(x+1)%w]-height)/dx,Math.abs(z[row*w+(x+w-1)%w]-height)/dx,...[i-w,i+w].filter(j=>j>=0&&j<n).map(j=>Math.abs(z[j]-height)/dy));
  const wet=!snapshot.fields.landMask[i]||(snapshot.fields.lakeFillDepthM?.[i]??0)>0;
  const t=climate.monthlyTemperatureC.map(m=>m[i]),p=climate.monthlyPrecipitationMm.map(m=>m[i]);
  const growingMonths=t.filter(v=>v>=5&&v<=35).length,growingRain=p.reduce((sum,v,m)=>sum+(t[m]>=5&&t[m]<=35?v:0),0);
  const thermal=clamp(growingMonths/5),water=clamp(growingRain/450)*clamp((2500-growingRain)/1000),relief=clamp(1-grade/.12);
  const suitability=wet?0:thermal*water*relief;
  const cultivatedHa=wet?0:climate.cellAreaM2[i]/10000*cultivatedFraction*relief;
  const netFoodKg=cultivatedHa*grainKgPerHa*thermal*water*soilMultiplier*retainedHarvestFraction;
  const capacity=Math.floor(netFoodKg/foodKgPerPersonYear);
  return{cellIndex:i,suitability,growingMonths,growingRainMm:growingRain,cultivatedHa,netFoodKg,capacity,population:0,villages:0,towns:0,cities:0};
 });
 const totalCapacity=cells.reduce((s,c)=>s+c.capacity,0),supportedPopulation=Math.min(targetPopulation,totalCapacity);
 // Largest-remainder allocation is deterministic and cannot exceed cell capacity.
 if(totalCapacity&&supportedPopulation){let left=supportedPopulation;const remainder=[];for(const c of cells){const raw=supportedPopulation*c.capacity/totalCapacity;c.population=Math.floor(raw);left-=c.population;remainder.push({i:c.cellIndex,r:raw-c.population});}remainder.sort((a,b)=>b.r-a.r||a.i-b.i);for(const q of remainder){if(!left)break;if(cells[q.i].population<cells[q.i].capacity){cells[q.i].population++;left--;}}}
 // Cities keep the existing regional population x suitability priority. Each
 // cell's city target is a stable-hash value in [0.5,1.5]x the city mean, limited
 // by the remaining city budget (at most 20% of the urban budget) and cell
 // population. A city smaller than the policy minimum is not created at all, and
 // the unused city budget returns to the towns.
 const urbanBudget=Math.floor(supportedPopulation*(1-ruralFraction)+1e-7),cityBudgetCap=Math.floor(urbanBudget*.2);let cityUsed=0;
 for(const c of [...cells].sort((a,b)=>b.population*b.suitability-a.population*a.suitability||a.cellIndex-b.cellIndex)){
  c.cityPopulation=0;c.cities=0;
  const factor=.5+settlementStableUnit(`${snapshot.worldId}|city-target|${c.cellIndex}`);
  const target=Math.round(factor*sizePolicy.meanCityPopulation);
  const population=Math.min(target,cityBudgetCap-cityUsed,c.population);
  if(population<sizePolicy.cityMin)continue;
  c.cities=1;c.cityPopulation=population;cityUsed+=population;
 }
 const townBudget=urbanBudget-cityUsed,remaining=supportedPopulation-cityUsed;let townLeft=townBudget;const shares=[];
 for(const c of cells){const raw=remaining?townBudget*(c.population-c.cityPopulation)/remaining:0;c.townPopulation=Math.floor(raw);townLeft-=c.townPopulation;shares.push({c,r:raw-c.townPopulation});}
 shares.sort((a,b)=>b.r-a.r||a.c.cellIndex-b.c.cellIndex);for(const {c} of shares){if(!townLeft)break;if(c.townPopulation<c.population-c.cityPopulation){c.townPopulation++;townLeft--;}}
 // A proportional town population below the town minimum is returned to the
 // village side instead of forming an undersized town.
 for(const c of cells){
  if(c.townPopulation>0&&c.townPopulation<sizePolicy.townMin)c.townPopulation=0;
  c.ruralPopulation=c.population-c.cityPopulation-c.townPopulation;
  c.towns=settlementCountFor(sizePolicy,'town',c.townPopulation);
  c.villages=settlementCountFor(sizePolicy,'village',c.ruralPopulation);
 }
 const totals={targetPopulation,supportedPopulation,unplacedPopulation:targetPopulation-supportedPopulation,totalCapacity,villages:cells.reduce((s,c)=>s+c.villages,0),towns:cells.reduce((s,c)=>s+c.towns,0),cities:cells.reduce((s,c)=>s+c.cities,0)};
 const content={schema:AGRICULTURE_POPULATION_SCHEMA,sourceWorldId:snapshot.worldId,climateId:climate.id,grid:{columns:w,rows:h},settings,sizePolicy,cells,totals,assumptions:['rain-fed cereal economy','soil fertility explicitly assumed, not measured','regional counts are aggregate estimates; towns and villages are not all placed or built','village/town/city sizes follow the saved sizePolicy bounds; villages aggregate small settlements (under 100 people shown as hamlets)','ruralFraction is a target split; the realised rural/urban ratio changes with rounding and minimum settlement size'],limitations:['No trade, irrigation, fisheries, migration or political boundaries','Coarse relief and climate cannot certify individual fields','Settlement counts depend on assumed mean size; no urban hierarchy simulation','The sizePolicy is a provisional magnitude model, not a historical calibration, a natural urban hierarchy or a political/trade model']};return{...content,id:hashJson(copyJson(content))};
}

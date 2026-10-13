import {fileURLToPath} from 'node:url';import fs from 'node:fs';import path from 'node:path';
import {createPlanetMacroTerrain} from '../src/core/planet-macro.mjs';
import {derivePlanetHydrology} from '../src/core/planet-hydrology.mjs';
import {generateClimate} from '../src/core/planet-climate.mjs';
import {planAgriculturePopulation} from '../src/core/planet-population.mjs';
import {createL0SettlementDistribution} from '../src/core/settlement-distribution.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
/** Bounded global-field audit; does not generate local settlements or claim
 * browser acceptance. Area weights prevent polar raster cells inflating shares.
 * The settlement budget is a distribution only: no house, village or road is
 * placed here, and the surface suitability already present in L0 is reused
 * rather than regenerating every building and road. */
export function auditL0(seed,{columns=128,rows=64,targetPopulation=100000000,...populationScenario}={}){
 const {elevation,recipe}=createPlanetMacroTerrain({seed,columns,rows,radiusM:6371000}),hydrology=derivePlanetHydrology({elevation,columns,rows,lakeFillFraction:.2});
 const snapshot={worldId:`l0-audit:${seed}:${columns}:${rows}`,grid:{columns,rows},frame:{radiusM:6371000,verticalDatum:'generated-sea-datum'},fields:{groundElevationM:elevation,landMask:hydrology.oceanCells.map(v=>1-v),lakeFillDepthM:hydrology.lakeFillDepthM,downstream:hydrology.downstream},references:{macroRecipe:recipe,sea:{levelElevationM:0},lakes:hydrology.lakes}},climate=generateClimate(snapshot);
 const population=planAgriculturePopulation(snapshot,climate,{targetPopulation,...populationScenario});
 const settlementDistribution=createL0SettlementDistribution(snapshot,climate,population);
 const area=climate.cellAreaM2,total=area.reduce((s,v)=>s+v,0),biomeAreaPercent={};let landArea=0,elevationSum=0,lowlandArea=0;
 for(let i=0;i<area.length;i++){const b=climate.biome[i];biomeAreaPercent[b]=(biomeAreaPercent[b]??0)+area[i]/total*100;if(b!=='ocean'&&b!=='lake'){landArea+=area[i];elevationSum+=area[i]*elevation[i];if(elevation[i]>=0&&elevation[i]<1000)lowlandArea+=area[i];}}
 const summary={seed,columns,rows,meanDryLandElevationM:elevationSum/landArea,dryLandBelow1000mFraction:lowlandArea/landArea,biomeAreaPercent,requestedPopulation:population.totals.targetPopulation,supportedPopulation:population.totals.supportedPopulation,unplacedPopulation:population.totals.unplacedPopulation,villages:settlementDistribution.totals.villages,towns:settlementDistribution.totals.towns,cities:settlementDistribution.totals.cities,populatedCells:settlementDistribution.totals.populatedCells,populationId:population.id,settlementDistributionId:settlementDistribution.id,source:'macro fields plus hydrology and climate; no fine river geometry',lakeAssumption:'static fill fraction 0.2; not climate-balanced',marineAssumption:'largest connected sub-sea reservoir; enclosed basins separate'};
 return{snapshot,climate,population,settlementDistribution,summary};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){requireVerificationMemory();const directory=process.argv[2]??'reports/l0-review';fs.mkdirSync(directory,{recursive:true});const summaries=[];for(const seed of ['planet-1','planet-2','planet-3','muna-atlas-001']){const result=auditL0(seed);fs.writeFileSync(path.join(directory,seed+'.json'),JSON.stringify(result));summaries.push(result.summary);}fs.writeFileSync(path.join(directory,'summary.json'),JSON.stringify(summaries,null,2));console.log(JSON.stringify(summaries,null,2));}

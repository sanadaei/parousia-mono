import { createPlanetWaterSampler } from './sea-level.mjs';
import { offsetGeographic } from './spherical.mjs';
import { freezeOwned } from './road-geometry.mjs';
import { copyJson, hashJson } from './json-contract.mjs';
import { restoreGlobalTerrain } from './global-terrain.mjs';
import { createGlobeFeatureChart } from './globe-features.mjs';
import { createL0SettlementDistribution, validateSettlementDistribution } from './settlement-distribution.mjs';

function validateWorldDistribution(base, climate, population, distribution) {
  validateSettlementDistribution(distribution);
  const expected = createL0SettlementDistribution(base, climate, population);
  if (distribution.id !== expected.id) throw new TypeError('Planet settlement distribution does not match its population authority');
}
export const PLANET_WORLD_SCHEMA = 'planet-world@1';
/** Identity includes geography, water, roads, houses and settlement locations.
 * Runtime caches and camera/LOD state are deliberately excluded. */
export function snapshotPlanetWorld(world) {
  const base = world.base.toSnapshot();
  if (world.settlementDistribution !== undefined) validateWorldDistribution(base, world.climate, world.population, world.settlementDistribution);
  const content = copyJson({ schema: PLANET_WORLD_SCHEMA, base,
    ...(world.settlementDistribution !== undefined?{settlementDistribution:world.settlementDistribution}:{}),
    ...(world.landscape?{landscape:world.landscape}:{}), ...(world.settlementCatalogue?{settlementCatalogue:world.settlementCatalogue}:{}), ...(world.population?{population:world.population}:{}), ...(world.climate?{climate:world.climate}:{}), ...(world.settlementNetwork?{settlementNetwork:world.settlementNetwork}:{}), recipes: world.recipes, settlements: world.settlements, focus: world.focus });
  return { ...content, worldId: hashJson(content) };
}
export function restorePlanetWorld(input) {
  const saved = copyJson(typeof input === 'string' ? JSON.parse(input) : input);
  const { worldId, ...content } = saved;
  if (saved.schema !== PLANET_WORLD_SCHEMA || typeof worldId !== 'string' || hashJson(content) !== worldId) throw new TypeError('Planet snapshot identity mismatch');
  if (saved.settlementDistribution !== undefined) validateWorldDistribution(saved.base, saved.climate, saved.population, saved.settlementDistribution);
  if (!Array.isArray(saved.recipes) || saved.recipes.length > 32 || !Array.isArray(saved.settlements) || saved.settlements.length !== saved.recipes.length) throw new RangeError('Invalid planet settlement collection');
  const base = restoreGlobalTerrain(saved.base), ids = new Set();
  const charts = saved.recipes.map(recipe => {
    if (ids.has(recipe.id)) throw new TypeError('Duplicate settlement recipe'); ids.add(recipe.id);
    return createGlobeFeatureChart(base, recipe);
  });
  const placeIds=new Set();
  for(const p of saved.settlements) {
    if(!ids.has(p.id)||placeIds.has(p.id)||![p.latDeg,p.lonDeg].every(Number.isFinite)||Math.abs(p.latDeg)>90)throw new TypeError('Invalid settlement reference');
    placeIds.add(p.id);
    const chart=charts.find(c=>c.recipe.id===p.id);
    if(!chart.local(p.latDeg,p.lonDeg)||p.buildings!==chart.recipe.buildings.length)throw new TypeError('Settlement does not match its feature chart');
  }
  if(!saved.focus || ![saved.focus.latDeg,saved.focus.lonDeg].every(Number.isFinite) || Math.abs(saved.focus.latDeg)>90)throw new TypeError('Invalid world focus');
  const planetWater=createPlanetWaterSampler(saved.base.references.sea,saved.base.references.lakes??[],saved.base.grid,saved.base.references.localPonds);
  const groundAt=(lat,lon)=>{for(const chart of charts)if(chart.local(lat,lon))return chart.groundElevationAt(lat,lon);return base.groundElevationAt(lat,lon);};
  freezeOwned(saved);
  function samplePoint(lat,lon,includeDerivatives) {
      for(const chart of charts){const sample=chart.sampleAt(lat,lon);if(sample){
        let derivatives={};if(includeDerivatives){const step=base.derivativeStepM,at=(east,north)=>{const p=offsetGeographic({latDeg:lat,lonDeg:lon},east,north,base.frame.radiusM);return groundAt(p.latDeg,p.lonDeg);};
        const gradientEastNorth={east:(at(step,0)-at(-step,0))/(2*step),north:(at(0,step)-at(0,-step))/(2*step)};
        derivatives={gradientEastNorth,slopeMPerM:Math.hypot(gradientEastNorth.east,gradientEastNorth.north)};}
        const original=includeDerivatives?base.sampleAt(lat,lon):base.sampleSurfaceAt(lat,lon),water=planetWater(lat,lon,sample.groundElevationM),candidates=[original,sample,water].filter(s=>s.waterLevelElevationM!=null&&s.waterLevelElevationM>sample.groundElevationM).sort((a,b)=>b.waterLevelElevationM-a.waterLevelElevationM),selected=candidates[0]??water;
        return {...original,...sample,surfaceKind:selected.surfaceKind??(selected.waterLevelElevationM>sample.groundElevationM?'local-water':'land'),waterLevelElevationM:selected.waterLevelElevationM,waterDepthM:selected.waterLevelElevationM==null?null:Math.max(0,selected.waterLevelElevationM-sample.groundElevationM),waterSurfaceElevationM:selected.waterLevelElevationM>sample.groundElevationM?selected.waterLevelElevationM:null,waterSourceIds:selected.waterSourceIds,hydrologyStatus:'modeled',...derivatives};
      }}
      return includeDerivatives?base.sampleAt(lat,lon):base.sampleSurfaceAt(lat,lon);
    }
  return {worldId,base,...(saved.settlementDistribution?{settlementDistribution:saved.settlementDistribution}:{}),...(saved.landscape?{landscape:saved.landscape}:{}),...(saved.settlementCatalogue?{settlementCatalogue:saved.settlementCatalogue}:{}),...(saved.population?{population:saved.population}:{}),...(saved.climate?{climate:saved.climate}:{}),...(saved.settlementNetwork?{settlementNetwork:saved.settlementNetwork}:{}),recipes:saved.recipes,settlements:saved.settlements,focus:saved.focus,charts,sampleAt:(lat,lon)=>samplePoint(lat,lon,true),sampleSurfaceAt:(lat,lon)=>samplePoint(lat,lon,false),toSnapshot(){return copyJson(saved);}};
}

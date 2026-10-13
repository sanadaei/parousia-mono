import {createLocalPondSampler} from './local-ponds.mjs';
import { finiteNumber, nonEmptyText } from './contract-validation.mjs';

export const SEA_LEVEL_SCHEMA = 'planet-hydrostatic-sea@1';
/** Opt-in boundary condition. Never infer a sea from an old source's zero datum.
 * This first model is static inundation; basin classification is a separate task. */
export function validateSeaLevel(sea, verticalDatum) {
  if (sea == null) return null;
  if (sea.schema !== SEA_LEVEL_SCHEMA) throw new TypeError('Unsupported sea-level schema');
  finiteNumber(sea.levelElevationM, 'sea level');
  if (Math.abs(sea.levelElevationM) > 1e7) throw new RangeError('Sea level exceeds elevation bounds');
  nonEmptyText(sea.id, 'sea.id');
  if (sea.verticalDatum !== verticalDatum) throw new RangeError('Sea and terrain vertical datums differ');
  return sea;
}
export function sampleSeaLevel(sea, groundElevationM) {
  if (!sea) return { hydrologyStatus: 'unresolved', surfaceKind: 'unresolved', waterLevelElevationM: null,
    waterSurfaceElevationM: null, waterDepthM: null, waterSourceIds: [] };
  const depth = Math.max(0, sea.levelElevationM - groundElevationM);
  return { hydrologyStatus: 'modeled', surfaceKind: depth > 0 ? 'sea-level-water' : 'land',
    waterLevelElevationM: sea.levelElevationM, waterSurfaceElevationM: depth > 0 ? sea.levelElevationM : null,
    waterDepthM: depth, waterSourceIds: depth > 0 ? [sea.id] : [] };
}
/** A local explicit river/lake wins when it is wet; otherwise use global sea.
 * Land above the global sea is dry, not an unknown body of water. */
export function mergeSeaLevel(sea, sample) {
  if (!sea || sample.waterDepthM > 0) return sample;
  return { ...sample, ...sampleSeaLevel(sea, sample.groundElevationM) };
}

export function createPlanetWaterSampler(sea, lakes = [], grid, localPonds = null) {
 const reservoir=createReservoirSampler(sea,lakes,grid),pond=createLocalPondSampler(localPonds);
 if(!pond)return reservoir;
 return(lat,lon,ground)=>{const r=reservoir(lat,lon,ground),p=pond(lat,lon,ground);return p&&(!(r.waterDepthM>0)||p.waterLevelElevationM>r.waterLevelElevationM)?p:r;};
}
function createReservoirSampler(sea, lakes, grid) {
  if(!Array.isArray(lakes)||lakes.length>4096)throw new RangeError('Invalid lakes');
  const cells=new Map(),w=grid.columns,h=grid.rows;
  const ids=new Set();
  for(const lake of lakes){
    if(typeof lake.id!=='string'||ids.has(lake.id)||!Number.isFinite(lake.levelElevationM)||!Number.isFinite(lake.spillLevelM)||lake.levelElevationM>lake.spillLevelM||!Array.isArray(lake.cells))throw new TypeError('Invalid lake model');
    if(lake.basinWaterPolicy!=null&&lake.basinWaterPolicy!=='explicit-dry-basin@1')throw new TypeError('Unknown lake basin water policy');
    ids.add(lake.id);
    for(const i of lake.cells){if(!Number.isSafeInteger(i)||i<0||i>=w*h||cells.has(i))throw new RangeError('Invalid or overlapping lake cell');cells.set(i,lake);}
  }
  const modes=new Set(lakes.map(l=>l.membershipMethod??'legacy-cell-halo@1'));
  if([...modes].some(m=>!['legacy-cell-halo@1','interpolation-support@1'].includes(m))||modes.size>1)throw new TypeError('Unsupported or mixed lake membership methods');
  if(modes.has('legacy-cell-halo@1')){const support=new Map();
  for(const [i,lake] of cells){const x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(y+dy<0||y+dy>=h)continue;const q=(y+dy)*w+(x+dx+w)%w;const list=support.get(q)??[];if(!list.includes(lake))list.push(lake);support.set(q,list);}}
  return (lat,lon,ground) => {
    const x=Math.floor(((lon%360+360)%360)/360*w),y=Math.min(h-1,Math.max(0,Math.floor((90-lat)/180*h))),i=y*w+x;
    const containing=cells.get(i),near=(support.get(i)??[]).filter(b=>ground<b.levelElevationM);
    const lake=containing??(near.length===1?near[0]:null);
    if(lake){const depth=Math.max(0,lake.levelElevationM-ground);return {hydrologyStatus:'modeled',surfaceKind:depth>0?lake.kind:'land',
      waterLevelElevationM:lake.levelElevationM,waterSurfaceElevationM:depth>0?lake.levelElevationM:null,waterDepthM:depth,waterSourceIds:depth>0?[lake.id]:[]};}
    if(near.length>1)return {hydrologyStatus:'unresolved',surfaceKind:'unresolved-lake-boundary',waterLevelElevationM:null,waterSurfaceElevationM:null,waterDepthM:null,waterSourceIds:[]};
    return sampleSeaLevel(sea,ground);
  };
  }
  return (lat,lon,ground) => {
    // Membership follows the four source-centre vertices of the actual
    // interpolation patch, not an unrelated nearest-cell square plus halo.
    // A lake cannot spill into the low terrain on the far side of a dry rim
    // merely because that terrain lies in a neighbouring source cell.
    const x=((lon%360+360)%360)/360*w-.5,y=Math.max(0,Math.min(h-1,(90-lat)/180*h-.5)),x0=Math.floor(x),y0=Math.floor(y),y1=Math.min(h-1,y0+1);
    const candidates=new Set();for(const yy of [y0,y1])for(const xx of [x0,x0+1]){const lake=cells.get(yy*w+(xx%w+w)%w);if(lake)candidates.add(lake);}
    const near=[...candidates].filter(b=>ground<b.levelElevationM),lake=near.length===1?near[0]:null;
    if(lake){const depth=Math.max(0,lake.levelElevationM-ground);return {hydrologyStatus:'modeled',surfaceKind:depth>0?lake.kind:'land',
      waterLevelElevationM:lake.levelElevationM,waterSurfaceElevationM:depth>0?lake.levelElevationM:null,waterDepthM:depth,waterSourceIds:depth>0?[lake.id]:[]};}
    if(near.length>1)return {hydrologyStatus:'unresolved',surfaceKind:'unresolved-lake-boundary',waterLevelElevationM:null,waterSurfaceElevationM:null,waterDepthM:null,waterSourceIds:[]};
    // A below-sea-level terminal basin is not connected to the ocean merely
    // because its exposed bed lies below the global datum. Its explicit lower
    // lake level remains authoritative throughout its interpolation support.
    const dryBasins=[...candidates].filter(b=>b.basinWaterPolicy==='explicit-dry-basin@1');
    if(dryBasins.length){const level=Math.max(...dryBasins.map(b=>b.levelElevationM));
      return {hydrologyStatus:'modeled',surfaceKind:'land',waterLevelElevationM:level,
        waterSurfaceElevationM:null,waterDepthM:0,waterSourceIds:[]};}
    return sampleSeaLevel(sea,ground);
  };
}

/** One canonical tie rule at river mouths: preserve river provenance when its
 * wet surface equals the receiving reservoir. Shared by resident and pages. */
export function selectBasePlanetWater(reservoir,river){
 return river?.waterDepthM>0&&(!(reservoir.waterDepthM>0)||river.waterLevelElevationM>=reservoir.waterLevelElevationM)
  ?{...river,hydrologyStatus:'modeled',surfaceKind:'river',waterSurfaceElevationM:river.waterLevelElevationM}:reservoir;
}

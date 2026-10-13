import {createPlanetMacroTerrain,EARTHLIKE_L0} from './planet-macro.mjs';
import {VALLEY_ENVIRONMENT_POLICY} from './environment-cover.mjs';
import {refineTerrainRiverRoutes,applyLowGradientPlanforms} from './terrain-river-routes.mjs';
import {RIDGE_STRATA_SHAPE} from './terrain-band-noise.mjs';
import {withAlluvialValleySections} from './river-valley-section.mjs';
import {BALANCED_WATER_LED_SITING} from './settlement-water-access.mjs';
import {deriveRegionalPonds} from './local-ponds.mjs';
import {LANDSCAPE_PROFILE} from './regional-landscape.mjs';
import {deriveRegionalTributaries} from './regional-tributaries.mjs';
import {generateClimate} from './planet-climate.mjs';
import {planAgriculturePopulation} from './planet-population.mjs';
import {createL0SettlementDistribution} from './settlement-distribution.mjs';
import { metricRoads } from './road-geometry.mjs';
import { ROAD_CROSS_SECTION_SCHEMA, mergeFlatRoadIntervals } from './road-cross-section.mjs';
import { extendVillageRoads } from './village-roads.mjs';
import { planCulvertRouting, validateCulvertDesign } from './culvert-routing.mjs';
import { buildBridgeStructure } from './bridge-structures.mjs';
import { derivePlanetRivers } from './planet-rivers.mjs';
import { createHash } from './sha256.mjs';
import { derivePlanetHydrology } from './planet-hydrology.mjs';
import { createGlobalTerrain, GLOBAL_TERRAIN_SCHEMA } from './global-terrain.mjs';
import { createSphericalNoise } from './spherical-noise.mjs';
import { sphereBasis, greatCircle, createSphericalProjection } from './spherical.mjs';
import { SEA_LEVEL_SCHEMA } from './sea-level.mjs';
import { WATER_SCHEMA } from './water-model.mjs';

export const GENERATED_RIVER_VALLEYS=Object.freeze({maxIncisionM:600,sideRunPerRise:3});

/** A deterministic, bounded standalone world recipe, independent of render LOD.
 * Procedural geography, not a plate-tectonics or population simulation. */
export function generatePlanet({ seed = 'planet-1', columns = 128, rows = 64, radiusM = 6371000,
  macroProfile = 'legacy', landformShape = 'rounded', valleySections = 'legacy', riverDetail = 'major', localLandforms = true, localTributaries = false, climatePlanning = false, targetPopulation = 100000000, seaLevelM = 0, settlementCount = 8, lakeFillFraction, culvertDesign = null, maxSourceCells = 32768, maxRiverPoints = 32768, riverValleys = GENERATED_RIVER_VALLEYS, villageRoads = true, roadCrownSlope = .02 } = {}) {
  if(!['legacy',EARTHLIKE_L0].includes(macroProfile))throw new RangeError('Invalid macroProfile');
  lakeFillFraction??=macroProfile===EARTHLIKE_L0?.2:1;
  if(!['rounded','stratified'].includes(landformShape))throw new RangeError('landformShape must be rounded or stratified');
  if(landformShape==='stratified'&&!localLandforms)throw new RangeError('Stratified landforms require localLandforms');
  if(!['legacy','alluvial'].includes(valleySections))throw new RangeError('valleySections must be legacy or alluvial');
  if(!['major','regional'].includes(riverDetail))throw new RangeError('riverDetail must be major or regional');
  if(typeof localTributaries!=='boolean')throw new TypeError('localTributaries must be boolean');
  if(!Number.isFinite(roadCrownSlope)||roadCrownSlope<0||roadCrownSlope>.1)throw new RangeError('Road crown slope must be 0..0.1');
  if(typeof localLandforms!=='boolean')throw new TypeError('localLandforms must be boolean');
  if(typeof villageRoads!=='boolean')throw new TypeError('villageRoads must be boolean');
  if(riverValleys!=null&&(!Number.isFinite(riverValleys.maxIncisionM)||riverValleys.maxIncisionM<=0||riverValleys.maxIncisionM>2000||!Number.isFinite(riverValleys.sideRunPerRise)||riverValleys.sideRunPerRise<=0||riverValleys.sideRunPerRise>16))throw new RangeError('Explicit valley incision and side-run limits are required');
  if(culvertDesign)validateCulvertDesign(culvertDesign);
  if (typeof seed !== 'string' || !seed.trim()) throw new TypeError('seed is required');
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns < 16 || rows < 8 || columns * rows > 131072) throw new RangeError('Invalid planet grid');
  // Source resolution is not display resolution. Refuse costly requests before
  // allocating fields; callers with measured larger budgets may opt in, but
  // the default 256 MiB tooling must not silently attempt a 131k-cell world.
  if(!Number.isSafeInteger(maxSourceCells)||maxSourceCells<128||maxSourceCells>131072||!Number.isSafeInteger(maxRiverPoints)||maxRiverPoints<2||maxRiverPoints>131072)throw new RangeError('Invalid explicit generation work budget');
  if(columns*rows>maxSourceCells)throw new RangeError('Source grid exceeds generation work budget; rendering zoom does not require a denser source grid');
  if (!Number.isSafeInteger(settlementCount) || settlementCount < 0 || settlementCount > 32) throw new RangeError('Settlement count must be 0..32');
  if (!Number.isFinite(radiusM) || radiusM < 100000 || radiusM > 1e8 || !Number.isFinite(seaLevelM)) throw new RangeError('Invalid planet frame');
  const continent = createSphericalNoise(seed + '/continents', radiusM, radiusM / 2.6);
  const mountain = createSphericalNoise(seed + '/mountains', radiusM, radiusM / 9);
  const hills = createSphericalNoise(seed + '/hills', radiusM, radiusM / 24);
  const point = i => ({ latDeg: 90 - (Math.floor(i / columns) + .5) * 180 / rows, lonDeg: (i % columns + .5) * 360 / columns });
  const macro=macroProfile===EARTHLIKE_L0?createPlanetMacroTerrain({seed,columns,rows,radiusM,seaLevelM}):null;
  const elevation = macro?.elevation??Array.from({ length: columns * rows }, (_, i) => {
    const d = sphereBasis(point(i)).up, c = continent(d);
    return seaLevelM + c * 8500 - 900 + Math.max(0, c + .08) * Math.pow(1 - Math.abs(mountain(d)), 5) * 2300 + hills(d) * 160;
  });
  // The polar cap is one point, not disconnected longitude-specific outlets.
  // Give its source ring one elevation before drainage is derived.
  for(const row of [0,rows-1]){const mean=elevation.slice(row*columns,(row+1)*columns).reduce((a,z)=>a+z/columns,0);for(let x=0;x<columns;x++)elevation[row*columns+x]=mean;}
  const hydrology = derivePlanetHydrology({ elevation, columns, rows, seaLevelM, lakeFillFraction });
  const landMask = hydrology.oceanCells.map(v=>1-v), downstream=hydrology.downstream;
  const sea = { schema: SEA_LEVEL_SCHEMA, id: 'sea', verticalDatum: 'generated-sea-datum', levelElevationM: seaLevelM };
  // A receiving lake constrains its own upstream drainage area. Without this
  // spatial guard, new hollows can push an upstream junction below the lake's
  // fixed water level. Unrelated basins must never share that constraint.
  const shoreRegions=hydrology.lakes.map(l=>({kind:'lake-drainage-area',levelElevationM:l.levelElevationM,cells:[]})),receivers=new Int32Array(elevation.length).fill(-2);
  for(let i=0;i<hydrology.lakes.length;i++)for(const cell of hydrology.lakes[i].cells)receivers[cell]=i;
  for(let i=0;i<receivers.length;i++)if(hydrology.oceanCells[i])receivers[i]=-1;
  for(let i=0;i<receivers.length;i++){if(receivers[i]!==-2)continue;const route=[];let q=i;while(q>=0&&receivers[q]===-2){route.push(q);q=downstream[q];if(route.length>receivers.length)throw new Error('Cyclic shore drainage');}const target=q<0?-1:receivers[q];for(const cell of route)receivers[cell]=target;}
  for(let i=0;i<receivers.length;i++)if(receivers[i]>=0)shoreRegions[receivers[i]].cells.push(i);
  let base = createGlobalTerrain({ schema: GLOBAL_TERRAIN_SCHEMA, seed, revision: macro?'planet-generator@25-l0':'planet-generator@19',
    frame: { radiusM, sourceVerticalDatum: sea.verticalDatum, verticalDatum: sea.verticalDatum },
    grid: { columns, rows, macroColumns: columns, macroRows: rows }, derivativeStepM: 1,
    fields: { groundElevationM: elevation, landMask, downstream, lakeFillDepthM: hydrology.lakeFillDepthM, runoffIndex: hydrology.runoffIndex },
    detail: { method: localLandforms?'anchored-local-shores@5':'anchored-spherical-shore-preserving@3',shoreLevelsM:localLandforms?[seaLevelM]:[seaLevelM,...hydrology.lakes.map(l=>l.levelElevationM),elevation[0]-.3,elevation[(rows-1)*columns]-.3],...(localLandforms?{shoreRegions}:{}), bands: localLandforms?[{ id: 'mountain-massifs', ...(landformShape==='stratified'?{shape:RIDGE_STRATA_SHAPE}:{}), wavelengthM: 2500, amplitudeM: 900, shoreBudgetFraction: .55, elevationActivationM: [seaLevelM+400,seaLevelM+1800] }, { id: 'local-hills', wavelengthM: 900, amplitudeM: 100, shoreBudgetFraction: .35, elevationActivationM: [seaLevelM+30,seaLevelM+600] }, { id: 'regional-relief', wavelengthM: 180, amplitudeM: 12, shoreBudgetFraction: .09 }, { id: 'ground-roughness', wavelengthM: 8, amplitudeM: .04, shoreBudgetFraction: .01 }]:[{id:'regional-relief',wavelengthM:1800,amplitudeM:1.5},{id:'local-relief',wavelengthM:120,amplitudeM:.25},{id:'ground-roughness',wavelengthM:8,amplitudeM:.04}] },
    references: { ...(macro?{macroRecipe:macro.recipe}:{}), sea, lakes: hydrology.lakes, macroCellIds: elevation.map((_, i) => `cell:${i}`) } });
  // Rainfall availability affects which existing drainage paths carry a
  // representative river. Reference area keeps the legacy index scale explicit;
  // this is a game-world channel sizing scenario, not gauged discharge.
  let riverHydrology=hydrology,riverClimate=null;
  if(climatePlanning){
    const forcing=generateClimate(base.toSnapshot()),water=forcing.catchmentWater,
      referenceAreaM2=forcing.cellAreaM2.reduce((s,a,i)=>s+(landMask[i]?a:0),0)/Math.max(1,landMask.reduce((s,v)=>s+v,0));
    riverClimate=forcing;
    riverHydrology={...hydrology,runoffIndex:water.annualRoutedYieldM3.map(v=>v/(referenceAreaM2*.4)),
      climateSupply:{id:water.id,referenceAreaM2,referenceAnnualRunoffMm:400,meanPotentialFlowM3PerSecond:water.meanPotentialFlowM3PerSecond,yieldMonths:water.yieldMonths}};
  }
  let rivers=derivePlanetRivers(base,riverHydrology,{minimumRunoff:riverDetail==='regional'?5:20,maxPoints:maxRiverPoints,surveyNodeLevels:localLandforms,...(climatePlanning?{nodeSurveyStepM:1000}:{}),...(riverValleys?{maxIncisionM:riverValleys.maxIncisionM,valleySideRunPerRise:riverValleys.sideRunPerRise}:{})});
  if(climatePlanning){const macroBudget=localTributaries?Math.max(rivers.diagnostics.pointCount,Math.floor(maxRiverPoints*.65)):maxRiverPoints;rivers=refineTerrainRiverRoutes(base,rivers,{maxPoints:macroBudget});rivers=applyLowGradientPlanforms(base,rivers,{maxPoints:macroBudget,confinement:'local-taper@2'});}
  if(valleySections==='alluvial')rivers=withAlluvialValleySections(rivers);
  const riverState=base.toSnapshot();delete riverState.worldId;delete riverState.sourceWorldId;
  riverState.references.rivers=rivers;base=createGlobalTerrain(riverState);
  if(localTributaries){
    if(riverClimate){
      const mainIds=new Set(rivers.profiles.map(p=>p.id)),count=rivers.profiles.reduce((n,p)=>n+p.points.length,0),regionalBudget=Math.max(count+2,Math.floor((count+maxRiverPoints)/2));
      if(regionalBudget<=maxRiverPoints)rivers=deriveRegionalTributaries(base,rivers,{maxRegions:12,maxTotalPoints:regionalBudget,cellSizeM:512,minChannelAreaM2:1000000,profileStepM:32,maxIncisionM:10,scaleId:'regional',climate:riverClimate});
      const regionalState=base.toSnapshot();delete regionalState.worldId;delete regionalState.sourceWorldId;regionalState.references.rivers=rivers;base=createGlobalTerrain(regionalState);
      const selected=[];for(const p of rivers.profiles.filter(p=>!mainIds.has(p.id)).sort((a,b)=>b.points.length-a.points.length||a.id.localeCompare(b.id))){const center=p.points[Math.floor(p.points.length/2)];if(selected.every(q=>greatCircle(center,q.center,radiusM).distanceM>=12000))selected.push({id:p.id,center});if(selected.length===32)break;}
      const medium=selected.map(p=>p.id),parents=[...medium,...[...mainIds].slice(0,Math.max(0,48-medium.length))];
      if(rivers.profiles.reduce((n,p)=>n+p.points.length,0)+2<=maxRiverPoints)rivers=deriveRegionalTributaries(base,rivers,{maxRegions:36,maxTotalPoints:maxRiverPoints,scaleId:'local',parentProfileIds:parents,climate:riverClimate});
    }else rivers=deriveRegionalTributaries(base,rivers,{maxTotalPoints:maxRiverPoints});
    const state=base.toSnapshot();delete state.worldId;delete state.sourceWorldId;
    state.references.rivers=rivers;state.revision=riverClimate?'planet-generator@24-climate-nested-water':'planet-generator@21-rounded-tributaries';base=createGlobalTerrain(state);
  }
  if(climatePlanning){const state=base.toSnapshot();delete state.worldId;delete state.sourceWorldId;state.references.environmentPolicy=VALLEY_ENVIRONMENT_POLICY;base=createGlobalTerrain(state);}
  let climate=climatePlanning?generateClimate(base.toSnapshot()):null;
  if(localTributaries&&climate){
    const localPonds=deriveRegionalPonds(base,rivers.diagnostics.localTributaries?.regions??[],climate);
    const state=base.toSnapshot();delete state.worldId;delete state.sourceWorldId;
    state.references.localPonds=localPonds;state.revision=riverClimate?'planet-generator@24-climate-nested-water':'planet-generator@22-surveyed-ponds';base=createGlobalTerrain(state);
    climate=generateClimate(base.toSnapshot());
  }
  const population=climate?planAgriculturePopulation(base.toSnapshot(),climate,{targetPopulation}):null;
  const settlementDistribution=population?createL0SettlementDistribution(base.toSnapshot(),climate,population):null;
  const candidates = [];
  for (let i = 0; i < elevation.length; i++) {
    if (!landMask[i] || elevation[i] > seaLevelM + 1200 || Math.abs(point(i).latDeg) > 65) continue;
    const p = point(i), s = base.sampleAt(p.latDeg, p.lonDeg);
    if (s.groundElevationM < Math.max(seaLevelM, s.waterLevelElevationM ?? seaLevelM) + 15 || s.slopeMPerM > .05) continue;
    candidates.push({ ...p, cellIndex: i, score: s.groundElevationM - seaLevelM + s.slopeMPerM * 15000 - Math.log1p(hydrology.runoffIndex[i]) * 180, up: sphereBasis(p).up });
  }
  // River-bank settlements refer to existing spherical channels. They do not
  // create a second, disconnected stream merely to decorate a village.
  for (const profile of rivers.profiles) {
    if(profile.points.length<3)continue;
    const k=Math.min(profile.points.length-2,Math.floor(profile.points.length/2)),p=profile.points[k];
    if (Math.abs(p.latDeg)>65 || p.halfWidthM>40 || p.bankWidthM>60 || p.waterLevelElevationM<seaLevelM+15 || p.waterLevelElevationM>seaLevelM+1200) continue;
    const projection=createSphericalProjection({centerLatDeg:p.latDeg,centerLonDeg:p.lonDeg,radiusM,maxRadiusM:10000});
    const before=projection.toLocal(profile.points[k-1].latDeg,profile.points[k-1].lonDeg),after=projection.toLocal(profile.points[k+1].latDeg,profile.points[k+1].lonDeg);
    const dx=after.xM-before.xM,dy=after.yM-before.yM,len=Math.hypot(dx,dy),roadDirection={xM:-dy/len,yM:dx/len};
    const position=projection.toGeographic(-80*roadDirection.xM,-80*roadDirection.yM),sample=base.sampleAt(position.latDeg,position.lonDeg);
    if(sample.waterDepthM>0 || sample.slopeMPerM>.05 || sample.groundElevationM<seaLevelM+15)continue;
    candidates.push({...position,cellIndex:profile.sourceCellIndex??sample.sourceCellIndex,score:sample.groundElevationM-seaLevelM+sample.slopeMPerM*15000-1000,
      up:sphereBasis(position).up,riverProfile:{id:profile.id,pointIndex:k,point:p,before:profile.points[k-1],after:profile.points[k+1],runoffIndex:profile.runoffIndex??null}});
  }
  if(population){for(let i=candidates.length-1;i>=0;i--){const c=candidates[i],y=Math.max(0,Math.min(rows-1,Math.floor((90-c.latDeg)/180*rows))),x=((Math.floor(c.lonDeg/360*columns)%columns)+columns)%columns,ag=population.cells[y*columns+x];
   c.climateCellIndex=ag.cellIndex;c.agricultureSuitability=ag.suitability;
   if(ag.suitability<.1||ag.population===0)candidates.splice(i,1);else c.score-=ag.suitability*3000;
  }}
  candidates.sort((a, b) => (climatePlanning?0:Number(!!b.riverProfile)-Number(!!a.riverProfile)) || a.score - b.score || a.cellIndex - b.cellIndex);
  const settlements = [], recipes = [];
  for (const candidate of candidates) {
    if (settlements.length >= settlementCount) break;
    if (settlements.some(s => Math.acos(Math.max(-1, Math.min(1, s.up.reduce((v, a, i) => v + a * candidate.up[i], 0)))) * radiusM < radiusM * .10)) continue;
    const id = `settlement:${candidate.cellIndex}`, projection = createSphericalProjection({ centerLatDeg: candidate.latDeg,
      centerLonDeg: candidate.lonDeg, radiusM, maxRadiusM: 3000 });
    const ground = (x, y) => { const p = projection.toGeographic(x, y); return base.groundElevationAt(p.latDeg, p.lonDeg); };
    const bounds = { minXM: -350, maxXM: 350, minYM: -350, maxYM: 350 };
    const buildings = [], pads = [];let roads = [];
    const slope = base.sampleAt(candidate.latDeg, candidate.lonDeg).gradientEastNorth;
    const axis = Math.abs(slope.east) < Math.abs(slope.north) ? 'x' : 'y';
    let roadDirection=axis==='x'?{xM:1,yM:0}:{xM:0,yM:1},river=null;
    if(candidate.riverProfile){
      const orientation=createSphericalProjection({...projection.contract,maxRadiusM:10000});
      const r=candidate.riverProfile,a=orientation.toLocal(r.before.latDeg,r.before.lonDeg),b=orientation.toLocal(r.after.latDeg,r.after.lonDeg),p=projection.toLocal(r.point.latDeg,r.point.lonDeg),length=Math.hypot(b.xM-a.xM,b.yM-a.yM);
      roadDirection={xM:-(b.yM-a.yM)/length,yM:(b.xM-a.xM)/length};
      river={kind:'spherical-network-reference',profileId:r.id,pointIndex:r.pointIndex,location:r.point,waterLevelM:r.point.waterLevelElevationM,
        alongM:p.xM*roadDirection.xM+p.yM*roadDirection.yM,halfWidthM:r.point.halfWidthM,bankWidthM:r.point.bankWidthM,sourceCellIndex:candidate.cellIndex,runoffIndex:r.runoffIndex};
    }
    const local=(along,across)=>({xM:0+(roadDirection.xM*along-roadDirection.yM*across),yM:0+(roadDirection.yM*along+roadDirection.xM*across)});
    const model={schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null};
    const crossingM=river?Math.round(river.alongM/20)*20:0,halfSpanM=river?Math.ceil((river.halfWidthM+river.bankWidthM+10)/20)*20:0;
    const bridgeDeck=river?Math.max(river.waterLevelM+3,...[-halfSpanM,halfSpanM].map(offset=>{const p=local(crossingM+offset,0);return ground(p.xM,p.yM);}))+.5:null;
    const samples=Array.from({length:25},(_,i)=>{
      const along=-240+i*20,p=local(along,0),distanceToRiver=Math.abs(along-crossingM),natural=ground(p.xM,p.yM)+.12;
      const bridge=!!river&&distanceToRiver<=halfSpanM,approach=river?Math.max(0,1-Math.max(0,distanceToRiver-halfSpanM)/80):0;
      return {...p,distanceM:i*20,roadElevationM:bridge?bridgeDeck:natural*(1-approach)+bridgeDeck*approach,
        structureKind:bridge?'bridge-deck':'fill',segmentKind:river&&along>=crossingM-halfSpanM&&along<crossingM+halfSpanM?'bridge-deck':'fill'};
    });
    roads.push({ roadId: `${id}/main-road`, halfWidthM: 3, ...(river?{deckThicknessM:.8}:{}), samples });
    const bridgeStructures=river?[buildBridgeStructure({id:`${id}/bridge`,roadId:`${id}/main-road`,start:local(crossingM-halfSpanM,0),end:local(crossingM+halfSpanM,0),deckElevationM:bridgeDeck,widthM:6,groundAt:ground})]:[];
    if(bridgeStructures.some(s=>s.assessment.status!=='within-input-model'))continue;
    const streetPlan=villageRoads?extendVillageRoads({roads,groundAt:ground,waterAt:(x,y)=>{const p=projection.toGeographic(x,y);return base.sampleAt(p.latDeg,p.lonDeg);}}):{roads,junctions:[],branches:[],diagnostics:{method:'single-street@1',accepted:0}};roads=streetPlan.roads;
    if(roadCrownSlope>0)roads=metricRoads(roads).map(route=>{
      const intervals=streetPlan.junctions.filter(j=>j.roadIds.includes(route.id)).map(j=>{const d=j.members.find(m=>m.roadId===route.id).distanceM;return{startM:d-j.plateauRadiusM,endM:d+j.plateauRadiusM};});
      for(const segment of route.segments)if(route.at((segment.a.distanceM+segment.b.distanceM)/2).structureKind==='bridge-deck')intervals.push({startM:segment.a.distanceM,endM:segment.b.distanceM});
      return{...route.road,crossSection:{schema:ROAD_CROSS_SECTION_SCHEMA,crownSlope:roadCrownSlope,crossSlope:0,transitionLengthM:12,flatIntervals:mergeFlatRoadIntervals(intervals,route.lengthM)}};
    });
    let randomState=parseInt(createHash('sha256').update(`${seed}/${id}/lots`).digest('hex').slice(0,8),16)>>>0;
    const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/4294967296;};
    const lotCount=12+Math.floor(random()*17);
    const totalLots=lotCount+streetPlan.branches.length*8;
    for (let i = 0; i < totalLots; i++) {
      const rowCount=Math.ceil(lotCount/2),along=-205+Math.floor(i/2)*410/Math.max(1,rowCount-1)+(random()-.5)*8;
      let p;const across=(i % 2 ? 1 : -1) * (18 + random()*22);
      if(i<lotCount)p=local(along,across);else{const branch=streetPlan.branches[Math.floor((i-lotCount)/8)],distance=35+Math.floor((i-lotCount)%8/2)*23;p={xM:branch.root.xM+branch.direction.xM*distance-branch.direction.yM*across,yM:branch.root.yM+branch.direction.yM*distance+branch.direction.xM*across};}
      const widthM = 8 + random()*8, depthM = 9 + random()*8;
      const b = { minXM: p.xM - widthM / 2, maxXM: p.xM + widthM / 2, minYM: p.yM - depthM / 2, maxYM: p.yM + depthM / 2 };
      if(buildings.some(q=>b.minXM<q.bounds.maxXM+3&&b.maxXM>q.bounds.minXM-3&&b.minYM<q.bounds.maxYM+3&&b.maxYM>q.bounds.minYM-3))continue;
      const z = ground(p.xM, p.yM) + .20;
      const corners = [[b.minXM,b.minYM],[b.maxXM,b.minYM],[b.maxXM,b.maxYM],[b.minXM,b.maxYM]];
      if (river && Math.abs(p.xM*roadDirection.xM+p.yM*roadDirection.yM-river.alongM) < Math.hypot(widthM,depthM)/2+river.halfWidthM+river.bankWidthM+5) continue;
      if (corners.some(([x,y]) => ground(x,y) < seaLevelM + 5 || Math.abs(ground(x,y) - z) > 1.5)) continue;
      // A platform's cut/fill batter must not overwrite the carriageway,
      // including raised bridge approaches. Bound the whole straight corridor,
      // rather than checking only the building centre or road vertices.
      const acrossValues=corners.map(([x,y])=>-roadDirection.yM*x+roadDirection.xM*y);
      const sideDistance=Math.min(...acrossValues)>0?Math.min(...acrossValues):Math.max(...acrossValues)<0?-Math.max(...acrossValues):0;
      const maximumRoadDelta=Math.max(...samples.map(s=>Math.abs(s.roadElevationM-z)));
      const padBatterReach=Math.hypot(1,3*maximumRoadDelta);
      if(sideDistance<=3+padBatterReach+2)continue;
      const radius=Math.hypot(widthM,depthM)/2;
      if(roads.slice(1).some(road=>road.samples.slice(1).some((b,j)=>{const a=road.samples[j],dx=b.xM-a.xM,dy=b.yM-a.yM,t=Math.max(0,Math.min(1,((p.xM-a.xM)*dx+(p.yM-a.yM)*dy)/(dx*dx+dy*dy))),distance=Math.hypot(p.xM-a.xM-t*dx,p.yM-a.yM-t*dy),reach=Math.hypot(1,3*Math.max(Math.abs(a.roadElevationM-z),Math.abs(b.roadElevationM-z)));return distance<=radius+road.halfWidthM+reach+2;})))continue;
      const buildingId = `${id}/house:${i}`;
      pads.push({ id: buildingId, bounds: b, targetPadElevationM: z });
      buildings.push({ id: buildingId, bounds: b, baseElevationM: z, heightM: random()<.25?6.4:3.2,
        roofHeightM: 1.5+random(), wallColor: [.64+random()*.16, .60+random()*.13, .44+random()*.12], roofColor: [.30+random()*.18, .13+random()*.12, .08+random()*.10] });
    }
    if (buildings.length < 6) continue;
    settlements.push({ id, name: `集落 ${settlements.length + 1}`, ...candidate, buildings: buildings.length });
    const drainageRouting=planCulvertRouting({bounds,frame:projection.contract,regionId:id,worldId:base.worldId,
      groundElevationAt:ground,sampleAt:(x,y)=>({groundElevationM:ground(x,y)})},roads,pads,{design:culvertDesign});
    recipes.push({ id, drainageRouting, projection: projection.contract, bounds, model, riverSource: river,
      roadEarthworkOptions:{blendPolicy:'squared-odds@1'}, roadCenterlineProfiles: roads, roadJunctions:streetPlan.junctions, streetGeneration:streetPlan.diagnostics, bridgeStructures, buildingPads: pads, buildings });
  }
  const terminalSinks=new Set(hydrology.lakes.flatMap(l=>l.terminalSinkCellIndices??[])),wetSourceCells=landMask.filter((v,i)=>!v||hydrology.lakeFillDepthM[i]>0).length;
  return { base, ...(climate?{climate,population,settlementDistribution,landscape:{profile:LANDSCAPE_PROFILE,earthworkEnvelopePolicy:'c1-outer-earthwork-apron@1',urbanParcelTransition:'planned-block-boundaries@1',gardenParcelPolicy:'bounded-backland-gardens@1',urbanPublicSitePolicy:'surveyed-civic-chapel@1',urbanBlockSeedPolicy:'terrain-ranked-block-seeds@2',householdAccessPolicy:'surveyed-direct-household-access@1',streetRefinementPolicy:'surveyed-lattice-refinement@1',villagePortalPolicy:'bearing-led-boundary-portals@1',residentialStreetPolicy:'surveyed-residential-catchments@1',pondPolicy:'surveyed-communal-pond@2',publicGreenPolicy:'surveyed-sloping-commons@1',householdFrontagePolicy:'surveyed-household-frontages@2',woodlandPattern:'patchy-woodland-stands@1',fieldPattern:'surveyed-furlongs@2',landUseMosaic:'mixed-rainfed-hinterland@1',roadPadClearance:'surveyed-frontage-pads@1',...((localTributaries||riverDetail==='regional')?{settlementSiting:BALANCED_WATER_LED_SITING,riverbankAccessPolicy:'surveyed-riverbank-footpath@1'}:{}),parcelTransition:'village-footprints@1',roadParcelClipping:'surveyed-corridors@1',fieldSurvey:'local-triangle-clearance@1',seed,environmentPolicy:VALLEY_ENVIRONMENT_POLICY,annualRainMm:climate.annualPrecipitationMm,soilMoisture:climate.catchmentWater.meanSoilMoisture,grid:{columns,rows},biome:climate.biome,temperatureC:climate.annualMeanTemperatureC,baseElevationM:elevation}}:{}), recipes, settlements, focus: settlements[0] ? { latDeg: settlements[0].latDeg, lonDeg: settlements[0].lonDeg } : { latDeg: 0, lonDeg: 0 },
    diagnostics: { generationWorkBudget:{maxSourceCells,maxRiverPoints,sourceCells:columns*rows}, landCells: landMask.length-wetSourceCells, waterCells: wetSourceCells, oceanCells: hydrology.diagnostics.oceanCells, modeledTerminalSinks:terminalSinks.size,
      unresolvedLandTerminals: downstream.filter((v,i)=>landMask[i] && v<0 && !terminalSinks.has(i)).length,
      requestedSettlements: settlementCount, generatedSettlements: settlements.length,
      hydrologyScope: hydrology.diagnostics, globalRivers:rivers.diagnostics, localRiverCharts:0, riverSettlements: recipes.filter(r=>r.riverSource).length, rejectedRiverFits: settlements.filter(s=>s.riverFitRejected).map(s=>({id:s.id,reason:s.riverFitRejected})), riverGeometry: 'settlement crossings reference the same spherical river profiles; rejected source links remain explicit' } };
}

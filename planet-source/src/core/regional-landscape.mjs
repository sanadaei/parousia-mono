import {classifyEnvironment,ENVIRONMENT_POLICY,VALLEY_ENVIRONMENT_POLICY,usesEnvironmentPolicy} from './environment-cover.mjs';
import {planSettlementDistricts} from './settlement-districts.mjs';
import {createLandscapeFields} from './landscape-parcels.mjs';
import {createSphericalNoise} from './spherical-noise.mjs';
import {sphereBasis,greatCircle} from './spherical.mjs';
import {createPeriodicHermiteField} from './periodic-field.mjs';
/** A declared potential-land-cover scenario, not surveyed soils or historical
 * land ownership. The same query drives cover, tree placement and inspection. */
export const LANDSCAPE_PROFILE='medieval-regional-landscape@1';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const canopy={temperate_forest:.86,tropical_forest:.96,boreal:.80,savanna:.30,mediterranean:.35,grassland:.10,shrubland:.08,tundra:.01,desert:0,ice:0,ocean:0,lake:0};
const palette={woodland:[.20,.34,.15],scrub:[.39,.43,.23],meadow:[.47,.51,.25],heath:[.49,.44,.30],bare:[.63,.58,.43],snow:[.87,.89,.87],wet_meadow:[.32,.43,.26],settlement:[.48,.44,.33],arable:[.54,.48,.29],pasture:[.39,.46,.23]};
export function createRegionalLandscape(config,radiusM){
 if(config.profile!==LANDSCAPE_PROFILE||!Number.isFinite(radiusM)||radiusM<=0)throw new TypeError('Invalid landscape profile');
 const contexts=new WeakMap(),mixed=config.landUseMosaic==='mixed-rainfed-hinterland@1',landUse=createSphericalNoise(config.seed+'/mixed-land-use',radiusM,450);
 // This is a declared land-use scenario. A reserved grazing/woodlot mosaic
 // is not surveyed soil, crop yield, livestock capacity or a food balance.

 const {columns:w,rows:h}=config.grid,n=w*h;if(n>32768||config.biome.length!==n||config.temperatureC.length!==n||config.baseElevationM.length!==n)throw new RangeError('Invalid landscape field dimensions');
 const forest=createPeriodicHermiteField(config.biome.map(b=>canopy[b]??0),w,h),temp=createPeriodicHermiteField(config.temperatureC,w,h),height=createPeriodicHermiteField(config.baseElevationM,w,h),patch=createSphericalNoise(config.seed+'/land-cover',radiusM,1800),edge=createSphericalNoise(config.seed+'/woodland-edge',radiusM,220);
 const environmental=usesEnvironmentPolicy(config.environmentPolicy);
 if(environmental&&(!Array.isArray(config.annualRainMm)||config.annualRainMm.length!==n||!config.annualRainMm.every(v=>Number.isFinite(v)&&v>=0)||!Array.isArray(config.soilMoisture)||config.soilMoisture.length!==n||!config.soilMoisture.every(v=>Number.isFinite(v)&&v>=0&&v<=1)))throw new RangeError('Invalid environmental fields');
 const soil=environmental?createPeriodicHermiteField(config.soilMoisture,w,h):null,rain=environmental?createPeriodicHermiteField(config.annualRainMm,w,h):null;
 function sample(point,surface,{settlements=[],settlementClearance=null}={}){
  if(surface.waterDepthM>0)return{kind:'water',treeCover:0,color:[.12,.35,.43],reasons:['canonical-water-surface']};
  const x=((point.lonDeg%360+360)%360)/360*w,y=clamp((90-point.latDeg)/180*h,.5,h-.5),up=sphereBasis(point).up,temperature=temp(x,y)-.0065*(surface.groundElevationM-height(x,y)),potential=clamp(forest(x,y)),variation=.5+.30*patch(up)+.20*edge(up),slope=surface.slopeMPerM;
  let kind=temperature< -6?'snow':potential<.025?'bare':variation<potential?'woodland':potential>.25?'meadow':'heath';const reasons=['climate-potential-vegetation','fixed-spherical-patch-field'];
  if(Number.isFinite(slope)&&slope>.65){kind='bare';reasons.push('steep-exposed-ground');}
  if(surface.waterLevelElevationM!=null&&surface.groundElevationM-surface.waterLevelElevationM<2&&kind!=='snow'){kind='wet_meadow';reasons.push('low-water-margin');}
  let environment=null;
  if(environmental){
    const index=Math.min(h-1,Math.floor(y))*w+Math.min(w-1,Math.floor(x)),river=surface.riverEnvironment;
    environment=classifyEnvironment({policy:config.environmentPolicy,valleyFloorWidthM:config.environmentPolicy===VALLEY_ENVIRONMENT_POLICY?(river?.floodplainWidthM??0):0,biome:config.biome[index],temperatureC:temperature,annualRainMm:Math.max(0,rain(x,y)),soilMoisture:clamp(soil(x,y)),slopeMPerM:Number.isFinite(slope)?Math.max(0,slope):0,waterDepthM:Math.max(0,surface.waterDepthM??0),riverDistanceM:river?.bankDistanceM??null,heightAboveRiverM:river?surface.groundElevationM-river.waterLevelElevationM:null,patch:clamp((variation-.5)*2,-1,1)});
    kind=['forest','woodland','riparian_woodland'].includes(environment.kind)?'woodland':environment.kind==='wetland'?'wet_meadow':environment.kind==='grassland'?'meadow':['desert','rock'].includes(environment.kind)?'bare':environment.kind==='tundra'?'heath':environment.kind;
    reasons.push(...environment.reasons);
  }
  let context=contexts.get(settlements);if(!context){context=[...settlements].sort((a,b)=>b.population-a.population||a.id.localeCompare(b.id)).map(site=>{const plan=planSettlementDistricts(site,radiusM);return{site,plan,up:sphereBasis(site).up,projection:createSphericalProjection({centerLatDeg:site.latDeg,centerLonDeg:site.lonDeg,radiusM,maxRadiusM:Math.min(radiusM*.1,Math.max(2000,plan.extentM*2))})};});contexts.set(settlements,context);}
  let owner=null,distanceM=Infinity,reservedBy=null;
  for(const c of context){const distance=Math.acos(clamp(up.reduce((n,v,i)=>n+v*c.up[i],0),-1,1))*radiusM;
   if(distance<c.plan.extentM+100){const p=c.projection.toLocalIfWithin(point.latDeg,point.lonDeg);if(p&&settlementEnvelopeContains(p,c.plan)&&!(config.parcelTransition==='village-footprints@1'&&settlementClearance?.reserved(c.site.id,point)===false)){reservedBy=c.site;break;}}
   if((c.site.economicContext?.agriculturalDependentPopulation??c.site.population)>0&&(distance<distanceM||distance===distanceM&&c.site.id<(owner?.id??'~'))){distanceM=distance;owner=c.site;}
  }
  if(reservedBy){kind='settlement';owner=reservedBy;reasons.push('canonical-settlement-envelope');}
  else if(owner){const foodAreaM2=(owner.economicContext?.agriculturalDependentPopulation??owner.population)*(owner.economicContext?.foodKgPerPersonYear??250)/Math.max(100,owner.economicContext?.netGrainKgPerHa??250)*10000,fieldRadius=Math.sqrt(foodAreaM2/(Math.PI*(mixed?.7:1))+300*300);
   if(distanceM<Math.min(7000,fieldRadius)&&kind!=='snow'&&kind!=='wet_meadow'&&(!Number.isFinite(slope)||slope<.12)&&(owner.economicContext?.agricultureSuitability??0)>.15){kind='arable';reasons.push('settlement-food-hinterland','rain-fed-grain-scenario');if(mixed){const reserve=landUse(up);if(reserve<-.35){kind=potential>.25?'woodland':'pasture';reasons.push(kind==='woodland'?'retained-fuelwood-scenario':'grazing-reserve-scenario');}else if(reserve<-.15){kind='pasture';reasons.push('grazing-reserve-scenario');}reasons.push('allocation-scenario-not-verified-food-capacity');}}
  }
  if(environmental&&settlementClearance?.occupied?.(point,0)){kind='settlement';reasons.push('saved-feature-footprint');}
  return{kind,...(environment?{environment}:{}),treeCover:kind==='woodland'?(environment?.treeCover??clamp(potential+.2)):kind==='scrub'?.2:0,color:environment&&!['settlement','arable','pasture'].includes(kind)?environment.color:palette[kind],temperatureC:temperature,ownerId:owner?.id??null,reasons,profile:LANDSCAPE_PROFILE};
 }
 return{sample,profile:LANDSCAPE_PROFILE};
}
/** Fixed geographic tiles; visibility chooses which tiles load, never positions.
 * Longitude count follows latitude so polar rows do not allocate billions of
 * narrow cells. These are streaming units, not rectangular farm boundaries. */
export function landscapeTileGrid(radiusM,targetM=256){
 const rows=Math.ceil(Math.PI*radiusM/targetM),columns=row=>Math.max(1,Math.round(2*Math.PI*radiusM*Math.cos((90-(row+.5)*180/rows)*Math.PI/180)/targetM));
 const tile=(row,col)=>{const count=columns(row);col=(col%count+count)%count;return{id:`landscape:${row}:${col}`,row,col,latDeg:90-(row+.5)*180/rows,lonDeg:(col+.5)*360/count-180,latSpanDeg:180/rows,lonSpanDeg:360/count};};
 const at=(lat,lon)=>{const row=clamp(Math.floor((90-lat)/180*rows),0,rows-1),col=Math.floor((((lon+180)%360+360)%360)/360*columns(row));return tile(row,col);};
 return{rows,columns,tile,at,targetM};
}

export function landscapeDescriptors(radiusM,bound){
 const reach=bound.angular*radiusM;if(reach>5000)return[];
 const grid=landscapeTileGrid(radiusM),lat=Math.asin(clamp(bound.center[2],-1,1))*180/Math.PI,lon=Math.atan2(bound.center[1],bound.center[0])*180/Math.PI,center={latDeg:lat,lonDeg:lon},range=Math.min(2000,reach)+200,step=180/grid.rows,row0=grid.at(lat,lon).row,span=Math.ceil(range/radiusM*180/Math.PI/step),result=[],seen=new Set();
 for(let row=Math.max(0,row0-span);row<=Math.min(grid.rows-1,row0+span);row++){const cols=grid.columns(row),middle=grid.at(90-(row+.5)*step,lon).col,half=Math.min(Math.ceil(cols/2),Math.ceil(range/(2*Math.PI*radiusM*Math.max(.00001,Math.cos(lat*Math.PI/180))/cols))+1);for(let k=-half;k<=half;k++){const tile=grid.tile(row,middle+k),distance=greatCircle(center,tile,radiusM).distanceM;if(distance>range||seen.has(tile.id))continue;seen.add(tile.id);result.push({path:`procedural:${tile.id}`,landscapeTile:tile,visualOnly:true,center:sphereBasis(tile).up,angularRadius:400/radiusM,verticalAllowanceM:25,bytes:131072,procedural:true,distance});}}
 return result.sort((a,b)=>a.distance-b.distance||a.path.localeCompare(b.path)).slice(0,192);
}
function stableFraction(key){let h=2166136261;for(const c of key)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0)/4294967296;}
function scatteredFraction(key){let h=2166136261;for(const c of key)h=Math.imul(h^c.charCodeAt(0),16777619);h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return((h^(h>>>16))>>>0)/4294967296;}
export function createWoodlandRecipe(base,config,tile,{nearbySettlements=[],clearance=null,settlementClearance=null}={}){
 const ecology=createRegionalLandscape(config,base.frame.radiusM),projection=createSphericalProjection({centerLatDeg:tile.latDeg,centerLonDeg:tile.lonDeg,radiusM:base.frame.radiusM,maxRadiusM:2048}),buildings=[];
 const patchy=config.woodlandPattern==='patchy-woodland-stands@1',rand=patchy?scatteredFraction:stableFraction,stand=patchy?createSphericalNoise(config.seed+'/stand-density',base.frame.radiusM,48):null;
 const near=nearbySettlements.filter(s=>greatCircle(tile,s,base.frame.radiusM).distanceM<Math.max(7500,planSettlementDistricts(s,base.frame.radiusM).extentM+500));
 for(let y=0;y<20;y++)for(let x=0;x<20;x++){const key=`${config.seed}/${tile.id}/${x}/${y}`,u=(x+(patchy?.025:.2)+(patchy?.95:.6)*rand(key+'x'))/20,v=(y+(patchy?.025:.2)+(patchy?.95:.6)*rand(key+'y'))/20,p={latDeg:tile.latDeg+(v-.5)*tile.latSpanDeg,lonDeg:tile.lonDeg+(u-.5)*tile.lonSpanDeg},s=base.sampleSurfaceAt(p.latDeg,p.lonDeg),cover=ecology.sample(p,s,{settlements:near,settlementClearance});if(cover.kind!=='woodland')continue;
  // A fixed geographic canopy-gap field and independent hashes remove the
  // repeated plantation grid. This is a stand-density scenario, not forest age.
  if(patchy&&rand(key+'presence')>cover.treeCover*clamp(.72+.45*stand(sphereBasis(p).up),.2,.95))continue;
  const local=projection.toLocalIfWithin(p.latDeg,p.lonDeg);if(!local||clearance?.occupied(local,7)||settlementClearance?.occupied?.(p,7))continue;const east=projection.toGeographic(local.xM+3,local.yM),north=projection.toGeographic(local.xM,local.yM+3),slope=Math.hypot(base.groundElevationAt(east.latDeg,east.lonDeg)-s.groundElevationM,base.groundElevationAt(north.latDeg,north.lonDeg)-s.groundElevationM)/3;if(slope>.65)continue;
  const r=.18+rand(key+'trunk')*.22,height=7+rand(key+'height')*10;buildings.push({id:`${tile.id}/tree:${x}:${y}`,vegetationKind:'tree',canopyRadiusM:4+rand(key+'crown')*2,bounds:{minXM:local.xM-r,maxXM:local.xM+r,minYM:local.yM-r,maxYM:local.yM+r},baseElevationM:s.groundElevationM,heightM:height,roofHeightM:0,wallColor:[.31,.23,.14],roofColor:[.17,.31+rand(key+'green')*.1,.13]});
 }
 return{id:tile.id,projection:projection.contract,bounds:{minXM:-400,maxXM:400,minYM:-400,maxYM:400},model:{schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null},vegetation:buildings,landParcels:createLandscapeFields(base,config,tile,landscapeTileGrid(base.frame.radiusM),ecology,near,clearance,settlementClearance),buildings:[],buildingPads:[],roadCenterlineProfiles:[],sparseRoadOverlay:true,landscapeStatus:{profile:config.profile,trees:buildings.length,scope:'Potential woodland outside settlement/food clearings; individual stable trunks and crowns. No forest age or forestry simulation.'}};
}
import {createSphericalProjection} from './spherical.mjs';
import {WATER_SCHEMA} from './water-model.mjs';

function settlementEnvelopeContains(p,plan){const column=Math.round(p.xM/plan.widthM),row=Math.round(p.yM/plan.heightM);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const x=column+dx,y=row+dy,r=Math.max(Math.abs(x),Math.abs(y)),d=y===-r?r-x:x===-r?2*r+y+r:y===r?4*r+x+r:6*r+r-y,index=r?(2*r+1)**2-1-d:0;if(index<plan.count&&Math.abs(p.xM-x*plan.widthM)<plan.widthM/2+40&&Math.abs(p.yM-y*plan.heightM)<plan.heightM/2+40)return true;}return false;}

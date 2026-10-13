import {hashJson} from './json-contract.mjs';
import {refineSettlementDistribution} from './settlement-distribution.mjs';
/** L1 is a saved broad-scale parent for L2. It adopts an explicitly selected
 * resolution stage, projects existing L0 climate, and retains its water graph.
 * Projection is not a new atmosphere simulation or resolved channel geometry.
 */
export function createL1BroadRegion(parent,level){
 const {snapshot:s,climate:c}=parent??{},w=level?.columns,h=level?.rows,n=w*h,pw=s?.grid?.columns,ph=s?.grid?.rows;
 const distribution=parent?.settlementDistribution;
 if(!s||!c||c.sourceWorldId!==s.worldId||level?.sourceWorldId!==s.worldId||!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||n>131072||w<pw||h<ph||w/pw!==h/ph||!Number.isInteger(w/pw)||((w/pw)&(w/pw-1))!==0)throw Error('Matching bounded L0 and power-of-two resolution stage required');
 for(const a of [level.elevation,level.water?.oceanCells,level.water?.lakeFillDepthM,level.water?.downstream])if(!Array.isArray(a)||a.length!==n)throw Error('Complete resolution-stage fields required');
 for(const a of [c.annualMeanTemperatureC,c.annualPrecipitationMm,c.catchmentWater?.annualLocalYieldMm,c.catchmentWater?.meanSoilMoisture,s.fields.groundElevationM])if(!Array.isArray(a)||a.length!==pw*ph||!a.every(Number.isFinite))throw Error('Complete parent climate projection fields required');
 if(!level.elevation.every(Number.isFinite)||!level.water.oceanCells.every(v=>v===0||v===1)||!level.water.lakeFillDepthM.every(v=>Number.isFinite(v)&&v>=0)||!level.water.downstream.every((v,i)=>Number.isSafeInteger(v)&&v>=-1&&v<n&&v!==i))throw Error('Invalid stage terrain or drainage');
 if(!Array.isArray(c.biome)||c.biome.length!==pw*ph||!Array.isArray(s.fields.landMask)||s.fields.landMask.length!==pw*ph||!Number.isFinite(s.frame?.radiusM)||s.frame.radiusM<=0)throw Error('Valid parent grid and climate classifications required');
 if(distribution!==undefined&&(distribution.layer!=='L0'||distribution.sourceWorldId!==s.worldId||distribution.climateId!==c.id||distribution.grid?.columns!==pw||distribution.grid?.rows!==ph))throw Error('Parent settlement distribution must be an L0 distribution for this world, climate and grid');
 const expected=hashJson({schema:level.schema,stage:level.stage,sourceWorldId:level.sourceWorldId,parentId:level.parentId,columns:w,rows:h,elevation:level.elevation,water:level.water,upstreamAreaM2:level.upstreamAreaM2});
 if(expected!==level.id)throw Error('Resolution stage content identity mismatch');
 const scale=w/pw,land=level.water.oceanCells.map(v=>1-v),area=[],temp=[],rain=[],yieldMm=[],soil=[],biome=[],parentCell=[],province=[];
 const sample=(a,x,y)=>{const xx=(x+.5)/scale-.5,yy=(y+.5)/scale-.5,ix=Math.floor(xx),iy=Math.max(0,Math.min(ph-2,Math.floor(yy))),u=xx-ix,v=Math.max(0,Math.min(1,yy-iy)),at=(dx,dy)=>a[(iy+dy)*pw+((ix+dx)%pw+pw)%pw];return at(0,0)*(1-u)*(1-v)+at(1,0)*u*(1-v)+at(0,1)*(1-u)*v+at(1,1)*u*v;};
 let coastChangedCells=0;
 for(let i=0;i<n;i++){
  const x=i%w,y=Math.floor(i/w),p=Math.floor(y/scale)*pw+Math.floor(x/scale),z=level.elevation[i];parentCell.push(p);
  area.push(s.frame.radiusM**2*2*Math.PI/w*(Math.sin((90-y*180/h)*Math.PI/180)-Math.sin((90-(y+1)*180/h)*Math.PI/180)));
  temp.push(sample(c.annualMeanTemperatureC,x,y)-.0065*(z-sample(s.fields.groundElevationM,x,y)));
  rain.push(Math.max(0,sample(c.annualPrecipitationMm,x,y)));soil.push(Math.max(0,Math.min(1,sample(c.catchmentWater.meanSoilMoisture,x,y))));
  // Preserve parent-local yield intensity. New coastal land with no parent
  // runoff evidence remains zero and is explicitly counted as unresolved.
  yieldMm.push(land[i]?Math.max(0,c.catchmentWater.annualLocalYieldMm[p]):0);
  biome.push(!land[i]?'ocean':level.water.lakeFillDepthM[i]>0?'lake':['ocean','lake'].includes(c.biome[p])?'unresolved-coastal':c.biome[p]);
  if(land[i]!==s.fields.landMask[p])coastChangedCells++;
  const neighbours=[y*w+(x+w-1)%w,y*w+(x+1)%w,...(y?[i-w]:[]),...(y<h-1?[i+w]:[])];
  const relief=Math.max(z,...neighbours.map(j=>level.elevation[j]))-Math.min(z,...neighbours.map(j=>level.elevation[j]));
  province.push(!land[i]?'ocean':level.water.lakeFillDepthM[i]>0?'lake':relief>1000?'mountain':z>1000?'highland':relief<300?'low-relief':'mixed-relief');
 }
 const down=[...level.water.downstream],incoming=new Uint32Array(n),order=[],volume=yieldMm.map((v,i)=>v/1000*area[i]),localVolume=volume.reduce((a,b)=>a+b,0);
 for(const j of down)if(j>=0)incoming[j]++;
 for(let i=0;i<n;i++)if(!incoming[i])order.push(i);
 for(let k=0;k<order.length;k++){const i=order[k],j=down[i];if(j>=0){volume[j]+=volume[i];if(!--incoming[j])order.push(j);}}
 if(order.length!==n)throw Error('Cyclic L1 water graph');
 const layerId=hashJson({schema:'l1-broad-region@1',sourceWorldId:s.worldId,climateId:c.id,resolutionId:level.id,projection:'l0-climate-bilinear-lapse; parent-local-yield@1',...(distribution?{parentDistributionId:distribution.id}:{})});
 const snapshot={schema:'l1-parent-fields@1',worldId:s.worldId,layerId,layer:'L1',parentLayerId:s.layerId??s.worldId,grid:{columns:w,rows:h},frame:{...s.frame},fields:{groundElevationM:[...level.elevation],landMask:land,lakeFillDepthM:[...level.water.lakeFillDepthM],downstream:down},references:{macroRecipe:s.references.macroRecipe,sea:s.references.sea,lakes:level.water.lakes,climateForcing:s.references.climateForcing??null}};
 const climateContent={schema:'l1-projected-climate@1',sourceWorldId:s.worldId,sourceLayerId:layerId,parentClimateId:c.id,grid:snapshot.grid,cellAreaM2:area,annualMeanTemperatureC:temp,annualPrecipitationMm:rain,biome,catchmentWater:{annualLocalYieldMm:yieldMm,meanSoilMoisture:soil,annualRoutedYieldM3:volume,meanPotentialFlowM3PerSecond:volume.map(v=>v/(365*86400))},interpretation:'Projected coarse climate; no new rainfall transport or monthly model'};
 const climate={...climateContent,id:hashJson(climateContent)},output=volume.reduce((sum,v,i)=>sum+(down[i]<0?v:0),0);
 const region={schema:'l1-broad-region@1',id:layerId,sourceWorldId:s.worldId,resolutionId:level.id,snapshot,climate,parentCell,provinceKind:province,diagnostics:{cells:n,coastChangedCells,localPotentialYieldM3PerYear:localVolume,exportedOrTerminalM3PerYear:output,relativeBudgetResidual:Math.abs(output-localVolume)/Math.max(1,localVolume)},status:'terrain and climate parent available to L2; hydraulic boundary adoption incomplete',limits:['Province classes are rough relief descriptors, not geological classification','New coastline cells require refined climate/water evidence','Previous resolution drainage topology is not constrained','L2 still needs receiving-water crossings and imported upstream flow','Not a new complete world snapshot; use as a regional parent']};
 // Inherit the parent's settlement budget only when the parent actually carries
 // one. The L1 layer identity above already includes the parent distribution id,
 // so two deployments of the same terrain with different populations cannot
 // share an L1 id. Terrain and climate numbers are never changed by population.
 if(distribution!==undefined)region.settlementDistribution=refineSettlementDistribution(distribution,{sourceWorldId:s.worldId,climateId:climate.id,sourceLayerId:layerId,grid:{columns:w,rows:h},parentCell,cellAreaM2:area,landMask:land,lakeFillDepthM:level.water.lakeFillDepthM});
 return region;
}

import {selectResearchRiverRoute} from './terrain-cost-routing.mjs';
import {auditRiverRouteTopology} from './river-route-topology.mjs';
import {createSphericalRiverSampler} from './planet-rivers.mjs';
/** Refine paths before local tributaries and settlements exist. Heights are
 * sampled from uncarved terrain; graph nodes and reservoir levels stay fixed.
 * This is a bounded lower-incision corridor, not a sediment/meander simulator. */
export function refineTerrainRiverRoutes(base,network,{maxRoutes=64,maxPoints=32768,profileStepM=1000}={}){
 if(!Number.isInteger(maxRoutes)||maxRoutes<0||maxRoutes>128||!Number.isInteger(maxPoints)||maxPoints<2||maxPoints>131072||!Number.isFinite(profileStepM)||profileStepM<=0)throw new RangeError('Invalid route refinement budget');
 if(base.toSnapshot().references.rivers)throw new Error('Uncarved source terrain required');
 let points=network.profiles.reduce((n,p)=>n+p.points.length,0);if(points>maxPoints)throw new RangeError('Existing river point budget exceeded');
 const profiles=[...network.profiles],attempts=[];
 for(let i=0;i<profiles.length;i++){
  const original=profiles[i];if(i>=maxRoutes){attempts.push({id:original.id,status:'route-budget'});continue;}
  const first=original.points[0],last=original.points.at(-1),halfWidthM=Math.min(20000,original.lengthM*.08,network.radiusM*.02);
  if(!(halfWidthM>100)){attempts.push({id:original.id,status:'short-reach-retained'});continue;}
  const step=Math.min(profileStepM,network.radiusM*Math.min(Math.PI/network.grid.rows,2*Math.PI/network.grid.columns*Math.max(.001,Math.cos(Math.max(Math.abs(first.latDeg),Math.abs(last.latDeg))*Math.PI/180)))/4);
  const result=selectResearchRiverRoute(first,last,{sampleSurface:(lat,lon)=>base.sampleSurfaceAt(lat,lon),radiusM:network.radiusM,depthM:first.depthM,maxIncisionM:network.diagnostics.maxIncisionM,stepM:step,maxPoints:8192,corridorStepM:Math.max(1000,(original.lengthM??10000)/96),halfWidthM});
  const direct=result.candidates[0],rounded=result.candidates.find(c=>c.kind==='rounded-terrain-corridor');
  if(!rounded?.fit.valid||result.search.boundaryContactNodes>0||direct.fit.valid&&rounded.fit.scoreM>=direct.fit.scoreM*.99){attempts.push({id:original.id,status:'original-retained',reason:!rounded?.fit.valid?'no-feasible-rounded-path':result.search.boundaryContactNodes>0?'search-boundary':'no-material-cost-improvement'});continue;}
  if(points-original.points.length+rounded.fit.points.length>maxPoints){attempts.push({id:original.id,status:'original-retained',reason:'point-budget'});continue;}
  // Do not leave the coarse cells already occupied by this reach. This is
  // a conservative corridor restriction, not a fine catchment boundary claim.
  const cell=p=>Math.min(network.grid.rows-1,Math.max(0,Math.floor((90-p.latDeg)/180*network.grid.rows)))*network.grid.columns+Math.floor(((p.lonDeg%360+360)%360)/360*network.grid.columns);
  const allowedCells=new Set(original.points.map(cell));
  if(rounded.fit.points.some(p=>!allowedCells.has(cell(p)))){attempts.push({id:original.id,status:'original-retained',reason:'outside-source-cell-corridor'});continue;}
  const topology=auditRiverRouteTopology({...network,profiles},original,rounded.path);
  if(!topology.complete||!topology.valid){attempts.push({id:original.id,status:'original-retained',reason:'network-crossing',topology});continue;}
  const candidate={...original,lengthM:rounded.fit.lengthM,maximumSampledIncisionM:rounded.fit.maximumIncisionM,points:rounded.fit.points.map(p=>({latDeg:p.latDeg,lonDeg:p.lonDeg,waterLevelElevationM:p.waterLevelElevationM,halfWidthM:first.halfWidthM,depthM:first.depthM,bankWidthM:Math.max(first.halfWidthM,(network.diagnostics.valleySideRunPerRise??0)*p.incisionM)})),routing:{method:'terrain-cost-rounded-corridor@1',sourceRouting:original.routing,halfWidthM,sampledStepM:step,scoreImprovement:direct.fit.valid?1-rounded.fit.scoreM/direct.fit.scoreM:null}};
  try{createSphericalRiverSampler({...network,profiles:[...profiles.slice(0,i),candidate,...profiles.slice(i+1)]});}catch(e){attempts.push({id:original.id,status:'original-retained',reason:'shared-profile-contract',detail:e.message});continue;}
  points+=candidate.points.length-original.points.length;profiles[i]=candidate;attempts.push({id:original.id,status:'refined',lengthM:candidate.lengthM,scoreImprovement:candidate.routing.scoreImprovement});
 }
 return {...network,profiles,diagnostics:{...network.diagnostics,pointCount:points,terrainRoutes:{method:'terrain-cost-rounded-corridor@1',attempts,refined:attempts.filter(a=>a.status==='refined').length,scope:'Fixed graph endpoints and sampled monotone profiles; centerline crossing guard. No sediment dynamics, bank-overlap or sub-sample height certificate.'}}};
}

import {channelPlanform} from './river-planform.mjs';
import {fitResearchRiverPath} from './terrain-cost-routing.mjs';
/** Resolve low-gradient planforms BEFORE tributaries and settlement placement. */
export function applyLowGradientPlanforms(base,network,{maxPoints=32768,maxRoutes=64,confinement='whole-reach@1'}={}){
 if(!Number.isInteger(maxPoints)||maxPoints<2||maxPoints>131072||!Number.isInteger(maxRoutes)||maxRoutes<0||maxRoutes>128)throw new RangeError('Invalid planform budget');
 if(base.toSnapshot().references.rivers)throw new Error('Uncarved planform terrain required');
 if(!['whole-reach@1','local-taper@2'].includes(confinement))throw new RangeError('Invalid confinement policy');
 const method=confinement==='local-taper@2'?'locally-confined-width-scaled-planform@2':'low-gradient-width-scaled-planform@1';
 const profiles=[...network.profiles],attempts=[],sampleSurface=(lat,lon)=>base.sampleSurfaceAt(lat,lon);
 let count=profiles.reduce((n,p)=>n+p.points.length,0);if(count>maxPoints)throw new RangeError('Existing planform point budget exceeded');
 for(let i=0;i<profiles.length;i++){
  const original=profiles[i];if(i>=maxRoutes){attempts.push({id:original.id,status:'route-budget'});continue;}
  const proposal=channelPlanform(original,network.radiusM,{sampleSurface,confinement});if(!proposal.path){attempts.push({id:original.id,status:proposal.status});continue;}
  const first=original.points[0],last=original.points.at(-1),step=Math.min(1000,proposal.wavelengthM/20,network.radiusM*Math.min(Math.PI/network.grid.rows,2*Math.PI/network.grid.columns*Math.max(.001,Math.cos(Math.max(Math.abs(first.latDeg),Math.abs(last.latDeg))*Math.PI/180)))/4);
  const fit=fitResearchRiverPath(proposal.path,{sampleSurface,radiusM:network.radiusM,startLevelM:first.waterLevelElevationM,endLevelM:last.waterLevelElevationM,depthM:first.depthM,maxIncisionM:network.diagnostics.maxIncisionM,stepM:step});
  if(!fit.valid){attempts.push({id:original.id,status:fit.reason});continue;}
  if(count-original.points.length+fit.points.length>maxPoints){attempts.push({id:original.id,status:'total-point-budget'});continue;}
  const cell=p=>Math.min(network.grid.rows-1,Math.max(0,Math.floor((90-p.latDeg)/180*network.grid.rows)))*network.grid.columns+Math.floor(((p.lonDeg%360+360)%360)/360*network.grid.columns),cells=new Set(original.points.map(cell));
  if(fit.points.some(p=>!cells.has(cell(p)))){attempts.push({id:original.id,status:'outside-source-cell-corridor'});continue;}
  const topology=auditRiverRouteTopology({...network,profiles},original,proposal.path);if(!topology.complete||!topology.valid){attempts.push({id:original.id,status:'network-crossing'});continue;}
  const candidate={...original,lengthM:fit.lengthM,maximumSampledIncisionM:fit.maximumIncisionM,points:fit.points.map(p=>({latDeg:p.latDeg,lonDeg:p.lonDeg,waterLevelElevationM:p.waterLevelElevationM,halfWidthM:first.halfWidthM,depthM:first.depthM,bankWidthM:Math.max(first.halfWidthM,(network.diagnostics.valleySideRunPerRise??0)*p.incisionM)})),routing:{method,sourceRouting:original.routing??null,wavelengthM:proposal.wavelengthM,maxOffsetM:proposal.maxOffsetM,gradient:proposal.gradient,...(confinement==='local-taper@2'?{confinement,confinedSamples:proposal.confinedSamples,endpointTransitionM:proposal.endpointTransitionM}:{}),assumptions:'Cohesive-bank scenario; not sediment, flood or cutoff simulation'}};
  try{createSphericalRiverSampler({...network,profiles:[...profiles.slice(0,i),candidate,...profiles.slice(i+1)]});}catch(e){attempts.push({id:original.id,status:'profile-contract',detail:e.message});continue;}
  count+=candidate.points.length-original.points.length;profiles[i]=candidate;attempts.push({id:original.id,status:'adopted',wavelengthM:proposal.wavelengthM,maxOffsetM:proposal.maxOffsetM});
 }
 return {...network,profiles,diagnostics:{...network.diagnostics,pointCount:count,channelPlanforms:{method,adopted:attempts.filter(a=>a.status==='adopted').length,attempts}}};
}

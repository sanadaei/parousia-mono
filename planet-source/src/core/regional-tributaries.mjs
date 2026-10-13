import {createPeriodicHermiteField} from './periodic-field.mjs';
import {analyzeLocalDrainage} from './local-drainage.mjs';
import {compileLocalChannels} from './local-channel-profiles.mjs';
import {createSphericalProjection,greatCircle} from './spherical.mjs';
import {createSphericalRiverSampler} from './planet-rivers.mjs';

/** Compile a bounded, immutable set of receiving-river neighbourhoods BEFORE
 * settlement selection. This is partial coverage, never a global river claim.
 * Regions are selected from the saved macro network, not the visible camera.
 * Non-overlapping survey disks avoid competing ownership of local channels. */
export function deriveRegionalTributaries(base,network,{maxRegions=64,maxTotalPoints=32768,gridSize=129,cellSizeM=64,minChannelAreaM2=100000,climate=null,minimumFlowM3PerSecond=.001,profileStepM=4,maxIncisionM=2,scaleId=null,parentProfileIds=null,referencePoints=null}={}) {
 if(!Number.isSafeInteger(maxRegions)||maxRegions<0||maxRegions>128||!Number.isSafeInteger(maxTotalPoints)||maxTotalPoints<2||maxTotalPoints>131072||!Number.isSafeInteger(gridSize)||gridSize<5||gridSize>255||gridSize%2!==1||!Number.isFinite(cellSizeM)||cellSizeM<=0||!Number.isFinite(minChannelAreaM2)||minChannelAreaM2<=0)throw new RangeError('Invalid regional tributary budget');
 if(!Number.isFinite(minimumFlowM3PerSecond)||minimumFlowM3PerSecond<=0)throw new RangeError('Invalid minimum local flow');
 let yieldField=null;if(climate){const {columns,rows}=network.grid,values=climate.catchmentWater?.annualLocalYieldMm;if(!Array.isArray(values)||values.length!==columns*rows||!values.every(v=>Number.isFinite(v)&&v>=0)||typeof climate.catchmentWater.id!=='string')throw new RangeError('Climate local yield field required');yieldField=createPeriodicHermiteField(values,columns,rows);}
 if(scaleId!==null&&(typeof scaleId!=='string'||!/^[a-z0-9-]{1,32}$/.test(scaleId)))throw new RangeError('Invalid survey scale ID');
 if(parentProfileIds!==null&&(!Array.isArray(parentProfileIds)||parentProfileIds.length>128||new Set(parentProfileIds).size!==parentProfileIds.length||parentProfileIds.some(id=>!network.profiles.some(p=>p.id===id))))throw new RangeError('Invalid receiving profile selection');
 if(referencePoints!==null&&(!Array.isArray(referencePoints)||referencePoints.length>128||new Set(referencePoints.map(r=>r?.parentId)).size!==referencePoints.length||referencePoints.some(r=>{if(!r||typeof r!=='object')return true;const p=network.profiles.find(p=>p.id===r.parentId);return (parentProfileIds!==null&&!parentProfileIds.includes(r.parentId))||!p||!Number.isSafeInteger(r.pointIndex)||r.pointIndex<0||r.pointIndex>=p.points.length;})))throw new RangeError('Invalid receiving river reference points');
 const references=new Map((referencePoints??[]).map(r=>[r.parentId,r.pointIndex]));
 const selectedParents=parentProfileIds?parentProfileIds.map(id=>network.profiles.find(p=>p.id===id)):[...network.profiles].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 const half=(gridSize-1)*cellSizeM/2,radius=base.frame.radiusM,supportRadiusM=Math.SQRT2*half+32;
 if(supportRadiusM>radius*.02)throw new RangeError('Tributary survey exceeds local projection extent');
 const nodes=[...network.nodes],profiles=[...network.profiles],regions=[],withheld=[],occupied=[];
 let pointCount=profiles.reduce((n,p)=>n+p.points.length,0);
 if(pointCount>maxTotalPoints)throw new RangeError('Existing rivers exceed total point budget');
 const sample=(lat,lon)=>base.sampleSurfaceAt(lat,lon);
 for(const parent of selectedParents){
  const referenceIndex=references.get(parent.id),center=parent.points[referenceIndex??Math.floor(parent.points.length/2)];
  if(regions.length>=maxRegions||pointCount+2>maxTotalPoints){withheld.push({parentId:parent.id,reason:'regional-work-budget'});continue;}
  if(occupied.some(p=>greatCircle(center,p,radius).distanceM<2*supportRadiusM)){withheld.push({parentId:parent.id,reason:'overlapping-survey-ownership'});continue;}
  occupied.push(center);
  const id=referenceIndex!=null?`tributary-region@4/${scaleId??'local'}/${parent.id}/point:${referenceIndex}`:scaleId?`tributary-region@3/${scaleId}/${parent.id}`:`tributary-region@2/${parent.id}`,projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM:radius,maxRadiusM:supportRadiusM}),elevation=[],outlets=[];
  for(let y=0;y<gridSize;y++)for(let x=0;x<gridSize;x++){
   const p=projection.toGeographic(x*cellSizeM-half,y*cellSizeM-half),s=sample(p.latDeg,p.lonDeg),cell=y*gridSize+x;
   if(!Number.isFinite(s.groundElevationM)||s.waterDepthM==null)throw new Error('Regional drainage requires known natural terrain and water');
   elevation.push(s.groundElevationM);
   if(s.waterDepthM>0){if(!s.waterSourceIds?.length||!Number.isFinite(s.waterLevelElevationM))throw new Error('Receiving water identity and level are required');outlets.push({cell,id:[...s.waterSourceIds].sort().join('|'),kind:s.surfaceKind==='sea-level-water'?'sea':s.surfaceKind?.includes('lake')?'lake':'river',levelM:s.waterLevelElevationM});}
  }
  const analysis=analyzeLocalDrainage({columns:gridSize,rows:gridSize,cellSizeM,elevation,outlets,minChannelAreaM2});
  const climateSupply=yieldField?{sourceId:climate.catchmentWater.id,annualLocalYieldMm:Math.max(0,yieldField(((center.lonDeg%360+360)%360)/360*network.grid.columns,Math.max(.5,Math.min(network.grid.rows-.5,(90-center.latDeg)/180*network.grid.rows)))),minimumFlowM3PerSecond}:null;
  const local=compileLocalChannels({id,analysis,climateSupply,profileStepM,maxIncisionM,projection,sampleSurface:sample,pathPolicy:'rounded-survey-path@1',indexGrid:network.grid,maxPoints:Math.min(8192,maxTotalPoints-pointCount)});
  pointCount+=local.diagnostics.pointCount;nodes.push(...local.nodes);profiles.push(...local.profiles);
  regions.push({id,parentId:parent.id,center:{latDeg:center.latDeg,lonDeg:center.lonDeg},supportRadiusM,gridSize,cellSizeM,drainage:analysis.diagnostics,compilation:local.diagnostics});
 }
 const result={...network,nodes,profiles,diagnostics:{...network.diagnostics,pointCount,acceptedProfiles:profiles.length,localTributaries:{method:scaleId?'nested-bounded-receiving-neighbourhoods@3':'bounded-receiving-neighbourhoods@2',maxRegions,maxTotalPoints,regions:[...(network.diagnostics.localTributaries?.regions??[]),...regions],withheld:[...(network.diagnostics.localTributaries?.withheld??[]),...withheld],stages:[...(network.diagnostics.localTributaries?.stages??[]),{scaleId,gridSize,cellSizeM,profileStepM,maxIncisionM,minChannelAreaM2,regions:regions.length}],scope:'Partial fixed river neighbourhoods; open boundaries and unmodeled depressions withheld. Scenario stream width/depth; no rainfall/discharge model.'}}};
 createSphericalRiverSampler(result);
 return result;
}

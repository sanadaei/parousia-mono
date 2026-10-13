import { roadCrossSectionAt } from '../src/core/road-cross-section.mjs';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {pathToFileURL,fileURLToPath} from 'node:url';
import {generatePlanet} from '../src/core/planet-generation.mjs';import {snapshotPlanetWorld,restorePlanetWorld} from '../src/core/planet-world.mjs';import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';import {metricRoads} from '../src/core/road-geometry.mjs';import {packageGlobe} from './package-globe.mjs';import {PagedSource} from '../src/globe/paged-source.mjs';import {buildBuildingMesh} from '../src/globe/buildings.mjs';import {requireVerificationMemory} from './verification-runtime.mjs';
requireVerificationMemory();
const valleyMode=process.argv.includes('--valleys');
const riverOptions=valleyMode?{riverValleys:{maxIncisionM:600,sideRunPerRise:3}}:{};

const inputs=[{seed:'planet-1'},{seed:'planet-a'},{seed:'planet-b'},{seed:'planet-terminal',lakeFillFraction:.6},{seed:'planet-1',lakeFillFraction:.6}],results=[];
for(const input of inputs){
 const world=generatePlanet({...input,...riverOptions}),snapshot=snapshotPlanetWorld(world),restored=restorePlanetWorld(JSON.stringify(snapshot));assert.deepEqual(restored.toSnapshot(),snapshot);
 const bridgeChecks=world.recipes.flatMap(r=>(r.bridgeStructures??[]).map(s=>({input:{id:s.id,spanM:Math.hypot(s.end.xM-s.start.xM,s.end.yM-s.start.yM)/s.spanCount,beamWidthM:s.beamWidthM,beamDepthM:s.beamDepthM,material:s.material,loads:s.loads},output:s.assessment,foundationStatus:s.foundationStatus,hydraulicObstructionStatus:s.hydraulicObstructionStatus})));
 for(const check of bridgeChecks)assert.equal(check.output.status,'within-input-model');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'planet-audit-'));
 try{const manifest=packageGlobe(world.base,directory,{recipes:world.recipes,focus:world.focus});
 const fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return {ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};};
 const source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);
 const network=world.base.toSnapshot().references.rivers;let riverProbes=0,maximumRiverParityErrorM=0,dryRiverProbes=0;const riverExamples=[];
 for(const profile of network.profiles)for(let k=1;k<profile.points.length;k++)for(const t of [.25,.5,.75]){
 const a=profile.points[k-1],b=profile.points[k],v=p=>{const lat=p.latDeg*Math.PI/180,lon=p.lonDeg*Math.PI/180;return[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];},av=v(a),bv=v(b),d=av.map((x,i)=>x*(1-t)+bv[i]*t),p={latDeg:Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI,lonDeg:Math.atan2(d[1],d[0])*180/Math.PI};
 const expected=world.base.sampleAt(p.latDeg,p.lonDeg),actual=await source.ready(()=>source.sample(p.latDeg,p.lonDeg));riverProbes++;if(!(expected.waterDepthM>0))dryRiverProbes++;
 maximumRiverParityErrorM=Math.max(maximumRiverParityErrorM,Math.abs(actual.groundElevationM-expected.groundElevationM),Math.abs(actual.waterDepthM-expected.waterDepthM));
 if(riverExamples.length<3)riverExamples.push({input:{profileId:profile.id,...p},output:actual});
 }
 assert.equal(dryRiverProbes,0,'Accepted global river centerlines must remain wet between stored stations');assert.ok(maximumRiverParityErrorM<1e-6);
 let houseCount=0,roadProbes=0,wetBridgeProbes=0,minClearanceM=Infinity,maxRoadErrorM=0,maxGroundRoadErrorM=0,maxFoundationErrorM=0;const examples=[];
 for(const recipe of world.recipes){const chart=createGlobeFeatureChart(world.base,recipe),mesh=buildBuildingMesh(recipe,world.base.frame.radiusM,{includeRoads:true});assert.ok(mesh.index.length>0);
 await source.enableFeaturesAt({latDeg:recipe.projection.centerLatDeg,lonDeg:recipe.projection.centerLonDeg});
 for(const house of recipe.buildings){houseCount++;const x=(house.bounds.minXM+house.bounds.maxXM)/2,y=(house.bounds.minYM+house.bounds.maxYM)/2,p=chart.projection.toGeographic(x,y),s=await source.ready(()=>source.sample(p.latDeg,p.lonDeg));maxFoundationErrorM=Math.max(maxFoundationErrorM,Math.abs(s.groundElevationM-house.baseElevationM));assert.ok(s.waterDepthM===0);assert.equal(s.buildingId,house.id);}
 for(const road of metricRoads(recipe.roadCenterlineProfiles))for(const segment of road.segments){const length=segment.b.distanceM-segment.a.distanceM,n=Math.ceil(length/2),dx=segment.b.xM-segment.a.xM,dy=segment.b.yM-segment.a.yM;
 for(let j=0;j<=n;j++){const center=road.at(segment.a.distanceM+j/n*length);for(const f of [-.99,-.5,0,.5,.99]){const x=center.xM-dy/length*road.halfWidthM*f,y=center.yM+dx/length*road.halfWidthM*f,p=chart.projection.toGeographic(x,y),s=await source.ready(()=>source.sample(p.latDeg,p.lonDeg));roadProbes++;
 assert.ok(s.roadSurface,`Missing road at ${input.seed}/${road.id}/${j}/${f}`);maxRoadErrorM=Math.max(maxRoadErrorM,Math.abs(s.roadSurface.roadElevationM-(center.roadElevationM+roadCrossSectionAt(road.road.crossSection,center.distanceM,road.halfWidthM*f).offsetM)));
 if(s.roadSurface.structureKind!=='bridge-deck')maxGroundRoadErrorM=Math.max(maxGroundRoadErrorM,Math.abs(s.groundElevationM-s.roadSurface.roadElevationM));
 if(s.waterDepthM>0&&s.roadSurface.structureKind==='bridge-deck'){wetBridgeProbes++;minClearanceM=Math.min(minClearanceM,s.roadSurface.roadElevationM-center.deckThicknessM-s.waterLevelElevationM);}
 if(examples.length<5&&j===Math.floor(n/2)&&f===0)examples.push({input:{roadId:road.id,xM:x,yM:y,...p},output:s});
 }} }
 }
 assert.ok(maxFoundationErrorM<1e-6);assert.ok(maxRoadErrorM<1e-6);assert.ok(maxGroundRoadErrorM<1e-6,`Supported road differs from actual ground by ${maxGroundRoadErrorM}m`);assert.ok(!wetBridgeProbes||minClearanceM>=1);
 results.push({input,worldId:snapshot.worldId,diagnostics:world.diagnostics,bridgeChecks,riverProbes,dryRiverProbes,maximumRiverParityErrorM,riverExamples,houseCount,roadProbes,wetBridgeProbes,minClearanceM:Number.isFinite(minClearanceM)?minClearanceM:null,maxRoadErrorM,maxGroundRoadErrorM,maxFoundationErrorM,examples});
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
const report={generationOptions:riverOptions,schema:'planet-integration-audit@1',createdAt:new Date().toISOString(),status:'pass',scope:'5 generated worlds; full-width fixed probes (2m longitudinal, five lateral positions); not a continuous hydraulic or structural proof',results,
 outstanding:['Rejected global drainage links and complete connected lake/routing topology; new generated beds use C1 incision','Momentum/scour and subcell hydraulic obstructions beyond the connected reservoir model','Foundations, connections and moving-load effects beyond the beam model','Between-probe terrain support, traction and dynamic stability beyond sampled four-wheel support','All-device GPU visual/performance acceptance']};
fs.mkdirSync('examples/planet/verification',{recursive:true});fs.writeFileSync(`examples/planet/verification/${valleyMode?'valley-':''}integration.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(results.map(({input,houseCount,roadProbes,wetBridgeProbes,minClearanceM})=>({input,houseCount,roadProbes,wetBridgeProbes,minClearanceM}))));

import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{pathToFileURL,fileURLToPath}from'node:url';
import{generatePlanet}from'../src/core/planet-generation.mjs';import{createSphericalRiverSampler}from'../src/core/planet-rivers.mjs';import{restoreGlobalTerrain}from'../src/core/global-terrain.mjs';import{packageGlobe}from'../scripts/package-globe.mjs';import{PagedSource}from'../src/globe/paged-source.mjs';
const world=generatePlanet({settlementCount:0}),saved=world.base.toSnapshot(),network=saved.references.rivers;
test('global river graph keeps shared node levels and downstream-monotone profiles',()=>{
 assert.ok(network.profiles.length>20);const nodes=new Map(network.nodes.map(n=>[n.id,n]));
 for(const p of network.profiles){assert.equal(p.points[0].waterLevelElevationM,nodes.get(p.from).waterLevelElevationM);assert.equal(p.points.at(-1).waterLevelElevationM,nodes.get(p.to).waterLevelElevationM);for(let i=1;i<p.points.length;i++)assert.ok(p.points[i].waterLevelElevationM<=p.points[i-1].waterLevelElevationM+1e-7);}
 assert.ok(Array.isArray(network.diagnostics.rejected));for(const r of network.diagnostics.rejected)assert.ok(r.reason);
});
test('global river ground and water persist in canonical save and match paged queries',async()=>{
 const restored=restoreGlobalTerrain(JSON.stringify(saved)),directory=fs.mkdtempSync(path.join(os.tmpdir(),'river-pages-'));
 try{const manifest=packageGlobe(world.base,directory),fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};},source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);
 for(const profile of network.profiles){const p=profile.points[Math.floor(profile.points.length/2)],a=world.base.sampleAt(p.latDeg,p.lonDeg),b=await source.ready(()=>source.sample(p.latDeg,p.lonDeg));assert.ok(a.waterDepthM>0);assert.ok(source.rawGroundElevationAt(p.latDeg,p.lonDeg)>=a.groundElevationM);assert.equal(a.groundElevationM,b.groundElevationM);assert.equal(a.waterDepthM,b.waterDepthM);assert.deepEqual(restored.sampleAt(p.latDeg,p.lonDeg),a);}
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});
test('river network validation rejects uphill and out-of-budget segments',()=>{
 const invalid=structuredClone(network);invalid.profiles[0].points[1].waterLevelElevationM=invalid.profiles[0].points[0].waterLevelElevationM+1;assert.throws(()=>createSphericalRiverSampler(invalid),/uphill/);
 const bad=structuredClone(network);bad.grid.columns=0;assert.throws(()=>createSphericalRiverSampler(bad),/grid/);
});

test('river shared node contract rejects disconnected endpoint levels',()=>{
 const invalid=structuredClone(network);invalid.nodes.find(n=>n.id===invalid.profiles[0].from).waterLevelElevationM+=1;
 assert.throws(()=>createSphericalRiverSampler(invalid),/shared nodes/);
});
test('wide polar river bands remain indexed across many longitude cells',()=>{
 const a={latDeg:89.9,lonDeg:0,waterLevelElevationM:5,halfWidthM:200,bankWidthM:200,depthM:3},b={...a,lonDeg:.1};
 const sampler=createSphericalRiverSampler({schema:'planet-spherical-rivers@1',radiusM:10000,grid:{columns:360,rows:180},diagnostics:{maxIncisionM:20},nodes:[{id:'a',...a},{id:'b',...b}],profiles:[{id:'polar',from:'a',to:'b',points:[a,b]}]});
 const result=sampler(89.9,90,6);assert.ok(result.waterDepthM>2);assert.deepEqual(result.waterSourceIds,['polar']);
});
test('overflow lakes connect to downstream profiles while terminal lakes do not invent outflow',()=>{
 const outgoing=network.profiles.filter(p=>p.sourceBodyId);assert.ok(outgoing.length>0);
 for(const p of outgoing){const lake=saved.references.lakes.find(l=>l.id===p.sourceBodyId);assert.equal(lake.kind,'overflow-lake');assert.ok(lake.outletCellIndices.includes(p.sourceCellIndex));assert.equal(p.points[0].waterLevelElevationM,lake.levelElevationM);}
 const terminal=generatePlanet({settlementCount:0,lakeFillFraction:.6}).base.toSnapshot();assert.equal(terminal.references.rivers.profiles.filter(p=>p.sourceBodyId).length,0);
});

test('river sampler owns its validated geometry and incision bound',()=>{
 const input=structuredClone(network),p=input.profiles[0].points[3],sampler=createSphericalRiverSampler(input),before=sampler(p.latDeg,p.lonDeg,p.waterLevelElevationM+10);
 input.diagnostics.maxIncisionM=0;for(const profile of input.profiles)for(const q of profile.points)q.waterLevelElevationM-=1000;
 assert.deepEqual(sampler(p.latDeg,p.lonDeg,p.waterLevelElevationM+1010),before);
});
test('equal-level directed river cycles are rejected rather than treated as draining',()=>{
 const input=structuredClone(network),p=input.profiles[0],first=input.nodes.find(n=>n.id===p.from),last=input.nodes.find(n=>n.id===p.to);
 input.nodes=[first,last];input.nodes.forEach(n=>n.waterLevelElevationM=5);p.points.forEach(q=>q.waterLevelElevationM=5);
 input.profiles=[p,{...p,id:'reverse-cycle',from:p.to,to:p.from,points:[...p.points].reverse()}];assert.throws(()=>createSphericalRiverSampler(input),/cycle/);
});
test('low-fill basin routing uses dry-bed elevations and supports bounded polar detours',()=>{
 const w=generatePlanet({seed:'planet-terminal',lakeFillFraction:.6,settlementCount:0,localLandforms:false}),s=w.base.toSnapshot(),r=s.references.rivers;
 assert.equal(r.diagnostics.rejected.length,0);assert.ok(r.profiles.some(p=>p.routing.method==='bounded-corridor-search'&&p.points.some(q=>Math.abs(q.latDeg)>75)));
 for(const p of r.profiles)if(p.receiverBodyId){const lake=s.references.lakes.find(l=>l.id===p.receiverBodyId);if(lake){const cell=p.receiverCellIndex;assert.ok(s.fields.groundElevationM[cell]<=lake.levelElevationM+1e-9,'dry exposed lake cells must not inherit a submerged node level');}}
});
test('dry receiver junctions may be incised consistently within budget instead of forcing uphill water',()=>{
 const w=generatePlanet({seed:'planet-1',lakeFillFraction:.6,settlementCount:1,riverValleys:null,localLandforms:false}),s=w.base.toSnapshot(),r=s.references.rivers;
 assert.equal(r.diagnostics.loweredJunctionNodes,5);assert.equal(r.diagnostics.acceptedProfiles,78);
 assert.deepEqual(r.diagnostics.rejected.map(e=>[e.from,e.to]),[[601,474]],'the remaining over-budget rise must stay rejected');
 const nodes=new Map(r.nodes.map(n=>[n.id,n]));for(const p of r.profiles){assert.ok(nodes.get(p.from).waterLevelElevationM>=nodes.get(p.to).waterLevelElevationM-1e-8);assert.ok(p.maximumSampledIncisionM<=100+1e-7);assert.equal(p.points[0].waterLevelElevationM,nodes.get(p.from).waterLevelElevationM);assert.equal(p.points.at(-1).waterLevelElevationM,nodes.get(p.to).waterLevelElevationM);}
});

import {sphereBasis,offsetGeographic} from '../src/core/spherical.mjs';
test('indexed interval disks retain river support away from their centre and wide-disk fallback',()=>{
 const sampler=createSphericalRiverSampler(network),radius=network.radiusM;
 for(const profile of network.profiles){const p=profile.points[Math.floor(profile.points.length/2)],reach=3*(p.halfWidthM+p.bankWidthM),center=offsetGeographic(p,reach*.8,0,radius),range=[p.waterLevelElevationM+10,p.waterLevelElevationM+30],disk={center:sphereBasis(center).up,angular:reach/radius};
  const bounds=sampler.groundHeightBounds(disk,range),actual=sampler(p.latDeg,p.lonDeg,range[0]).groundElevationM;
  assert.ok(actual>=bounds[0]&&actual<=bounds[1]);
 }
 const whole=sampler.groundHeightBounds({center:[1,0,0],angular:Math.PI},[0,100]);
 for(const p of network.profiles.map(p=>p.points[0])){const z=sampler(p.latDeg,p.lonDeg,50).groundElevationM;assert.ok(z>=whole[0]&&z<=whole[1]);}
});

import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';
import{GlobeStream,STREAM_LIMITS}from'../src/globe/stream.mjs';import{sphereBasis}from'../src/core/spherical.mjs';import{createGlobalTerrain}from'../src/core/global-terrain.mjs';import{directionTile,neighborViolations}from'../src/globe/lod-neighbors.mjs';import{featureDisplacementBounds}from'../src/globe/lod.mjs';
test('oblique bridge close-up retains detailed balanced terrain instead of collapsing to level two',()=>{
 const manifest=JSON.parse(fs.readFileSync(new URL('../examples/planet/generated/manifest.json',import.meta.url))),snapshot=JSON.parse(fs.readFileSync(new URL('../examples/planet/generated/world.snapshot.json',import.meta.url)));
 const raw=structuredClone(snapshot.base);delete raw.worldId;delete raw.sourceWorldId;delete raw.references.rivers;
 const ground=createGlobalTerrain(raw),point=manifest.bridges[0],basis=sphereBasis(point),R=manifest.base.frame.radiusM,height=ground.groundElevationAt(point.latDeg,point.lonDeg),altitude=100,tilt=55*Math.PI/180;
 const norm=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);},cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const eye=basis.up.map((v,i)=>v*(R+height+altitude*Math.cos(tilt))+basis.north[i]*altitude*Math.sin(tilt)),forward=norm(basis.up.map((v,i)=>v*(R+height)-eye[i])),right=norm(cross(forward,basis.north)),up=cross(right,forward);
 const camera={eye,eyeUnit:norm(eye),targetUp:basis.up,forward,right,up,altitude,near:.2,focal:1/Math.tan(Math.PI/8),aspect:1180/757,groundReference:{up:basis.up,elevationM:height}};
 const stream=Object.assign(Object.create(GlobeStream.prototype),{manifest,workers:[],wanted:new Map(),generation:0,dispatch(){}});stream.plan(camera,757);
 const covering=[...stream.wanted.values()].filter(e=>!e.refine&&e.error).filter(e=>{const t=directionTile(basis.up,e.tile.level);return t.face===e.tile.face&&t.x===e.tile.x&&t.y===e.tile.y;});
 assert.ok(covering.length>0);assert.ok(Math.max(...covering.map(e=>e.tile.level))>=14);assert.equal(stream.lodQuality.neighborBalance.remaining,0);assert.ok(stream.wanted.size<=STREAM_LIMITS.maxWantedTiles);assert.equal(neighborViolations([...stream.wanted.values()].filter(e=>!e.refine).map(e=>e.tile)).length,0,'off-screen required siblings must also be balanced');
});
test('river-only displacement does not create fictitious upward terrain',()=>{
 const m={riverDescriptors:[{kind:'river',center:[1,0,0],angularRadius:.1,verticalAllowanceM:100,minimumOffsetM:-100,maximumOffsetM:0}]};
 assert.deepEqual(featureDisplacementBounds(m,{center:[1,0,0],angular:.01}),[-100,0]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {loadShapeFirstModel} from '../src/globe/shape-first-loader.mjs';
import {makeShapeFirstPlanetManifest,createShapeFirstPlanetRegion} from '../src/globe/shape-first-planet.mjs';
import {PagedSource} from '../src/globe/paged-source.mjs';
import {buildMesh,VERTEX_STRIDE} from '../src/globe/mesh.mjs';
import {tileBound} from '../src/globe/cube.mjs';
import {sphereBasis} from '../src/core/spherical.mjs';
import {sampleShapeHeight} from '../src/globe/shape-first-model.mjs';
import {GroundTracker} from '../src/globe/ground-tracker.mjs';
const url=new URL('../examples/planet/generated/manifest.json',import.meta.url);
const fetchImpl=async u=>{const b=await fs.readFile(u);return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};};
const base=JSON.parse(await fs.readFile(url)),model=await loadShapeFirstModel({fetchImpl});
const manifest=makeShapeFirstPlanetManifest(base,model);
const source=()=>new PagedSource(manifest,url.href,fetchImpl,{materializationStorage:null});
function tileAt(point,level){const [x,y,z]=sphereBasis(point).up,m=Math.max(Math.abs(x),Math.abs(y),Math.abs(z));let face,u,v;if(m===Math.abs(x)){face=x>0?0:1;u=x>0?y/x:y/x;v=z/Math.abs(x);}else if(m===Math.abs(y)){face=y>0?2:3;u=-x/y;v=z/Math.abs(y);}else{face=z>0?4:5;u=x/Math.abs(z);v=y/z;}const n=2**level;return{face,level,x:Math.floor((u+1)*n/2),y:Math.floor((v+1)*n/2)};}
test('explicit sphere draft has stable separate persisted identity and original untouched',()=>{
 assert.notEqual(manifest.worldId,base.worldId);assert.equal(makeShapeFirstPlanetManifest(base,model).worldId,manifest.worldId);assert.equal(makeShapeFirstPlanetManifest(base,model,{lonDeg:0}).worldId===manifest.worldId,false);
 assert.equal(JSON.parse(JSON.stringify(manifest)).shapeFirstRegion.id,manifest.worldId);assert.equal(base.shapeFirstRegion,undefined);assert.equal(manifest.featureCharts.length,0);assert.equal(manifest.settlements.length,0);
});
test('sphere queries and camera ground follow original native shape at geographic placement',async()=>{
 const s=source(),r=s.shapeFirstRegion;
 for(const [x,y]of [[0,0],[4000,5000],[model.extent.widthM,model.extent.heightM],[model.extent.widthM/2,model.extent.heightM/2]]){
 const p=r.geographic(x,y),q=r.local(p.latDeg,p.lonDeg);assert.ok(Math.abs(q.xM-x)<1e-6&&Math.abs(q.yM-y)<1e-6);
 const expected=sampleShapeHeight(model.candidate,x,y),actual=await s.ready(()=>s.sample(p.latDeg,p.lonDeg));assert.ok(Math.abs(actual.groundElevationM-expected)<1e-6);assert.equal(actual.waterDepthM,0);assert.equal(actual.roadSurface,null);
 assert.ok(Math.abs(s.groundElevationAt(p.latDeg,p.lonDeg)-expected)<1e-6);assert.ok(Math.abs(new GroundTracker(s).sample(p).surfaceElevationM-expected)<1e-6);
 }
});
test('exterior collar joins the saved planet without moving native rectangle',async()=>{
 const s=source(),r=s.shapeFirstRegion,legacy=new PagedSource(base,url.href,fetchImpl,{materializationStorage:null});
 for(const x of [-4000.01,-4000,-3999.99]){const p=r.geographic(x,model.extent.heightM/2),z=await s.ready(()=>s.sample(p.latDeg,p.lonDeg).groundElevationM),old=await legacy.ready(()=>legacy.sample(p.latDeg,p.lonDeg).groundElevationM);assert.ok(Math.abs(z-old)<.001,`${x}: ${z-old}`);}
});
test('normal globe mesh uses selected heights and draped design river symbols',async()=>{
 const s=source(),r=s.shapeFirstRegion,p=r.geographic(model.rivers[0].points[10].xM,model.rivers[0].points[10].yM),tile=tileAt(p,12),mesh=await buildMesh(s,tile);
 assert.ok(mesh.vertex.length>0);assert.ok(mesh.overlayVertex.length>0);assert.equal(mesh.samplingStats.shapeFirstSymbols.kind,'provisional-draped-river-symbols');assert.ok(mesh.samplingStats.shapeFirstSymbols.segments>0);
 const bound=s.tileHeightBounds(tileBound(tile,manifest.base.frame.radiusM));assert.ok(bound.every(Number.isFinite));
 for(let i=0;i<289*VERTEX_STRIDE;i+=VERTEX_STRIDE){const xyz=[0,1,2].map(k=>mesh.vertex[i+k]+mesh.anchor[k]),z=Math.hypot(...xyz)-manifest.base.frame.radiusM,p={latDeg:Math.atan2(xyz[2],Math.hypot(xyz[0],xyz[1]))*180/Math.PI,lonDeg:Math.atan2(xyz[1],xyz[0])*180/Math.PI},expected=await s.ready(()=>s.sample(p.latDeg,p.lonDeg).groundElevationM);assert.ok(Math.abs(z-expected)<.05,`${z} vs ${expected}`);}
});
test('recorded vertical placement preserves all native relative heights and reloads',()=>{
 const shifted=makeShapeFirstPlanetManifest(base,model,{latDeg:20,lonDeg:179.999,elevationOffsetM:1234.5}),region=createShapeFirstPlanetRegion(JSON.parse(JSON.stringify(shifted.shapeFirstRegion)));
 const g=model.candidate.grid;
 for(let y=0;y<g.rows;y+=8)for(let x=0;x<g.columns;x+=8){const p=region.geographic(x*g.cellSizeM,y*g.cellSizeYM),q=region.local(p.latDeg,p.lonDeg);assert.ok(Math.abs(region.nativeHeight(q)-model.candidate.elevation[y*g.columns+x]-1234.5)<1e-5);}
 assert.equal(shifted.shapeFirstRegion.projection.centerLonDeg,179.99900000000002);
});
test('seed-generated shape uses the same sphere field contract',async()=>{
 const generated=await loadShapeFirstModel({seed:'sphere-provider-smoke'}),m=makeShapeFirstPlanetManifest(base,generated),s=new PagedSource(m,url.href,fetchImpl,{materializationStorage:null}),p=m.focus;
 assert.equal(s.sample(p.latDeg,p.lonDeg).groundElevationM,sampleShapeHeight(generated.candidate,generated.extent.widthM/2,generated.extent.heightM/2));
 assert.notEqual(m.worldId,manifest.worldId);assert.equal(m.shapeFirstRegion.rivers.length,generated.rivers.length);
});
test('post-shape channel water, bed, camera and exact-width strips share one field',async()=>{
 const s=source(),r=s.shapeFirstRegion,river=r.channels.rivers[0],point=river.points[Math.floor(river.points.length/2)],p=r.geographic(point.xM,point.yM),surface=s.sample(p.latDeg,p.lonDeg),design=r.surface(point);
 assert.ok(surface.waterDepthM>0);assert.ok(Math.abs(surface.groundElevationM-design.groundElevationM)<1e-6);assert.ok(Math.abs(surface.waterLevelElevationM-design.waterLevelM)<1e-6);assert.ok(Math.abs(surface.waterDepthM-(surface.waterLevelElevationM-surface.groundElevationM))<1e-8);
 assert.ok(Math.abs(new GroundTracker(s).sample(p).surfaceElevationM-surface.waterLevelElevationM)<1e-6);
 const mesh=await buildMesh(s,tileAt(p,16));assert.ok(mesh.waterIndexCount>0);assert.ok(mesh.samplingStats.shapeFirstWater.segments>0);
 for(const [xM,yM]of [[100,100],[8000,9000]]){const p=r.geographic(xM,yM),surface=s.sample(p.latDeg,p.lonDeg);assert.equal(surface.waterDepthM,0);assert.ok(Math.abs(surface.groundElevationM-r.nativeHeight({xM,yM}))<1e-6);}
});
test('explicit below-sea placement is consistently wet rather than dry hidden ocean',()=>{
 const m=makeShapeFirstPlanetManifest(base,model,{elevationOffsetM:-1000}),s=new PagedSource(m,url.href,fetchImpl,{materializationStorage:null}),sample=s.sample(m.focus.latDeg,m.focus.lonDeg);
 assert.ok(sample.groundElevationM<base.sea.levelElevationM);assert.equal(sample.surfaceKind,'sea-level-water');assert.equal(sample.waterLevelElevationM,base.sea.levelElevationM);assert.ok(sample.waterDepthM>0);
});
test('automatic outlet placement reaches a verified saved river with wet bed continuity',async()=>{
 const {prepareShapeFirstPlanetPlacement}=await import('../src/globe/shape-first-planet-placement.mjs');
 const legacy=new PagedSource(base,url.href,fetchImpl,{materializationStorage:null}),m=await prepareShapeFirstPlanetPlacement(base,model,legacy),s=new PagedSource(m,url.href,fetchImpl,{materializationStorage:null}),r=s.shapeFirstRegion,c=r.connector;
 assert.ok(c);assert.equal(r.outletStatus,'connected-to-verified-saved-river');assert.ok(c.spec.outlet.waterLevelM>=c.spec.receiver.waterLevelM);
 for(let i=0;i<c.route.points.length;i+=4){const p=c.route.points[i],geo=r.geographic(p.xM,p.yM),surface=await s.ready(()=>s.sample(geo.latDeg,geo.lonDeg));assert.ok(surface.waterDepthM>0,`dry connector ${i}`);}
 const receiver=c.spec.receiver,joined=await s.ready(()=>s.sample(receiver.latDeg,receiver.lonDeg)),old=await legacy.ready(()=>legacy.sample(receiver.latDeg,receiver.lonDeg));assert.ok(Math.abs(joined.groundElevationM-old.groundElevationM)<1e-5);assert.ok(Math.abs(joined.waterLevelElevationM-old.waterLevelElevationM)<1e-5);
 assert.equal((await prepareShapeFirstPlanetPlacement(base,model,legacy,{elevationOffsetM:r.elevationOffsetM})).worldId,m.worldId);
});

import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{pathToFileURL,fileURLToPath}from'node:url';
import{generatePlanet}from'../src/core/planet-generation.mjs';import{snapshotPlanetWorld,restorePlanetWorld}from'../src/core/planet-world.mjs';import{createSphericalProjection}from'../src/core/spherical.mjs';import{WATER_SCHEMA}from'../src/core/water-model.mjs';import{packageGlobe}from'../scripts/package-globe.mjs';import{PagedSource}from'../src/globe/paged-source.mjs';
const fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};};
for(const seed of ['planet-1','planet-a','planet-b'])test(`${seed}: the same lake and sea survive two chart boundaries, save and reverse page loading`,async()=>{
 const generated=generatePlanet({seed,settlementCount:0}),snapshot=generated.base.toSnapshot(),{columns:w,rows:h}=snapshot.grid,points={};
 for(let i=0;i<w*h&&(!points.lake||!points.sea);i++){const p={latDeg:90-(Math.floor(i/w)+.5)*180/h,lonDeg:(i%w+.5)*360/w},q=generated.base.sampleAt(p.latDeg,p.lonDeg);if(q.waterDepthM<=1)continue;const kind=q.waterSourceIds.includes(snapshot.references.sea.id)?'sea':snapshot.references.lakes.some(l=>q.waterSourceIds.includes(l.id))?'lake':null;if(kind)points[kind]??=p;}
 assert.ok(points.lake&&points.sea);
 for(const [kind,center]of Object.entries(points)){
  const projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM:generated.base.frame.radiusM}),recipes=[-100,100].map((x,i)=>{const p=projection.toGeographic(x,0);return{id:`water-probe:${i}`,projection:{centerLatDeg:p.latDeg,centerLonDeg:p.lonDeg,radiusM:generated.base.frame.radiusM},bounds:{minXM:-150,maxXM:150,minYM:-150,maxYM:150},model:{schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null},buildings:[],buildingPads:[],roadCenterlineProfiles:[]};}),
   settlements=recipes.map(r=>({id:r.id,name:r.id,latDeg:r.projection.centerLatDeg,lonDeg:r.projection.centerLonDeg,buildings:0})),world={...generated,recipes,settlements,focus:center},saved=snapshotPlanetWorld(world),restored=restorePlanetWorld(JSON.stringify(saved)),directory=fs.mkdtempSync(path.join(os.tmpdir(),'planet-water-charts-'));
  try{
   const manifest=packageGlobe(world.base,directory,{recipes,focus:center,canonicalWorldId:saved.worldId}),source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);
   for(const d of source.descriptors().slice().reverse())await source.enableFeatures(undefined,d);
   for(const x of[-300,-250.01,-250,-249.99,-100,-.01,0,.01,100,249.99,250,250.01,300])for(const y of[-25,0,25]){
    const p=projection.toGeographic(x,y),a=world.base.sampleAt(p.latDeg,p.lonDeg),b=restored.sampleAt(p.latDeg,p.lonDeg),c=await source.ready(()=>source.sample(p.latDeg,p.lonDeg));
    assert.ok(a.waterDepthM>0,`${kind} test must remain in the actual source water`);
    for(const q of[b,c]){assert.equal(q.waterLevelElevationM,a.waterLevelElevationM);assert.deepEqual(q.waterSourceIds,a.waterSourceIds);assert.ok(Math.abs(q.waterDepthM-a.waterDepthM)<1e-7);assert.ok(Math.abs(q.groundElevationM-a.groundElevationM)<1e-7);}
   }
   assert.equal(source.features.size,2);assert.deepEqual(restored.toSnapshot(),saved);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
 }
});

test('paged river mouth keeps the same provenance as resident Core at equal sea level',async()=>{
 const world=generatePlanet({seed:'planet-a',settlementCount:0}),saved=world.base.toSnapshot(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'planet-mouth-'));let checked=0;
 try{const manifest=packageGlobe(world.base,directory),source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);
 for(const profile of saved.references.rivers.profiles)if(profile.receiverBodyId===saved.references.sea.id){const p=profile.points.at(-1),a=world.base.sampleAt(p.latDeg,p.lonDeg);if(a.surfaceKind!=='river'||a.waterLevelElevationM!==saved.references.sea.levelElevationM)continue;
 const b=await source.ready(()=>source.sample(p.latDeg,p.lonDeg));assert.deepEqual(b.waterSourceIds,a.waterSourceIds);assert.equal(b.surfaceKind,a.surfaceKind);assert.equal(b.waterDepthM,a.waterDepthM);checked++;}
 assert.ok(checked>0);
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});


test('a dry raised pad replaces submerged surface classification in both world readers',async()=>{
 const world=generatePlanet({seed:'planet-1',settlementCount:0}),snap=world.base.toSnapshot();let center;
 for(let i=0;i<snap.grid.columns*snap.grid.rows;i++){const p={latDeg:90-(Math.floor(i/snap.grid.columns)+.5)*180/snap.grid.rows,lonDeg:(i%snap.grid.columns+.5)*360/snap.grid.columns},q=world.base.sampleAt(p.latDeg,p.lonDeg);if(q.waterDepthM>1&&q.waterSourceIds.includes(snap.references.sea.id)){center=p;break;}}
 assert.ok(center);const level=snap.references.sea.levelElevationM,recipe={id:'raised-pad-test',projection:{centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM:world.base.frame.radiusM},bounds:{minXM:-20000,maxXM:20000,minYM:-20000,maxYM:20000},model:{schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null},buildings:[],roadCenterlineProfiles:[],buildingPads:[{id:'test-pad',bounds:{minXM:-10,maxXM:10,minYM:-10,maxYM:10},targetPadElevationM:level+2}]};
 const recipes=[recipe],saved=snapshotPlanetWorld({...world,recipes,settlements:[{id:recipe.id,name:'Test fill',...center,buildings:0}],focus:center}),restored=restorePlanetWorld(saved),directory=fs.mkdtempSync(path.join(os.tmpdir(),'planet-dry-pad-'));
 try{const manifest=packageGlobe(world.base,directory,{recipes,focus:center,canonicalWorldId:saved.worldId}),source=new PagedSource(manifest,pathToFileURL(path.join(directory,'manifest.json')).href,fetcher);await source.enableFeatures();
 for(const q of[restored.sampleAt(center.latDeg,center.lonDeg),await source.ready(()=>source.sample(center.latDeg,center.lonDeg))]){assert.equal(q.groundElevationM,level+2);assert.equal(q.waterDepthM,0);assert.equal(q.surfaceKind,'land');assert.deepEqual(q.waterSourceIds,[]);assert.equal(q.waterSurfaceElevationM,null);}
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

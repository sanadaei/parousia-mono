import test from'node:test';import assert from'node:assert/strict';import{generatePlanet}from'../src/core/planet-generation.mjs';
import{createGlobalTerrain}from'../src/core/global-terrain.mjs';
const riverValleys={maxIncisionM:600,sideRunPerRise:3};
test('explicit valley-forming generation connects the five reference drainage graphs with bounded broad banks',()=>{
 for(const input of[{seed:'planet-1'},{seed:'planet-a'},{seed:'planet-b'},{seed:'planet-terminal',lakeFillFraction:.6},{seed:'planet-1',lakeFillFraction:.6}]){
  const w=generatePlanet({...input,settlementCount:0,riverValleys}),s=w.base.toSnapshot(),network=s.references.rivers;
  assert.equal(network.diagnostics.rejected.length,0);assert.equal(network.diagnostics.junctionLevelMethod,'surveyed-upstream-ceiling@3');assert.equal(network.diagnostics.maxIncisionM,600);assert.equal(network.diagnostics.valleySideRunPerRise,3);
  delete s.worldId;delete s.sourceWorldId;delete s.references.rivers;const original=createGlobalTerrain(s);
  for(const p of network.profiles){assert.ok(p.maximumSampledIncisionM<=600+1e-8);for(const q of[p.points[0],p.points[Math.floor(p.points.length/2)],p.points.at(-1)]){
   const incision=Math.max(0,original.groundElevationAt(q.latDeg,q.lonDeg)-q.waterLevelElevationM+q.depthM);assert.ok(q.bankWidthM>=3*incision-1e-7);assert.ok(w.base.sampleAt(q.latDeg,q.lonDeg).waterDepthM>0);
  }}
 }
});
test('strict channel-only generation retains rejected fits and invalid valley policies reject',()=>{
 assert.ok(generatePlanet({settlementCount:0,riverValleys:null}).diagnostics.globalRivers.rejected.length>0);
 for(const riverValleys of[{}, {maxIncisionM:600,sideRunPerRise:0},{maxIncisionM:Infinity,sideRunPerRise:3}])assert.throws(()=>generatePlanet({riverValleys}),/valley/);
});

test('new generated worlds use valley-forming policy by default and preserve explicit strict mode',()=>{
 const a=generatePlanet({settlementCount:0}),b=generatePlanet({settlementCount:0,riverValleys});
 assert.equal(a.base.worldId,b.base.worldId);assert.equal(a.diagnostics.globalRivers.rejected.length,0);
 assert.equal(a.base.toSnapshot().revision,'planet-generator@19');
 assert.equal(generatePlanet({settlementCount:0,riverValleys:null}).diagnostics.globalRivers.maxIncisionM,100);
});

test('explicit alluvial sections persist through planet restoration without replacing legacy defaults',async()=>{
 const {snapshotPlanetWorld,restorePlanetWorld}=await import('../src/core/planet-world.mjs');
 const options={seed:'valley-section-contract',columns:32,rows:16,settlementCount:0};
 const before=generatePlanet(options),after=generatePlanet({...options,valleySections:'alluvial'}),saved=snapshotPlanetWorld(after),restored=restorePlanetWorld(saved);
 assert.equal(before.base.toSnapshot().references.rivers.bedMethod,'c1-incision-smoothmax@2');
 assert.equal(saved.base.references.rivers.bedMethod,'c1-incision-alluvial-bench@3');
 assert.deepEqual(saved.base.references.rivers.nodes,before.base.toSnapshot().references.rivers.nodes);
 for(const profile of saved.base.references.rivers.profiles.slice(0,10))for(const p of profile.points.slice(0,3))assert.deepEqual(restored.base.sampleSurfaceAt(p.latDeg,p.lonDeg),after.base.sampleSurfaceAt(p.latDeg,p.lonDeg));
 assert.throws(()=>generatePlanet({...options,valleySections:'other'}),/valleySections/);
});

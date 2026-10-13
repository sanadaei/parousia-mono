import test from 'node:test';import assert from 'node:assert/strict';
import {createPlanetWaterSampler} from '../src/core/sea-level.mjs';
const sea={id:'ocean',levelElevationM:0},grid={columns:8,rows:4};
const lake={id:'depression',kind:'terminal-lake',levelElevationM:-5,spillLevelM:10,cells:[10],membershipMethod:'interpolation-support@1',basinWaterPolicy:'explicit-dry-basin@1'};
test('an exposed terminal basin below global sea level does not refill from a nonexistent ocean connection',()=>{
 const sample=createPlanetWaterSampler(sea,[lake],grid);
 const dry=sample(22.5,112.5,-3);assert.equal(dry.waterDepthM,0);assert.equal(dry.waterLevelElevationM,-5);assert.equal(dry.surfaceKind,'land');
 const wet=sample(22.5,112.5,-8);assert.equal(wet.waterDepthM,3);assert.deepEqual(wet.waterSourceIds,['depression']);
 const ocean=sample(-60,300,-3);assert.equal(ocean.waterDepthM,3);assert.deepEqual(ocean.waterSourceIds,['ocean']);
 const above=sample(22.5,112.5,20);assert.equal(above.waterDepthM,0);
});
test('pre-policy lake saves retain previous interpretation and unknown policies reject',()=>{
 const old={...lake};delete old.basinWaterPolicy;
 assert.equal(createPlanetWaterSampler(sea,[old],grid)(22.5,112.5,-3).waterDepthM,3);
 assert.throws(()=>createPlanetWaterSampler(sea,[{...lake,basinWaterPolicy:'typo'}],grid),/policy/);
});
import {generatePlanet} from '../src/core/planet-generation.mjs';
import {snapshotPlanetWorld,restorePlanetWorld} from '../src/core/planet-world.mjs';
test('generated below-sea terminal basins preserve dry exposed beds through whole-world restore',()=>{
 const world=generatePlanet({seed:'planet-1',lakeFillFraction:.6,settlementCount:1}),saved=snapshotPlanetWorld(world),restored=restorePlanetWorld(saved),s=saved.base,{columns:w,rows:h}=s.grid;let checked=0,dry=0;
 for(const lake of s.references.lakes)if(lake.levelElevationM<0)for(const i of lake.cells){
  const z=s.fields.groundElevationM[i];if(z<lake.levelElevationM||z>=0)continue;
  const lat=90-(Math.floor(i/w)+.5)*180/h,lon=(i%w+.5)*360/w,a=world.base.sampleAt(lat,lon),b=restored.sampleAt(lat,lon);
  assert.ok(!a.waterSourceIds.includes('sea'),'isolated dry basin must never be filled by sea fallback');
  assert.equal(a.waterDepthM,b.waterDepthM);if(a.waterDepthM===0)dry++;checked++;
 }
 assert.ok(checked>=300);assert.ok(dry>=100);
});
test('modeled terminal sinks and lake water are not mislabeled unresolved land in generation diagnostics',()=>{
 const w=generatePlanet({seed:'planet-1',lakeFillFraction:.6,settlementCount:1,riverValleys:null}),d=w.diagnostics;
 assert.ok(d.modeledTerminalSinks>0);assert.equal(d.unresolvedLandTerminals,0);assert.ok(d.waterCells>d.oceanCells);assert.equal(d.waterCells+d.landCells,128*64);
 assert.ok(d.globalRivers.rejected.length>0,'macro sink accounting must not hide a rejected continuous river fit');
});

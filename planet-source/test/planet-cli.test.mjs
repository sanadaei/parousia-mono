import test from'node:test';import assert from'node:assert/strict';import{parsePlanetArguments}from'../scripts/generate-planet.mjs';
test('generation CLI exposes terminal fill without altering its legacy positional seed and output',()=>{
 assert.deepEqual(parsePlanetArguments([]),{seed:'planet-1',directory:'examples/planet/generated'});
 assert.deepEqual(parsePlanetArguments(['dry-world','examples/custom','--lake-fill=0.6']),{seed:'dry-world',directory:'examples/custom',lakeFillFraction:.6});
 for(const args of [['--lake-fill=2'],['--lake-fill=NaN'],['--wrong'],['a','b','c'],['--lake-fill=0','--lake-fill=.5']])assert.throws(()=>parsePlanetArguments(args));
});

test('channel-only CLI explicitly preserves the strict legacy generation policy',()=>{assert.equal(parsePlanetArguments(['--channel-only']).riverValleys,null);assert.throws(()=>parsePlanetArguments(['--channel-only','--channel-only']));});

test('single-street CLI keeps the prior layout as an explicit generation option',()=>{assert.equal(parsePlanetArguments(['--single-street']).villageRoads,false);assert.throws(()=>parsePlanetArguments(['--single-street','--single-street']));});

test('road crown CLI exposes the authored slope and explicit flat opt-out',()=>{assert.equal(parsePlanetArguments(['--road-crown=.02']).roadCrownSlope,.02);assert.equal(parsePlanetArguments(['--road-crown=0']).roadCrownSlope,0);for(const args of[['--road-crown=NaN'],['--road-crown=-.1'],['--road-crown=.2'],['--road-crown=0','--road-crown=.02']])assert.throws(()=>parsePlanetArguments(args));});
test('CLI forwards deferred population without changing the old default',()=>{assert.equal(parsePlanetArguments(['--deferred-population']).deferredPopulation,true);assert.equal(parsePlanetArguments([]).deferredPopulation,undefined);assert.throws(()=>parsePlanetArguments(['--deferred-population','--deferred-population']),/Duplicate/);});

test('L0 macro profile is explicit and rejects unknown or duplicate options',()=>{assert.equal(parsePlanetArguments(['--macro-profile=earthlike-l0@1']).macroProfile,'earthlike-l0@1');assert.equal(parsePlanetArguments(['--macro-profile=legacy']).macroProfile,'legacy');assert.throws(()=>parsePlanetArguments(['--macro-profile=oops']));assert.throws(()=>parsePlanetArguments(['--macro-profile=legacy','--macro-profile=earthlike-l0@1']));});

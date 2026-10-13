import test from 'node:test';
import assert from 'node:assert/strict';
import { globalInput,detailBands } from '../fixtures/global-scenarios.mjs';
import { createGlobalTerrain } from '../src/core/global-terrain.mjs';
import { SEA_LEVEL_SCHEMA } from '../src/core/sea-level.mjs';
import { preparePlanetReliefInput } from '../scripts/experiments/planet-relief-input.mjs';
function fixture(){const s=globalInput({bands:detailBands,height:()=>1000});s.references.sea={schema:SEA_LEVEL_SCHEMA,id:'sea',verticalDatum:'fixture-zero',levelElevationM:0};return createGlobalTerrain(s);}
const options={centerLatDeg:20,centerLonDeg:150,n:9,extentM:1600};

test('planet relief preparation owns an identified input without changing the saved world',()=>{
 const p=fixture(),saved=p.toSnapshot(),before=JSON.stringify(saved),r=preparePlanetReliefInput(saved,options);
 assert.equal(r.originalWorldId,p.worldId);assert.notEqual(r.derivedSourceWorldId,p.worldId);
 assert.equal(r.initial.length,81);assert.ok(r.initial.every(v=>Math.abs(v-1000)<1e-9));
 assert.equal(JSON.stringify(saved),before);assert.equal(preparePlanetReliefInput(saved,options).inputId,r.inputId);
});

test('saved-surface mode retains the original source identity and mode participates in input identity',()=>{
 const saved=fixture().toSnapshot(),a=preparePlanetReliefInput(saved,options),b=preparePlanetReliefInput(saved,{...options,sourceMode:'saved-surface'});
 assert.equal(b.derivedSourceWorldId,saved.worldId);assert.notEqual(a.inputId,b.inputId);
});

test('planet relief preparation refuses marine/unknown inputs, stale identity and excessive work',()=>{
 const saved=fixture().toSnapshot();assert.throws(()=>preparePlanetReliefInput(saved,{...options,centerLonDeg:0}),/marine/);
 assert.throws(()=>preparePlanetReliefInput(saved,{...options,n:258}));
 const bad=structuredClone(saved);bad.fields.groundElevationM[0]++;assert.throws(()=>preparePlanetReliefInput(bad,options));
 const unknown=globalInput();assert.throws(()=>preparePlanetReliefInput(createGlobalTerrain(unknown).toSnapshot(),options),/sea datum/);
});

test('identified planet input reaches the canonical solver output with explicit forcing and provenance',async()=>{
 const {evolvePlanetRelief}=await import('../scripts/experiments/planet-relief-input.mjs');
 const input=preparePlanetReliefInput(fixture().toSnapshot(),options),forcing={steps:2,dtYears:100,erodibility:.0001,upliftMPerYear:.001};
 const a=evolvePlanetRelief(input,forcing),b=evolvePlanetRelief(input,forcing);
 assert.equal(a.terrain.worldId,b.terrain.worldId);assert.equal(a.terrain.frame.verticalDatum,input.verticalDatum);
 assert.equal(a.terrain.toSnapshot().references.reliefResearch.planetInput.originalWorldId,input.originalWorldId);
 assert.throws(()=>evolvePlanetRelief(input,{}),/forcing/);
 input.initial[0]++;assert.throws(()=>evolvePlanetRelief(input,forcing),/identity/);
});

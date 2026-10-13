import test from 'node:test';
import assert from 'node:assert/strict';
import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
import { generatePlanet } from '../src/core/planet-generation.mjs';
import { snapshotPlanetWorld, restorePlanetWorld } from '../src/core/planet-world.mjs';
const world=generatePlanet({columns:32,rows:16,settlementCount:2});
test('whole world save resumes identical terrain, rivers, roads and houses',()=>{
 const saved=snapshotPlanetWorld(world),again=restorePlanetWorld(JSON.stringify(saved));
 assert.deepEqual(again.toSnapshot(),saved);
 assert.deepEqual(snapshotPlanetWorld(again),saved);
 for(const place of world.settlements) assert.equal(again.sampleAt(place.latDeg,place.lonDeg).groundElevationM,again.charts.find(c=>c.recipe.id===place.id).sampleAt(place.latDeg,place.lonDeg).groundElevationM);
});
test('whole world identity changes with house geometry and rejects unnoticed corruption',()=>{
 const saved=snapshotPlanetWorld(world);saved.recipes[0].buildings[0].heightM+=1;
 assert.throws(()=>restorePlanetWorld(saved),/identity/);
 const changed={...world,recipes:structuredClone(world.recipes)};changed.recipes[0].buildings[0].heightM+=1;
 assert.notEqual(snapshotPlanetWorld(changed).worldId,snapshotPlanetWorld(world).worldId);
});
test('world save and restored input are isolated from external mutation',()=>{
 const saved=snapshotPlanetWorld(world),restored=restorePlanetWorld(saved),before=restored.toSnapshot();
 saved.recipes[0].buildings.length=0;
 assert.deepEqual(restored.toSnapshot(),before);
 const output=restored.toSnapshot();output.settlements.length=0;assert.deepEqual(restored.toSnapshot(),before);
});
test('new planet recipes carry the continuous batter policy through canonical save and restore',()=>{
 const saved=snapshotPlanetWorld(world),again=restorePlanetWorld(saved);
 assert.ok(saved.recipes.length>0);
 for(const recipe of saved.recipes)assert.equal(recipe.roadEarthworkOptions.blendPolicy,'squared-odds@1');
 for(let i=0;i<world.recipes.length;i++)for(const [x,y]of [[0,8],[4,7],[-5,2],[10,9]]){
  const p=again.charts[i].projection.toGeographic(x,y);
  assert.equal(createGlobeFeatureChart(world.base,world.recipes[i]).groundElevationAt(p.latDeg,p.lonDeg),again.charts[i].groundElevationAt(p.latDeg,p.lonDeg));
 }
 const legacy={...world,recipes:world.recipes.map(({roadEarthworkOptions,...recipe})=>recipe)};
 const legacySaved=snapshotPlanetWorld(legacy),legacyRestored=restorePlanetWorld(legacySaved);
 assert.notEqual(saved.worldId,legacySaved.worldId);
 assert.ok(legacyRestored.recipes.every(r=>!Object.hasOwn(r,'roadEarthworkOptions')));
});

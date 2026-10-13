import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';
import{generatePlanet}from'../src/core/planet-generation.mjs';import{publishPlanet}from'../scripts/publish-planet.mjs';
test('publishing a new world preserves every page and snapshot used by an already-open world',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'planet-publish-'));try{
  const a=generatePlanet({columns:16,rows:8,settlementCount:1}),first=publishPlanet(a,dir,{name:'first'}),files=[first.planetSnapshot,...Object.values(first.pages).map(p=>p.path),...(first.features?[first.features.path]:first.featureCharts.map(p=>p.path))],bytes=files.map(f=>fs.readFileSync(path.join(dir,f)));
  const second=publishPlanet(generatePlanet({seed:'another',columns:16,rows:8,settlementCount:1}),dir,{name:'second'});
  assert.notEqual(first.canonicalWorldId,second.canonicalWorldId);for(let i=0;i<files.length;i++)assert.ok(bytes[i].equals(fs.readFileSync(path.join(dir,files[i]))));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'))),second);assert.deepEqual(publishPlanet(a,dir,{name:'first'}),first);
  const renamed=publishPlanet(a,dir,{name:'renamed'});assert.equal(renamed.canonicalWorldId,first.canonicalWorldId);assert.notEqual(renamed.planetSnapshot,first.planetSnapshot);
  const previous=fs.readFileSync(path.join(dir,'manifest.json'));fs.writeFileSync(path.join(dir,first.planetSnapshot),'corrupt');
  assert.throws(()=>publishPlanet(a,dir,{name:'first'}),/immutable/);assert.ok(previous.equals(fs.readFileSync(path.join(dir,'manifest.json'))));assert.ok(!fs.readdirSync(path.join(dir,'worlds')).some(n=>n.startsWith('.building')));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('new climate worlds persist provisional territorial IDs and immutable membership',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'planet-territory-publish-'));try{
  const world=generatePlanet({seed:'territory-save',columns:16,rows:8,settlementCount:0,climatePlanning:true,targetPopulation:10000}),first=publishPlanet(world,dir),text=fs.readFileSync(path.join(dir,first.territories.path),'utf8'),saved=JSON.parse(text);
  assert.equal(saved.method,'provisional-territorial-access@1');assert.equal(saved.id,first.territories.id);assert.equal(saved.climateId,world.climate.id);assert.equal(saved.populationId,world.population.id);assert.equal(Buffer.byteLength(text),first.territories.bytes);
  const again=publishPlanet(world,dir);assert.deepEqual(again.territories,first.territories);assert.equal(fs.readFileSync(path.join(dir,again.territories.path),'utf8'),text);
  const old=generatePlanet({seed:'no-climate',columns:16,rows:8,settlementCount:0});assert.equal(publishPlanet(old,dir).territories,undefined);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

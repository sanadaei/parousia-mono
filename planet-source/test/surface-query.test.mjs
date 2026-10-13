import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
const snapshot=fs.readFileSync(new URL('../examples/planet/generated/world.snapshot.json',import.meta.url),'utf8');
const withoutDerivatives=({gradientEastNorth,slopeMPerM,...rest})=>rest;
test('derivative-free surface queries preserve every other canonical global field',()=>{
 const world=restorePlanetWorld(snapshot);for(const p of [{latDeg:90,lonDeg:0},{latDeg:-90,lonDeg:180},{latDeg:0,lonDeg:180},world.focus,...world.settlements])assert.deepEqual(world.base.sampleSurfaceAt(p.latDeg,p.lonDeg),withoutDerivatives(world.base.sampleAt(p.latDeg,p.lonDeg)));
});
test('planet surface-only query shares road, river, water and building interpretation without inventing a zero gradient',()=>{
 const world=restorePlanetWorld(snapshot),before=world.toSnapshot();
 for(const r of world.recipes.slice(0,3)){const projection=createSphericalProjection(r.projection);for(let y=-2;y<=2;y++)for(let x=-2;x<=2;x++){const p=projection.toGeographic(x*30,y*30),fast=world.sampleSurfaceAt(p.latDeg,p.lonDeg);assert.deepEqual(fast,withoutDerivatives(world.sampleAt(p.latDeg,p.lonDeg)));assert.equal('slopeMPerM' in fast,false);}}
 assert.deepEqual(world.toSnapshot(),before);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {createPlanetMacroTerrain} from '../src/core/planet-macro.mjs';
import {createL0ResolutionSeries} from '../scripts/experiments/l0-resolution-series.mjs';
const grid={columns:16,rows:8},frame={radiusM:6371000};
const {recipe}=createPlanetMacroTerrain({seed:'resolution-stages',...grid,...frame});
const snapshot={worldId:'fixture',grid,frame,references:{macroRecipe:recipe,sea:{levelElevationM:0}}};
test('L0 stages double each axis, share frozen recipe and link stable parent identities',()=>{
 const before=JSON.stringify(snapshot),a=createL0ResolutionSeries(snapshot),b=createL0ResolutionSeries(snapshot);
 assert.deepEqual(a.cases.map(c=>[c.columns,c.rows]),[[16,8],[32,16],[64,32]]);
 assert.equal(a.cases[0].parentId,snapshot.worldId);
 for(let i=1;i<a.cases.length;i++)assert.equal(a.cases[i].parentId,a.cases[i-1].id);
 assert.equal(a.id,b.id);assert.deepEqual(a.cases.map(c=>c.id),b.cases.map(c=>c.id));assert.equal(JSON.stringify(snapshot),before);
});
test('series refuses oversized work before sampling, and honours memory callback',()=>{
 assert.throws(()=>createL0ResolutionSeries({...snapshot,grid:{columns:128,rows:64}},{levels:4}),/budget/);
 assert.throws(()=>createL0ResolutionSeries(snapshot,{levels:2,beforeLevel:()=>{throw Error('memory deferred');}}),/memory deferred/);
});
test('resolution changes do not silently claim inherited drainage or generated settlements',()=>{
 const a=createL0ResolutionSeries(snapshot,{levels:1});assert.match(a.status,/recomputed/);assert.ok(a.limits.includes('Parent drainage topology is not yet inherited'));
 const c=a.cases[0];assert.equal(c.elevation.length,128);assert.ok(c.elevation.every(Number.isFinite));assert.ok(c.upstreamAreaM2.every(v=>v>=0&&Number.isFinite(v)));
});

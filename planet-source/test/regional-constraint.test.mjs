import test from 'node:test';import assert from 'node:assert/strict';
import {conditionDrainageTerrain}from'../scripts/experiments/condition-drainage-terrain.mjs';
import {generateLandformCandidate}from'../scripts/experiments/conditional-landform-candidate.mjs';
import {solveRegionalDrainage}from'../src/core/regional-drainage.mjs';
test('uncommitted terrain projection respects anchors and produces downhill receiver edges',()=>{
 const receiver=[3,4,5,6,7,8,-1,-1,-1],elevation=[10,8,7,20,11,10,0,0,0],before=[...elevation];
 const r=conditionDrainageTerrain({elevation,receiver,columns:3,cellSizeM:10});assert.deepEqual(elevation,before);assert.equal(r.diagnostics.maxGradeViolationM,0);assert.equal(r.elevation[6],0);assert.ok(r.diagnostics.maxCutM>0);
});
test('incompatible committed boundaries reject instead of being moved',()=>{assert.throws(()=>conditionDrainageTerrain({elevation:[1,1,1,2,2,2,3,3,3],receiver:[3,4,5,6,7,8,-1,-1,-1],columns:3,cellSizeM:10,fixed:[{cell:0,elevationM:1}]}),/conflicts/);});
test('selected attachment terrain is reproducible and has no settlement payload',()=>{
 const settings={seed:'terrain-component-check',columns:32,rows:24,cellSizeM:120},a=generateLandformCandidate(settings),b=generateLandformCandidate(settings);assert.deepEqual(a,b);assert.equal(a.settlements,undefined);assert.equal(a.roads,undefined);assert.ok(a.elevation.every(Number.isFinite));assert.ok(a.drainage.outlets.every(o=>o.kind==='open-boundary'));
 const conditioned=conditionDrainageTerrain({elevation:a.elevation,receiver:a.drainage.receiver,columns:a.grid.columns,cellSizeM:a.grid.cellSizeM});const water=solveRegionalDrainage({...a.grid,elevation:conditioned.elevation,localSupplyM3PerYear:a.elevation.map(()=>1),outlets:a.drainage.outlets});assert.ok(water.diagnostics.maxRoutingFillM<1e-7);assert.equal(water.status,'partial-survey-routing-only');
});

import test from 'node:test';import assert from 'node:assert/strict';
import {selectPopulationStart} from '../scripts/package-settlements.mjs';
test('initial view chooses an actual village without moving sites or creating another population',()=>{
 const world={settlements:[{id:'old',cellIndex:0}],population:{cells:[{cellIndex:0,villages:2,suitability:.8},{cellIndex:1,villages:1,suitability:.9}]}},dry={id:'pop:0:0',kind:'village',population:300,latDeg:1,lonDeg:2,name:'dry',siting:{gradeMPerM:.001}},wet={id:'pop:1:0',kind:'village',population:300,latDeg:3,lonDeg:4,name:'wet',siting:{gradeMPerM:.01,waterAccess:{status:'sampled-river-approach'}}},before=JSON.stringify(world),visited=[];
 const r=selectPopulationStart(world,{planner:{plan:i=>{visited.push(i);return{sites:[i===0?dry:wet]};}}});assert.equal(r.id,wet.id);assert.equal(r.latDeg,wet.latDeg);assert.equal(r.lonDeg,wet.lonDeg);assert.deepEqual(visited,[0,1]);assert.equal(JSON.stringify(world),before);assert.equal(r.surveyedRegions,2);
});
test('initial view handles empty populations and respects bounded search',()=>{
 assert.equal(selectPopulationStart({}),null);const w={population:{cells:[{cellIndex:0,villages:1,suitability:.5},{cellIndex:1,villages:1,suitability:.5}]}};let n=0;assert.equal(selectPopulationStart(w,{maxRegions:1,planner:{plan:()=>{n++;return{sites:[]};}}}),null);assert.equal(n,1);assert.throws(()=>selectPopulationStart(w,{maxRegions:100}),/budget/);
});

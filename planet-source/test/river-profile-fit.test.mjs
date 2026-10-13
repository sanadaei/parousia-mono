import test from 'node:test';import assert from 'node:assert/strict';import {fitMonotoneWaterProfile} from '../src/core/river-profile-fit.mjs';
const p=(lo,hi,preferred)=>({minimumLevelM:lo,maximumLevelM:hi,preferredLevelM:preferred});
test('downstream constraints prevent a premature greedy water level drop',()=>{const r=fitMonotoneWaterProfile([p(0,10,10),p(0,9,2),p(7,9,8),p(0,3,1)],{startLevelM:10,endLevelM:1});assert.equal(r.valid,true);assert.deepEqual(r.levels,[10,7,7,1]);});
test('infeasible incision constraints and uphill fixed endpoints stay rejected',()=>{assert.equal(fitMonotoneWaterProfile([p(0,10,10),p(0,6,2),p(7,9,8)],{startLevelM:10,endLevelM:8}).valid,false);assert.equal(fitMonotoneWaterProfile([p(0,10,0),p(0,10,0)],{startLevelM:1,endLevelM:2}).valid,false);});
test('constant reservoir profile and exact endpoints are retained',()=>{const r=fitMonotoneWaterProfile([p(-10,0,-2),p(-10,0,-3)],{startLevelM:0,endLevelM:0});assert.deepEqual(r.levels,[0,0]);});

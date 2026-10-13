import test from 'node:test';import assert from 'node:assert/strict';
import {boundBatterBlend} from '../src/core/earthwork-bounds.mjs';
test('cut/fill blend intervals enclose both signs, neutral ground and finite minimum widths',()=>{
 for(const base of [[100,100],[99,101]])for(const target of [[95,96],[100,100],[104,106]])for(const offset of [[0,0],[0,4],[4,12],[40,50]])for(const batterWidthM of [0,1]){
  const options={cutBatterSlope:.3,fillBatterSlope:.7,batterWidthM},b=boundBatterBlend(base,target,offset,options);
  for(const z of [base[0],(base[0]+base[1])/2,base[1]])for(const goal of [target[0],(target[0]+target[1])/2,target[1]])for(const d of [offset[0],(offset[0]+offset[1])/2,offset[1]]){
   const delta=goal-z,width=Math.hypot(batterWidthM,1.5*Math.abs(delta)/(delta>0?.7:.3)),t=d===0?0:width===0?1:Math.min(1,d/width),w=1-t*t*(3-2*t),actual=z+delta*w;
   assert.ok(actual>=b.range[0]-1e-12&&actual<=b.range[1]+1e-12);
  }
 }
});
test('batter interval uncertainty converges away from a flat carriageway',()=>{
 const spans=[1,.1,.01,.001].map(e=>{const b=boundBatterBlend([100-e,100+e],[105,105],[5-e,5+e],{cutBatterSlope:.5,fillBatterSlope:.5});return b.range[1]-b.range[0];});
 for(let i=1;i<spans.length;i++)assert.ok(spans[i]<spans[i-1]*.2);
 assert.throws(()=>boundBatterBlend([0,0],[1,1],[-1,1],{cutBatterSlope:1,fillBatterSlope:1}),/nonnegative/);
 assert.throws(()=>boundBatterBlend([0,0],[1,1],[0,1],{cutBatterSlope:0,fillBatterSlope:1}),/positive/);
});

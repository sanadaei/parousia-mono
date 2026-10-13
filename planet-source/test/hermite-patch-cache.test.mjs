import test from 'node:test';import assert from 'node:assert/strict';
import {createPeriodicHermiteAccessor} from '../src/core/hermite-kernel.mjs';
test('one immutable patch cache preserves exact interpolation and avoids repeated page reads',()=>{
 let reads=0;const w=16,h=8,field=Array.from({length:w*h},(_,i)=>Math.sin(i)*7+i%11),get=(x,y)=>field[y*w+x],plain=createPeriodicHermiteAccessor(get,w,h),cached=createPeriodicHermiteAccessor((x,y)=>{reads++;return get(x,y);},w,h,{cacheLastPatch:true});
 for(let j=0;j<30;j++)assert.equal(cached(4.6+j*.01,3.6+j*.01),plain(4.6+j*.01,3.6+j*.01));
 assert.equal(reads,20);
 for(const y of [0,.2,.5,1,3.2,7,8,9])for(let x=-3;x<20;x+=.13)assert.equal(cached(x,y),plain(x,y));
});
test('mutable callers do not opt into caching and incomplete page reads cannot poison a cached patch',()=>{
 let delta=0,fail=true;const plain=createPeriodicHermiteAccessor((x,y)=>x+y+delta,8,8),before=plain(2,2);delta=3;assert.equal(plain(2,2),before+3);
 const cached=createPeriodicHermiteAccessor((x,y)=>{if(fail&&x===3)throw new Error('Missing page');return x+y;},8,8,{cacheLastPatch:true});
 assert.throws(()=>cached(2.6,2.6),/Missing page/);fail=false;assert.equal(cached(2.6,2.6),createPeriodicHermiteAccessor((x,y)=>x+y,8,8)(2.6,2.6));
 assert.throws(()=>createPeriodicHermiteAccessor(()=>0,8,8,{cacheLastPatch:1}),/boolean/);
});

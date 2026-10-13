import test from'node:test';import assert from'node:assert/strict';import{shoreDetailConstraint}from'../src/core/shore-detail.mjs';
test('shore detail preserves the side of every water level while leaving distant detail unchanged',()=>{
 const c=shoreDetailConstraint([0,.5,10],1.5);for(let z=-4;z<15;z+=.013)for(const noise of[-1.5,-.3,0,.7,1.5]){const out=z+c.apply(z,noise);for(const level of[0,.5,10])assert.equal(Math.sign(out-level),Math.sign(z-level));}
 assert.equal(c.apply(5,1.2),1.2);assert.equal(c.apply(0,1.5),0);
});
test('shore attenuation has continuous first derivatives at zero and support boundary',()=>{
 const c=shoreDetailConstraint([0],2),f=x=>c.apply(x,2),eps=1e-5;for(const x of[0,4,-4])assert.ok(Math.abs((f(x+eps)-f(x))/eps-(f(x)-f(x-eps))/eps)<1e-4);
 assert.ok(c.baseGradientMultiplier>=.75);assert.throws(()=>shoreDetailConstraint([NaN],2));
});
import {multiscaleShoreConstraints} from '../src/core/shore-detail.mjs';
test('large landform amplitudes preserve shores without suppressing small-scale ground roughness',()=>{
 const detail={shoreLevelsM:[0,10,200],bands:[{id:'mountain',amplitudeM:450},{id:'hill',amplitudeM:140},{id:'slope',amplitudeM:18},{id:'rough',amplitudeM:.04}]},constraints=multiscaleShoreConstraints(detail);
 for(let z=-100;z<1000;z+=1.7)for(const sign of [-1,1]){const out=z+constraints.reduce((s,b)=>s+b.constraint.apply(z,b.amplitudeM*sign),0);for(const level of detail.shoreLevelsM)assert.equal(Math.sign(out-level),Math.sign(z-level));}
 assert.equal(constraints[3].constraint.apply(30,.04),.04);
});

import {LOCAL_SHORE_METHOD,localShoreMask,localShoreConstraint} from '../src/core/shore-detail.mjs';
test('distant lake levels cannot erase hills on the rest of the planet',()=>{
 const detail={method:LOCAL_SHORE_METHOD,shoreLevelsM:[0],shoreRegions:[{levelElevationM:500,cells:[4*32+5]}],bands:[{id:'hill',amplitudeM:140}]},f=localShoreConstraint(detail,{columns:32,rows:16});
 assert.equal(f(500,[100],5.5,4.5),0);
 assert.ok(f(500,[100],20.5,9.5)>40,'far inland hill retains tens of metres, not centimetres');
 assert.ok(f(500,[100],8,4.5)>40,'finite local shoulder ends');
});
test('local shore mask covers actual interpolation support and has continuous shoulders and seam',()=>{
 const detail={shoreRegions:[{levelElevationM:20,cells:[4*32]}]},mask=localShoreMask(detail,{columns:32,rows:16}),weight=(x,y)=>mask(x,y)[0]?.weight??0;
 for(const x of [-.49,.5,1.49])for(const y of [3.51,4.5,5.49])assert.equal(weight(x,y),1);
 assert.equal(weight(10,4.5),0);assert.ok(Math.abs(weight(-.001,4.5)-weight(31.999,4.5))<1e-10);
 const eps=1e-5;for(const x of [1.5,3])assert.ok(Math.abs((weight(x+eps,4.5)-weight(x,4.5))/eps-(weight(x,4.5)-weight(x-eps,4.5))/eps)<1e-4);
});
test('local shoreline retains the correct wet or dry side of its lake',()=>{
 const detail={method:LOCAL_SHORE_METHOD,shoreLevelsM:[0],shoreRegions:[{levelElevationM:500,cells:[4*32+5]}],bands:[{id:'a',amplitudeM:450},{id:'b',amplitudeM:140},{id:'c',amplitudeM:18},{id:'d',amplitudeM:.04}]},f=localShoreConstraint(detail,{columns:32,rows:16});
 for(let z=0;z<1000;z+=2.3)for(const sign of[-1,1]){const out=z+f(z,detail.bands.map(b=>sign*b.amplitudeM),5.5,4.5);assert.equal(Math.sign(out-500),Math.sign(z-500));assert.equal(Math.sign(out),Math.sign(z));}
});

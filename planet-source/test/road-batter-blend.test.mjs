import test from 'node:test';
import assert from 'node:assert/strict';
import {createRoadAdjustedTerrain} from '../src/core/road-earthwork.mjs';
import {blendBatterElevations,boundBlendedBatters} from '../src/core/earthwork-bounds.mjs';
const base={worldId:'blend-fixture',groundElevationAt:()=>0,sampleAt:()=>({groundElevationM:0,waterDepthM:0})};
const road=(id,y,z,kind='fill')=>({roadId:id,halfWidthM:1,samples:[-30,30].map((x,i)=>({xM:x,yM:y,distanceM:i*60,roadElevationM:z,gradeSlope:0,structureKind:kind}))});
const options={blendPolicy:'squared-odds@1'};
test('new batter policy is explicit, preserves legacy identity and single-road surface',()=>{
 const r=road('a',0,3),old=createRoadAdjustedTerrain(base,[r]),fresh=createRoadAdjustedTerrain(base,[r],options);
 assert.equal(old.roadAdjustmentId,createRoadAdjustedTerrain(base,[r],{}).roadAdjustmentId);
 assert.notEqual(old.roadAdjustmentId,fresh.roadAdjustmentId);
 for(let y=-12;y<=12;y+=.125)assert.equal(old.groundElevationAt(0,y),fresh.groundElevationAt(0,y));
 assert.throws(()=>createRoadAdjustedTerrain(base,[r],{blendPolicy:'unknown'}),/blendPolicy/);
});
test('competing batters blend continuously while carriageways and bridges retain their surfaces',()=>{
 const roads=[road('a',0,2),road('b',7,4)],old=createRoadAdjustedTerrain(base,roads),fresh=createRoadAdjustedTerrain(base,roads,options),reverse=createRoadAdjustedTerrain(base,[...roads].reverse(),options);
 let legacyJump=0,newJump=0,previous;
 for(let i=0;i<=10000;i++){
  const y=1+i*5/10000,a=old.groundElevationAt(0,y),b=fresh.groundElevationAt(0,y);
  assert.equal(b,reverse.groundElevationAt(0,y));
  if(previous){legacyJump=Math.max(legacyJump,Math.abs(a-previous.a));newJump=Math.max(newJump,Math.abs(b-previous.b));}previous={a,b};
 }
 assert.ok(legacyJump>.1);assert.ok(newJump<.002);
 assert.equal(fresh.groundElevationAt(0,0),2);assert.equal(fresh.groundElevationAt(0,7),4);
 const bridge=createRoadAdjustedTerrain(base,[road('deck',0,8,'bridge-deck')],options);
 assert.equal(bridge.groundElevationAt(0,0),0);assert.equal(bridge.roadSurfaceAt(0,0).roadElevationM,8);
});
test('squared-odds intervals contain mixtures including vanishing and near-full weights',()=>{
 let seed=12345;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
 for(let k=0;k<500;k++){
  const entries=Array.from({length:2+k%4},()=>{const a=random(),b=random(),z=random()*20-10;return{minimumInfluence:k%7===0?0:Math.min(a,b),maximumInfluence:k%11===0?1:Math.max(a,b),range:[z,z+random()*5]};});
  const range=boundBlendedBatters(entries,[-2,2]);
  for(let j=0;j<30;j++){
   const c=entries.map((e,i)=>({influence:j===0?e.minimumInfluence:j===1?e.maximumInfluence:e.minimumInfluence+random()*(e.maximumInfluence-e.minimumInfluence),elevation:e.range[0]+random()*(e.range[1]-e.range[0]),distance:i}));
   const z=blendBatterElevations(c,0);assert.ok(z>=range[0]-1e-10&&z<=range[1]+1e-10,`${z} outside ${range}`);
  }
 }
 const c=[{influence:1-Number.EPSILON,elevation:3,distance:0},{influence:.8,elevation:8,distance:1}];
 assert.ok(Number.isFinite(blendBatterElevations(c,0)));assert.ok(Math.abs(blendBatterElevations(c,0)-3)<1e-12);
});
test('overlapping cut/fill bounds contain dense samples and converge at an equal-influence crossing',()=>{
 for(const roads of [[road('a',0,2),road('b',7,4)],[road('a',0,-2,'cut'),road('b',7,4)]]){
  const t=createRoadAdjustedTerrain(base,roads,options);
  for(let y=-4;y<=11;y+=.25){const disk={xM:0,yM:y,radiusM:.12},range=t.boundGroundElevation([0,0],disk);
   for(let i=0;i<=24;i++){const z=t.groundElevationAt(0,y-.12+i*.01);assert.ok(z>=range[0]&&z<=range[1],`${y}: ${z} outside ${range}`);}
  }
  const ranges=[.1,.01,.001,.0001].map(radiusM=>t.boundGroundElevation([0,0],{xM:0,yM:3,radiusM}));
  assert.ok(ranges.at(-1)[1]-ranges.at(-1)[0]<.001);
 }
});

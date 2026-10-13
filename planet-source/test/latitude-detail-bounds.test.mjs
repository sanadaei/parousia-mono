import test from'node:test';import assert from'node:assert/strict';
import{createAnchoredSphericalDetail}from'../src/core/spherical-detail.mjs';
import{localShoreSpatialGradient,localShoreConstraint,LOCAL_SHORE_METHOD}from'../src/core/shore-detail.mjs';
import{offsetGeographic}from'../src/core/spherical.mjs';
const radius=6371000,state={seed:'latitude-scope',grid:{columns:128,rows:64},frame:{radiusM:radius},detail:{method:LOCAL_SHORE_METHOD,shoreLevelsM:[0],shoreRegions:[{cells:[3968,3969,4096,4097],levelElevationM:600}],bands:[{id:'hills',amplitudeM:100,wavelengthM:900,shoreBudgetFraction:.4},{id:'massifs',amplitudeM:900,wavelengthM:2500,shoreBudgetFraction:.6}]}},d=createAnchoredSphericalDetail(state);
test('interior detail bounds exclude polar coordinate amplification without changing cap bounds',()=>{
 assert.equal(d.lipschitzForLatitudeRange(-Math.PI/2,Math.PI/2),d.lipschitzMPerM);
 assert.ok(d.lipschitzForLatitudeRange(-.1,.1)<d.lipschitzMPerM);
 const global=localShoreSpatialGradient(state.detail,state.grid,radius),equator=localShoreSpatialGradient(state.detail,state.grid,radius,[-.1,.1]);assert.ok(equator<global/20);
 assert.equal(localShoreSpatialGradient(state.detail,state.grid,radius,[1.56,Math.PI/2]),global);
 assert.throws(()=>d.lipschitzForLatitudeRange(1,-1),/latitude/);assert.throws(()=>localShoreSpatialGradient(state.detail,state.grid,radius,[NaN,0]),/latitude/);
});
test('latitude-scoped bound encloses finite differences of the actual shore-constrained residual',()=>{
 const constraint=localShoreConstraint(state.detail,state.grid),value=p=>{const x=((p.lonDeg%360+360)%360)/360*128,y=(90-p.latDeg)/180*64;return constraint(650,d.sampleParts(p,x,y),x,y);};let checked=0;
 for(const lat of [-60,-30,-3,0,3,30,60])for(let lon=-180;lon<180;lon+=15){const p={latDeg:lat,lonDeg:lon},low=(lat-1)*Math.PI/180,high=(lat+1)*Math.PI/180,bound=d.lipschitzForLatitudeRange(low,high)+localShoreSpatialGradient(state.detail,state.grid,radius,[low,high]);
  for(const [x,y]of [[1,0],[0,1],[Math.SQRT1_2,Math.SQRT1_2]]){const a=offsetGeographic(p,x*5,y*5,radius),b=offsetGeographic(p,-x*5,-y*5,radius);assert.ok(Math.abs(value(a)-value(b))/10<=bound*(1+1e-8));checked++;}
 }
 assert.equal(checked,504);
});

import test from 'node:test';import assert from 'node:assert/strict';
import {projectedHullEnvelope,projectedHullAxisRange,validateProjectedHull} from '../src/core/projected-hull.mjs';
import {tileBound,geographic,normalize} from '../src/globe/cube.mjs';
import {sphereBasis,createSphericalProjection,offsetGeographic} from '../src/core/spherical.mjs';
import {validateMetricDisk} from '../src/core/contract-validation.mjs';
test('projected corner hull encloses correlated road-axis queries from millimetres to regional cells',()=>{
 const R=6371000;let count=0;
 for(const face of[0,3,5])for(const level of[8,16,28,32]){
  const tile={face,level,x:Math.floor(2**level*.37),y:Math.floor(2**level*.71)},bound=tileBound(tile,R),point=geographic(bound.center),center=offsetGeographic(point,30000,-10000,R),basis=sphereBasis(center),
   projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM:R}),hull=projectedHullEnvelope(bound.corners,basis,R);
  assert.ok(hull);assert.deepEqual(validateProjectedHull(hull),hull);
  for(let i=0;i<40;i++){
    const weights=bound.corners.map((_,k)=>(Math.sin(i*17+k*37)+1.01)),sum=weights.reduce((a,b)=>a+b,0),d=normalize([0,1,2].map(k=>weights.reduce((n,w,j)=>n+w*bound.corners[j][k]/sum,0))),p=geographic(d),local=projection.toLocal(p.latDeg,p.lonDeg);
    for(let a=0;a<8;a++){
      const x=Math.cos(a*Math.PI/4),y=Math.sin(a*Math.PI/4),range=projectedHullAxisRange(hull,x,y),actual=local.xM*x+local.yM*y;
      assert.ok(actual>=range[0]&&actual<=range[1],`${level}: ${actual} outside ${range}`);count++;
    }
  }
 }
 assert.equal(count,3840);
});
test('invalid projected hulls cannot silently restrict a terrain disk',()=>{
 assert.throws(()=>validateMetricDisk({xM:0,yM:0,radiusM:1,projectedHull:{points:[],minScaleM:1,maxScaleM:1,roundingM:0}}));
 assert.equal(projectedHullEnvelope([],sphereBasis({latDeg:0,lonDeg:0}),6371000),null);
 assert.equal(projectedHullAxisRange(null,1,0),null);
 assert.deepEqual(validateMetricDisk({xM:0,yM:0,radiusM:1}),{xM:0,yM:0,radiusM:1});
});

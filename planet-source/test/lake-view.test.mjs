import test from'node:test';import assert from'node:assert/strict';
import{lakeShoreView}from'../src/globe/lake-view.mjs';import{greatCircle}from'../src/core/spherical.mjs';
const lake={latDeg:74,lonDeg:179,shoreRadiusSamplesM:Array.from({length:12},(_,i)=>10000+i*1000)};
test('shore inspection follows saved spherical distances and cycles without mutating world',()=>{
 const original=structuredClone(lake);for(let i=0;i<12;i++){
  const v=lakeShoreView(lake,6371000,i);assert.equal(v.ray,i);assert.ok(Math.abs(greatCircle(lake,v.point).distanceM-lake.shoreRadiusSamplesM[i])<1e-6);assert.ok(Math.abs(v.point.lonDeg)<=180);assert.equal(v.approximate,true);
 }assert.deepEqual(lakeShoreView(lake,6371000,12),lakeShoreView(lake,6371000,0));assert.deepEqual(lake,original);
});
test('missing or invalid shoreline metadata does not invent a shore',()=>{
 for(const l of[null,{}, {...lake,shoreRadiusSamplesM:[]},{...lake,shoreRadiusSamplesM:Array(12).fill(null)},{...lake,latDeg:95}])assert.equal(lakeShoreView(l,6371000),null);
 assert.equal(lakeShoreView(lake,0),null);assert.equal(lakeShoreView(lake,6371000,.5),null);
});

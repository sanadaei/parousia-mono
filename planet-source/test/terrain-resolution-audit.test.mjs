import test from 'node:test';import assert from 'node:assert/strict';
import {auditTerrainResolution} from '../scripts/audit-terrain-resolution.mjs';
const flat={worldId:'constant-test',base:{frame:{radiusM:6371000},groundElevationAt:()=>123}};
test('finite resolution audit preserves constant radial height across cube edges and poles',()=>{
 for(const center of [{latDeg:0,lonDeg:45},{latDeg:0,lonDeg:180},{latDeg:90,lonDeg:0},{latDeg:-90,lonDeg:73}]){
  const r=auditTerrainResolution(flat,center,{levels:[0,14,17],spanM:100,stepM:5});for(const p of r.profiles){assert.equal(p.rows.length,21);assert.ok(p.maxAbsErrorM<1e-10);assert.equal(p.rows[0].offsetM,-50);assert.equal(p.rows.at(-1).offsetM,50);}
 }
});
test('resolution audit reports finite errors for a nonflat analytic field and is repeatable',()=>{
 const w={worldId:'analytic-test',base:{frame:{radiusM:6371000},groundElevationAt:(lat,lon)=>100*Math.sin(lat*100)+50*Math.cos(lon*100)}};
 const o={levels:[12,16],spanM:500,stepM:10},p={latDeg:34,lonDeg:135},a=auditTerrainResolution(w,p,o);assert.deepEqual(a,auditTerrainResolution(w,p,o));assert.ok(a.profiles[0].maxAbsErrorM>a.profiles[1].maxAbsErrorM);assert.ok(a.scope.includes('Not a global error bound'));
});
test('resolution audit rejects unbounded or invalid requests before sampling',()=>{
 for(const o of [{levels:[]},{levels:[1,1]},{levels:[23]},{spanM:Infinity},{spanM:100001},{stepM:0},{stepM:.00001},{bearingDeg:NaN}])assert.throws(()=>auditTerrainResolution(flat,{latDeg:0,lonDeg:0},o),RangeError);
 assert.throws(()=>auditTerrainResolution(flat,{latDeg:91,lonDeg:0}),RangeError);
});

test('bearing selects the transect direction rather than changing the terrain',()=>{const w={worldId:'latitude',base:{frame:{radiusM:6371000},groundElevationAt:lat=>lat*10000}};const p={latDeg:0,lonDeg:0};const east=auditTerrainResolution(w,p,{levels:[14],spanM:100,stepM:10,bearingDeg:90}),north=auditTerrainResolution(w,p,{levels:[14],spanM:100,stepM:10,bearingDeg:0});assert.ok(Math.abs(east.profiles[0].rows.at(-1).actualM)<1e-8);assert.ok(north.profiles[0].rows.at(-1).actualM>4);});

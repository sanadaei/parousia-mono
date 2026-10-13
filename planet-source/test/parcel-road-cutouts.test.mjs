import test from 'node:test';import assert from 'node:assert/strict';
import {cutParcelRoads} from '../src/core/parcel-road-cutouts.mjs';
const p=(xM,yM)=>({xM,yM,elevationM:100+xM*.01+yM*.02});
const field={id:'field',ownerId:'village',boundary:[p(-50,-50),p(50,-50),p(50,50),p(-50,50)],triangles:[[p(-50,-50),p(50,-50),p(50,50)],[p(-50,-50),p(50,50),p(-50,50)]]};
const road={a:p(-100,0),b:p(100,0),width:2.5};
const area=t=>Math.abs((t[1].xM-t[0].xM)*(t[2].yM-t[0].yM)-(t[1].yM-t[0].yM)*(t[2].xM-t[0].xM))/2;
test('a road cuts only its corridor out of an accepted field rather than deleting the whole strip',()=>{
 const saved=structuredClone(field),[result]=cutParcelRoads([field],[road]);assert.equal(result.id,field.id);assert.equal(result.ownerId,field.ownerId);assert.equal(result.boundary,undefined);assert.deepEqual(result.sourceBoundary,field.boundary);
 assert.ok(Math.abs(result.triangles.reduce((n,t)=>n+area(t),0)-9350)<1e-7);
 for(const t of result.triangles){assert.ok(t.every(p=>p.yM>=3.25-1e-8)||t.every(p=>p.yM<=-3.25+1e-8));for(const p of t)assert.ok(Math.abs(p.elevationM-(100+p.xM*.01+p.yM*.02))<1e-8);}
 assert.deepEqual(field,saved);assert.deepEqual(cutParcelRoads([field],[road]),[result]);
});
test('crossing and finite roads retain only nonoverlapping safe field fragments',()=>{
 const vertical={a:p(0,-100),b:p(0,100),width:2.5},[r]=cutParcelRoads([field],[road,vertical]);assert.ok(Math.abs(r.triangles.reduce((n,t)=>n+area(t),0)-93.5**2)<1e-7);
 const finite={a:p(-10,0),b:p(10,0),width:2.5},[f]=cutParcelRoads([field],[finite]);assert.ok(Math.abs(f.triangles.reduce((n,t)=>n+area(t),0)-(10000-26.5*6.5))<1e-7);
 const remote={a:p(100,100),b:p(200,100),width:2.5};assert.deepEqual(cutParcelRoads([field],[remote])[0].triangles,field.triangles);
});
test('field clipping declares budget deferral instead of silently truncating geometry',()=>{
 const report={};assert.deepEqual(cutParcelRoads([field],[road],{maxTriangles:1,report}),[]);assert.equal(report.deferredParcels,1);
 assert.throws(()=>cutParcelRoads([field],[{...road,width:NaN}]));
});

import {copyJson} from '../src/core/json-contract.mjs';
test('clipped parcels remain finite serializable world records with or without source boundary',()=>{for(const input of [field,{id:'mesh-only',triangles:field.triangles}]){const [result]=cutParcelRoads([input],[road]);assert.equal(Object.hasOwn(result,'boundary'),false);assert.doesNotThrow(()=>copyJson(result));assert.deepEqual(copyJson(result),JSON.parse(JSON.stringify(result)));}});

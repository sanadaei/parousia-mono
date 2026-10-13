import test from 'node:test';import assert from 'node:assert/strict';import {landscapeTileGrid,LANDSCAPE_PROFILE,createWoodlandRecipe} from '../src/core/regional-landscape.mjs';import {landscapeParcelBoundary} from '../src/core/landscape-parcels.mjs';import {offsetGeographic} from '../src/core/spherical.mjs';import {buildBuildingMesh} from '../src/globe/buildings.mjs';
const R=6371000,grid=landscapeTileGrid(R),tile=grid.at(20,30),config={profile:LANDSCAPE_PROFILE,seed:'fields',grid:{columns:16,rows:8},biome:Array(128).fill('temperate_forest'),temperatureC:Array(128).fill(15),baseElevationM:Array(128).fill(100)},base={frame:{radiusM:R},groundElevationAt:()=>100,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0})};
test('field domain is a stable polygon, not a streaming rectangle',()=>{const a=landscapeParcelBoundary(grid,tile,R,'fields'),b=landscapeParcelBoundary(grid,tile,R,'fields');assert.deepEqual(a.polygon,b.polygon);assert.ok(a.polygon.length>=4);assert.ok(a.polygon.some((p,i)=>{const q=a.polygon[(i+1)%a.polygon.length];return Math.abs(p.xM-q.xM)>1&&Math.abs(p.yM-q.yM)>1;}));});
test('food hinterland generates real surveyed strips with fixed ownership and mesh',()=>{const site={id:'v',population:300,...offsetGeographic(tile,700,0,R),economicContext:{agriculturalDependentPopulation:300,foodKgPerPersonYear:250,netGrainKgPerHa:250,agricultureSuitability:.8}},r=createWoodlandRecipe(base,config,tile,{nearbySettlements:[site]});assert.ok(r.landParcels.length>0);assert.equal(r.vegetation.length,0);assert.ok(r.landParcels.every(p=>p.ownerId==='v'&&p.triangles.length>0));const mesh=buildBuildingMesh(r,R);assert.ok(mesh.index.length>0);assert.ok(mesh.vertex.every(Number.isFinite));assert.deepEqual(r.landParcels,createWoodlandRecipe(base,config,tile,{nearbySettlements:[site]}).landParcels);});

import {createLandscapeFields} from '../src/core/landscape-parcels.mjs';
import {compactSettlementLand,createSettlementLandClearance} from '../src/core/settlement-land-clearance.mjs';
const arable={sample:()=>({kind:'arable',ownerId:'v'})};
const area=fields=>fields.reduce((sum,f)=>sum+f.triangles.reduce((n,[a,b,c])=>n+Math.abs((b.xM-a.xM)*(c.yM-a.yM)-(b.yM-a.yM)*(c.xM-a.xM))/2,0),0);
test('a civic reservation removes local field triangles, not every strip it touches',()=>{
 const {projection}=landscapeParcelBoundary(grid,tile,R,config.seed),reservation=createSettlementLandClearance([compactSettlementLand({projection:projection.contract,buildings:[{bounds:{minXM:-20,maxXM:20,minYM:-20,maxYM:20}}]},'v')]),opts={...config,fieldSurvey:'local-triangle-clearance@1'};
 const old=createLandscapeFields(base,config,tile,grid,arable,[],null,reservation),fresh=createLandscapeFields(base,opts,tile,grid,arable,[],null,reservation);
 assert.ok(area(fresh)>area(old)+1000);assert.ok(fresh.some(f=>f.rejectedTriangles>0));
 for(const f of fresh)for(const t of f.triangles)assert.equal(reservation.intersectsGeographicTriangle(t.map(p=>projection.toGeographic(p.xM,p.yM))),false);
 assert.deepEqual(fresh,createLandscapeFields(base,opts,tile,grid,arable,[],null,reservation));
});
test('partial fields require known dry ground and a bounded two-dimensional grade',()=>{
 const {projection}=landscapeParcelBoundary(grid,tile,R,config.seed),opts={...config,fieldSurvey:'local-triangle-clearance@1'},steep={...base,sampleSurfaceAt:(lat,lon)=>({groundElevationM:100+projection.toLocalIfWithin(lat,lon).xM*.2,waterDepthM:0})};
 assert.deepEqual(createLandscapeFields(steep,opts,tile,grid,arable,[]),[]);
 assert.deepEqual(createLandscapeFields({...base,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:null})},opts,tile,grid,arable,[]),[]);
});

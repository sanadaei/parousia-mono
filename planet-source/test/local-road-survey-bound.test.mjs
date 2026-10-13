import test from 'node:test';import assert from 'node:assert/strict';
import {localRoadSurveyIntersects} from '../src/core/regional-road-network.mjs';
import {createSphericalProjection,sphereBasis} from '../src/core/spherical.mjs';
import {PagedSource} from '../src/globe/paged-source.mjs';
const radiusM=6371000;
test('rectangular road survey excludes distant side regions without choosing a route',()=>{
 const projection=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM}),link={fromPoint:projection.toGeographic(0,0),toPoint:projection.toGeographic(20000,0),distanceM:20000},bound=(x,y,r=100)=>({center:sphereBasis(projection.toGeographic(x,y)).up,angular:r/radiusM});
 assert.equal(localRoadSurveyIntersects(link,bound(10000,20000),radiusM),false);
 assert.equal(localRoadSurveyIntersects(link,bound(10000,10500),radiusM),true);
 assert.equal(localRoadSurveyIntersects(link,bound(10000,11500,600),radiusM),true);
 assert.equal(localRoadSurveyIntersects(link,bound(10000,12000,100),radiusM),false);
});
test('every widest survey grid corner remains inside at equator, dateline and high latitude',()=>{
 for(const center of [{latDeg:0,lonDeg:0},{latDeg:30,lonDeg:179.9},{latDeg:80,lonDeg:-179.9}])for(const [x,y] of [[60000,0],[0,-60000],[35000,35000],[-35000,35000]]){
  const projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM}),link={fromPoint:center,toPoint:projection.toGeographic(x,y)};
  for(const gx of [Math.min(0,x)-10000,Math.max(0,x)+10625])for(const gy of [Math.min(0,y)-10000,Math.max(0,y)+10625]){
   const point=projection.toGeographic(gx,gy);assert.equal(localRoadSurveyIntersects(link,{center:sphereBasis(point).up,angular:0},radiusM),true);
  }
 }
});
test('paged terrain rejects an irrelevant road before requesting its expensive recipe',async()=>{
 const projection=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM}),descriptor={procedural:true,roadLink:{fromPoint:projection.toGeographic(0,0),toPoint:projection.toGeographic(20000,0),distanceM:20000}},source=Object.assign(Object.create(PagedSource.prototype),{base:{frame:{radiusM}},featureRecipe(){throw Error('Unnecessary route generation');}});
 const result=await source.enableFeatures(null,descriptor,{bound:{center:sphereBasis(projection.toGeographic(10000,20000)).up,angular:100/radiusM}});assert.equal(result,'outside');
});

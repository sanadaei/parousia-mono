import test from 'node:test';import assert from 'node:assert/strict';
import {createSettlementLayout} from '../src/core/settlement-layout.mjs';
import {createSphericalProjection} from '../src/core/spherical.mjs';
const R=6371000,projection=createSphericalProjection({centerLatDeg:20,centerLonDeg:30,radiusM:R,maxRadiusM:3000});
const ground=(lat,lon)=>{const p=projection.toLocalIfWithin(lat,lon);return 100+p.xM*.015+p.yM*.065;};
const base={worldId:'sloping-civic-test',frame:{radiusM:R},groundElevationAt:ground,sampleSurfaceAt:(lat,lon)=>({groundElevationM:ground(lat,lon),waterDepthM:0})};
const site={id:'slope-town',kind:'town',population:2000,latDeg:20,lonDeg:30,economicContext:{layoutPolicy:'terrain-led-neighborhood@2',institutionPolicy:'medieval-communal@1',urbanFacilityPolicy:'surveyed-urban-service-parcels@1',urbanBlockSeedPolicy:'terrain-ranked-block-seeds@2'}};
const next={...site,economicContext:{...site.economicContext,urbanPublicSitePolicy:'surveyed-civic-chapel@1'}};
test('civic chapel searches street-facing dry land instead of disappearing at one fixed site',()=>{
 const before=JSON.stringify(next),old=createSettlementLayout(base,site),r=createSettlementLayout(base,next);
 assert.equal(old.buildings.filter(b=>b.facilityType==='chapel').length,0);
 assert.equal(r.buildings.filter(b=>b.facilityType==='chapel').length,1);assert.equal(r.landParcels.filter(p=>p.type==='churchyard').length,1);
 assert.ok(r.publicSiteSurvey.site.foundationReliefM<=1.2);assert.ok(r.publicSiteSurvey.totalSurveyed<=96);
 const church=r.buildings.find(b=>b.facilityType==='chapel');assert.ok(r.publicAccess.some(p=>p.targetId===church.id&&p.status==='connected'));
 assert.equal(r.layoutStatus.placedDwellings,old.layoutStatus.placedDwellings);assert.deepEqual(r,createSettlementLayout(base,next));assert.equal(JSON.stringify(next),before);
});
test('civic search never supplies a church without its institution or on wet ground',()=>{
 const noInstitution=createSettlementLayout(base,{...next,economicContext:{...next.economicContext,institutionPolicy:undefined}});assert.equal(noInstitution.buildings.filter(b=>b.facilityType==='chapel').length,0);assert.equal(noInstitution.publicSiteSurvey,undefined);
 const wet={...base,sampleSurfaceAt:(lat,lon)=>({groundElevationM:ground(lat,lon),waterDepthM:1})},r=createSettlementLayout(wet,next);assert.equal(r.buildings.filter(b=>b.facilityType==='chapel').length,0);assert.equal(r.publicSiteSurvey.site,null);assert.ok(r.publicSiteSurvey.totalSurveyed<=96);
});

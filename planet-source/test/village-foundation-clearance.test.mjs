import test from'node:test';import assert from'node:assert/strict';
import{createTerrainLedNeighborhood}from'../src/core/terrain-led-neighborhood.mjs';
import{createGlobeFeatureChart}from'../src/core/globe-features.mjs';
import{createSphericalProjection}from'../src/core/spherical.mjs';
import{buildingPadAffectsPoint}from'../src/core/building-pad.mjs';
const site={id:'sloping-village',population:300,latDeg:1.4,lonDeg:-134.99,economicContext:{institutionPolicy:'medieval-communal@1',publicSitePolicy:'surveyed-street-public-sites@1',streetPolicy:'terrain-led-branches@2',facilityPolicy:'frontage-service-parcels@2',publicAccessPolicy:'surveyed-public-footpaths@1',housingInfillPolicy:'surveyed-residential-infill@2',agricultureSuitability:.8,grainKgPerPersonYear:300,woodland:true}},projection=createSphericalProjection({centerLatDeg:site.latDeg,centerLonDeg:site.lonDeg,radiusM:6371000,maxRadiusM:2000});
const ground=(lat,lon)=>{const p=projection.toLocal(lat,lon);return 100+.025*p.xM+.035*p.yM;},base={worldId:'slope',frame:{radiusM:6371000},groundElevationAt:ground,sampleSurfaceAt:(lat,lon)=>({groundElevationM:ground(lat,lon),waterDepthM:0})};
test('new village pad policy keeps foundations off existing surveyed streets',()=>{
 const legacy=createTerrainLedNeighborhood(base,site),fresh=createTerrainLedNeighborhood(base,{...site,economicContext:{...site.economicContext,roadPadClearance:'surveyed-frontage-pads@1'}});
 assert.deepEqual(legacy,createTerrainLedNeighborhood(base,site));assert.ok(fresh.layoutStatus.placedDwellings>40);assert.equal(fresh.publicAccess.find(a=>a.targetType==='chapel')?.status,'connected');
 const chart=createGlobeFeatureChart(base,fresh);let samples=0;
 for(const road of fresh.roadCenterlineProfiles)for(const p of road.samples){const geo=chart.projection.toGeographic(p.xM,p.yM),s=chart.sampleAt(geo.latDeg,geo.lonDeg);assert.ok(s,'Road endpoint stays in its chart after spherical round trip');assert.equal(s.buildingId,null);samples++;}
 assert.ok(samples>100);
});
test('chart edge round trips tolerate floating error but not real outside points',()=>{
 const r=createTerrainLedNeighborhood(base,site),chart=createGlobeFeatureChart(base,r);
 for(const [x,y]of [[-200,0],[200,0],[0,-230],[0,230],[-200,-230],[200,230]]){const p=chart.projection.toGeographic(x,y);assert.ok(chart.local(p.latDeg,p.lonDeg));}
 for(const [x,y]of [[-200.00001,0],[200.00001,0],[0,-230.00001],[0,230.00001]]){const p=chart.projection.toGeographic(x,y);assert.equal(chart.local(p.latDeg,p.lonDeg),null);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {planFrontageGardens} from '../src/core/frontage-gardens.mjs';
import {createSettlementLayout} from '../src/core/settlement-layout.mjs';
const b={id:'home',bounds:{minXM:-3,maxXM:3,minYM:-4,maxYM:4},frontage:{access:{xM:0,yM:-10}}};
const input={buildings:[b],roads:[],ground:()=>100,water:()=>({waterDepthM:0}),backland:true,withinPlot:(_b,p)=>p.yM<=40&&Math.abs(p.xM)<=20};
test('backland depths use owned space, fall back at boundaries and leave legacy gardens unchanged',()=>{
 const r=planFrontageGardens(input);assert.equal(r.length,1);assert.equal(r[0].areaM2,240);assert.equal(r[0].depthM,30);assert.deepEqual(r,planFrontageGardens(input));
 const small=planFrontageGardens({...input,withinPlot:(_b,p)=>p.yM<=25});assert.equal(small[0].depthM,18);
 assert.equal(planFrontageGardens({...input,backland:false})[0].areaM2,112);
 assert.throws(()=>planFrontageGardens({...input,withinPlot:null}),/owned plot/);
});
test('backland allocations cannot cross occupied plots, sampled wet ground or steep slopes',()=>{
 const blocked={minXM:-5,maxXM:5,minYM:27,maxYM:50};assert.equal(planFrontageGardens({...input,reservations:[blocked]})[0].depthM,18);
 assert.equal(planFrontageGardens({...input,water:(_x,y)=>({waterDepthM:y>5?1:0})}).length,0);
 assert.equal(planFrontageGardens({...input,ground:(_x,y)=>100+y*.2}).length,0);
 assert.equal(planFrontageGardens({...input,roads:[{halfWidthM:2,samples:[{xM:0,yM:10}]}]}).length,0);
});
test('urban garden changes preserve homes, pads, streets and paging identities',()=>{
 const base={worldId:'flat',frame:{radiusM:6371000},groundElevationAt:()=>100,sampleSurfaceAt:()=>({groundElevationM:100,waterDepthM:0})};
 const site={id:'town',kind:'town',population:3200,latDeg:20,lonDeg:30,economicContext:{layoutPolicy:'terrain-led-neighborhood@2',institutionPolicy:'medieval-communal@1',urbanBlockSeedPolicy:'terrain-ranked-block-seeds@2'}};
 let oldArea=0,newArea=0;
 for(const districtIndex of [0,1,6]){const a=createSettlementLayout(base,site,{districtIndex}),next={...site,economicContext:{...site.economicContext,gardenParcelPolicy:'bounded-backland-gardens@1'}},r=createSettlementLayout(base,next,{districtIndex});assert.deepEqual(r.buildings,a.buildings);assert.deepEqual(r.buildingPads,a.buildingPads);assert.deepEqual(r.roadCenterlineProfiles,a.roadCenterlineProfiles);assert.deepEqual(r,createSettlementLayout(base,next,{districtIndex}));oldArea+=a.landParcels.filter(p=>p.type==='household_garden').reduce((n,p)=>n+p.areaM2,0);newArea+=r.landParcels.filter(p=>p.type==='household_garden').reduce((n,p)=>n+p.areaM2,0);}
 assert.ok(newArea>oldArea,{oldArea,newArea});
});

test('expansion preserves eligible minimum gardens for later households',()=>{
 const opposite={id:'opposite',bounds:{minXM:-3,maxXM:3,minYM:46,maxYM:54},frontage:{access:{xM:0,yM:60}}};
 const r=planFrontageGardens({...input,buildings:[b,opposite],withinPlot:()=>true});
 assert.equal(r.length,2);assert.ok(r.every(p=>p.depthM>=14));assert.ok(r.reduce((n,p)=>n+p.areaM2,0)>224);
 const [a,c]=r;assert.ok(Math.max(...a.points.map(p=>p.yM))+1<=Math.min(...c.points.map(p=>p.yM)));
});

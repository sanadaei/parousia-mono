import test from'node:test';import assert from'node:assert/strict';import{riverViews,tributaryCoverageText}from'../src/globe/river-views.mjs';
test('river navigation uses saved coordinates and never fills missing water',()=>{assert.deepEqual(riverViews(null),[]);const p={id:'tributary-region@1/x',points:[{latDeg:2,lonDeg:3},{latDeg:4,lonDeg:5}]},r=riverViews({profiles:[p]});assert.equal(r[0].latDeg,4);assert.equal(r[0].lonDeg,5);assert.equal(r[0].viewAltitudeM,150);assert.deepEqual(r,riverViews({profiles:[p]}));});
test('water UI discloses unmodeled and budget-withheld catchments',()=>{assert.match(tributaryCoverageText(null),/未対応/);const s=tributaryCoverageText({diagnostics:{localTributaries:{regions:[{drainage:{boundaryTruncatedBasins:20,depressionDependentBasins:3},compilation:{rejected:[{}]}}],withheld:[{}]}}});assert.match(s,/境界未確定20/);assert.match(s,/窪地未解決3/);assert.match(s,/除外1流域/);assert.match(s,/完成を意味しません/);});

import{waterSettlementViews,settlementWaterCoverageText}from'../src/globe/river-views.mjs';
test('water settlement destinations use bounded saved siting evidence and disclose its limits',()=>{assert.deepEqual(waterSettlementViews(null),[]);const c={totals:{placed:1000},waterAccess:{accepted:1,rejected:3,examples:[{id:'pop:1:0',latDeg:1,lonDeg:2,sourceId:'river:1',approachDistanceM:180}]}};assert.equal(waterSettlementViews(c)[0].lonDeg,2);assert.match(settlementWaterCoverageText(c),/1か所/);assert.match(settlementWaterCoverageText(c),/全1000/);assert.match(settlementWaterCoverageText(c),/洪水安全性は未評価/);assert.match(settlementWaterCoverageText(null),/未調査/);});

test('river navigation distinguishes middle-scale tributaries and frames broad channels',()=>{
 const profiles=[{id:'river:1',points:[{latDeg:0,lonDeg:0,halfWidthM:700},{latDeg:1,lonDeg:1,halfWidthM:700}]},{id:'tributary-region@3/regional/x/channel:1',points:[{latDeg:2,lonDeg:2,halfWidthM:20},{latDeg:3,lonDeg:3,halfWidthM:20}]}];
 const v=riverViews({profiles});assert.match(v[0].name,/本流/);assert.equal(v[0].viewAltitudeM,11200);assert.match(v[1].name,/支流/);assert.equal(v[1].viewAltitudeM,500);
});

import test from'node:test';import assert from'node:assert/strict';import{worldExperimentLink,worldSnapshotRequest,checkExpectedWorld}from'../src/globe/world-link.mjs';
const page='http://localhost:3000/src/globe/index.html',manifestURL='http://localhost:3000/examples/other/manifest.json',manifest={planetSnapshot:'./world.snapshot.json',canonicalWorldId:'sha256:example'};
test('experiment navigation carries the selected package and village, not the default world',()=>{
 const link=worldExperimentLink('vehicle.html',manifest,manifestURL,page,'settlement:2'),url=new URL(link),request=worldSnapshotRequest(link);
 assert.equal(url.searchParams.get('settlement'),'settlement:2');assert.equal(request.url,'http://localhost:3000/examples/other/world.snapshot.json');assert.equal(request.expectedWorldId,manifest.canonicalWorldId);assert.equal(new URL(request.globeURL).searchParams.get('world'),'/examples/other/manifest.json');
 assert.equal(worldExperimentLink('runoff.html',{},manifestURL,page),null);
});
test('world navigation rejects changed identity and cross-origin snapshot substitution',()=>{
 assert.throws(()=>checkExpectedWorld({worldId:'other'},'expected'),/ID/);
 assert.throws(()=>worldExperimentLink('vehicle.html',{...manifest,planetSnapshot:'https://outside.test/world.json'},manifestURL,page),/origin/);
 assert.throws(()=>worldSnapshotRequest('http://localhost:3000/src/globe/runoff.html?world=https://outside.test/world.json'),/origin/);
 assert.equal(worldSnapshotRequest(page).url,'http://localhost:3000/examples/planet/generated/world.snapshot.json');
});

test('bridge foundation view carries the same immutable world and renderer',()=>{
 const link=worldExperimentLink('bridge.html',{...manifest,generationManifest:'worlds/version/manifest.json',planetSnapshot:'worlds/version/world.snapshot.json'},manifestURL,page+'?renderer=software','settlement:2');
 const request=worldSnapshotRequest(link);assert.equal(request.url,'http://localhost:3000/examples/other/worlds/version/world.snapshot.json');
 assert.equal(new URL(link).searchParams.get('renderer'),'software');assert.equal(new URL(request.globeURL).searchParams.get('world'),'/examples/other/worlds/version/manifest.json');
});

import{requestedBridgeSelection}from'../src/globe/world-link.mjs';
test('bridge navigation never substitutes a bridge from another village',()=>{const w={recipes:[{id:'a',bridgeStructures:[{id:'a/bridge'}]},{id:'b',bridgeStructures:[]}]};assert.deepEqual(requestedBridgeSelection(w,'a'),{bridgeId:'a/bridge',missingInRequestedSettlement:false});assert.deepEqual(requestedBridgeSelection(w,'b'),{bridgeId:null,missingInRequestedSettlement:true});assert.equal(requestedBridgeSelection(w).bridgeId,'a/bridge');assert.throws(()=>requestedBridgeSelection(w,'missing'),/存在しません/);assert.equal(requestedBridgeSelection({recipes:[]}).bridgeId,null);});

import{worldVersionLabel}from'../src/globe/world-link.mjs';
test('visible world version distinguishes a pinned old save from the catalog without changing it',()=>{
 const old={base:{revision:'planet-generator@15'},canonicalWorldId:'old'},copy=structuredClone(old),entries=[{worldId:'new',name:'標準世界'}];
 assert.equal(worldVersionLabel(old),'生成版 15');
 assert.match(worldVersionLabel(old,entries),/一覧とは異なる保存版/);
 assert.equal(worldVersionLabel({...old,canonicalWorldId:'new'},entries),'生成版 15 · 標準世界');
 assert.equal(worldVersionLabel({}),'保存世界');assert.deepEqual(old,copy);
});
test('explicit mesh budget survives visiting a world experiment and returning',()=>{
 const link=worldExperimentLink('runoff.html',manifest,manifestURL,page+'?meshBudgetMiB=128','village');
 assert.equal(new URL(link).searchParams.get('meshBudgetMiB'),'128');
 assert.equal(new URL(worldSnapshotRequest(link).globeURL).searchParams.get('meshBudgetMiB'),'128');
});

import {savedLandscapeSummary} from '../src/globe/world-link.mjs';
test('new-generation notice distinguishes saved policies without changing identities or claiming completion',()=>{
 const old={canonicalWorldId:'old',base:{revision:'planet-generator@16'}},copy=structuredClone(old);
 const status=savedLandscapeSummary(old);assert.equal(status.current,false);assert.equal(status.missing.length,6);assert.match(status.text,/再読込だけでは配置は変わりません/);assert.deepEqual(old,copy);
 const partial=savedLandscapeSummary({landscape:{pondPolicy:'surveyed-communal-pond@1',woodlandPattern:'patchy-woodland-stands@1'}});assert.equal(partial.present.length,1);assert.equal(partial.missing.length,5);
 const current=savedLandscapeSummary({landscape:{woodlandPattern:'patchy-woodland-stands@1',landUseMosaic:'mixed-rainfed-hinterland@1',publicGreenPolicy:'surveyed-sloping-commons@1',householdFrontagePolicy:'surveyed-household-frontages@2',pondPolicy:'surveyed-communal-pond@2',residentialStreetPolicy:'surveyed-residential-catchments@1'}});
 assert.equal(current.current,true);assert.match(current.text,/完成を意味するものではありません/);
});
test('generator version labels retain suffix-bearing generator identities',()=>{
 assert.equal(worldVersionLabel({base:{revision:'planet-generator@21-rounded-tributaries'}}),'生成版 21');
 assert.equal(worldVersionLabel({base:{revision:'not-a-generator'}}),'保存世界');
});

import {generationJobMessage} from '../src/globe/world-link.mjs';
test('generation results name the server job instead of claiming it matches an edited seed form',()=>{
 const message=generationJobMessage({status:'complete',seed:'previous-seed'});assert.match(message,/previous-seed/);assert.match(message,/入力欄を変更/);assert.doesNotMatch(message,/同じseed/);
 assert.match(generationJobMessage({status:'running',seed:'new-seed'}),/new-seed/);assert.equal(generationJobMessage({status:'failed',error:'full'}),'full');assert.equal(generationJobMessage({status:'idle'}),'待機中');
});

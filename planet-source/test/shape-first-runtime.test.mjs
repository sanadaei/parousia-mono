import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {prepareShapeFirstModel,sampleShapeHeight,shapeLevelForScale,shapeViewport,shapePointAt,nearestShapeRiver,sha256Text} from '../src/globe/shape-first-model.mjs';
import {shapeFirstRaster} from '../src/globe/shape-first-raster.mjs';
import {createShapeFirstRegions} from '../src/core/shape-first-regions.mjs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const inputs=()=>({candidateText:read('fixtures/shape-first/river-first-candidate.json'),pyramid:JSON.parse(read('reports/shape-first-region/region-pyramid.json')),water:JSON.parse(read('reports/shape-first-water/water-annotation.json'))});
const model=await prepareShapeFirstModel(inputs());
const regions=createShapeFirstRegions(model.candidate,{waterAnnotation:model.water,riverIds:model.rivers.map(r=>r.id),pointOrder:'downstream_to_upstream'});
test('runtime loads the actual chosen A source and annotations with five unchanged levels',()=>{
 assert.equal(model.levels.length,5);assert.equal(model.rivers.length,40);assert.equal(regions.tiles.length,2);
 assert.equal(model.rivers[0].outletM3PerSecond,model.water.accounting.outletM3PerSecond);
 assert.deepEqual(model.levels.at(-1).elevation,JSON.parse(inputs().candidateText).elevation);
});
test('runtime rejects detached/tampered pyramid and water sources',async()=>{
 const x=inputs();x.candidateText+=' ';await assert.rejects(prepareShapeFirstModel(x),/pyramid source hash/);
 for(const kind of ['height','rivers']){const x=inputs();x.water.preservation.after[kind]='bad';await assert.rejects(prepareShapeFirstModel(x),/source hash/);}
 const y=inputs();y.pyramid.levels[2].elevation[50]+=1;await assert.rejects(prepareShapeFirstModel(y),/preserve source nodes/);
 const z=inputs();z.water.rivers[0].segmentFlowM3PerSecond[0]=Infinity;await assert.rejects(prepareShapeFirstModel(z),/segment flow/);
});
test('runtime rejects malformed display contracts',async()=>{
 for(const mutate of [x=>x.pyramid.levels[0].grid.yDirection='north',x=>x.pyramid.extent.widthM=0,x=>x.water.rivers[1].id=x.water.rivers[0].id,x=>x.water.rivers[0].segmentLineWeightPx[0]=NaN,x=>x.pyramid.riverConcept.rivers[0][0].xM-=10]){
 const x=inputs();mutate(x);await assert.rejects(prepareShapeFirstModel(x));
 }
 await assert.rejects(sha256Text('source',{}),/unavailable/);
});
test('bilinear sampler is exact at nodes and clamps to a finite boundary',()=>{
 const l=model.levels.at(-1),g=l.grid;
 for(let y=0;y<g.rows;y+=16)for(let x=0;x<g.columns;x+=16)assert(Math.abs(sampleShapeHeight(l,x*g.cellSizeM,y*g.cellSizeYM)-l.elevation[y*g.columns+x])<1e-10);
 assert.equal(sampleShapeHeight(l,-1,-1),l.elevation[0]);assert.equal(sampleShapeHeight(l,1e9,1e9),l.elevation.at(-1));
});
test('LOD adapts to zoom but stops at native resolution',()=>{
 assert.equal(shapeLevelForScale(model.levels,.001),0);assert.equal(shapeLevelForScale(model.levels,10),4);
 const choices=[.001,.01,.03,.1,1].map(scale=>shapeLevelForScale(model.levels,scale));assert.deepEqual(choices,[...choices].sort());
 assert.equal(shapeLevelForScale(model.levels,NaN),0);
});
test('pan/zoom coordinates round trip and river selection reports the right segment',()=>{
 const view=shapeViewport(model.extent,1000,800,3,{xM:1000,yM:2000});
 const point=shapePointAt(view,500,400);assert(Math.abs(point.xM-1000)<1e-9);assert.equal(point.yM,2000);
 const r=model.rivers[0],a=r.points[20],b=r.points[21],p={xM:(a.xM+b.xM)/2,yM:(a.yM+b.yM)/2};
 const found=nearestShapeRiver(model.rivers,p,1);assert.equal(found.river.id,r.id);assert.equal(found.segment,20);
 assert.equal(nearestShapeRiver(model.rivers,{xM:-1e6,yM:-1e6},1),null);
});
test('actual runtime raster is deterministic, finite, level-sensitive and source-preserving',()=>{
 const source=JSON.stringify(model.candidate),a=shapeFirstRaster(model,regions.tiles[0],4,{maxDimension:64}),b=shapeFirstRaster(model,regions.tiles[0],4,{maxDimension:64}),c=shapeFirstRaster(model,regions.tiles[0],0,{maxDimension:64});
 assert.equal(a.width,32);assert.equal(a.height,64);assert.equal(a.data.length,32*64*4);assert.deepEqual(a,b);assert.notDeepEqual(a.data,c.data);
 assert(a.data.every((value,i)=>i%4!==3||value===255));assert.equal(JSON.stringify(model.candidate),source);
 assert.throws(()=>shapeFirstRaster(model,regions.tiles[0],9),/Unknown/);assert.throws(()=>shapeFirstRaster(model,regions.tiles[0],4,{maxDimension:1}),/dimension/);
});
test('entry point offers shape mode without replacing saved-world runtime',()=>{
 assert.match(read('src/globe/index.html'),/viewer-entry.mjs/);const entry=read('src/globe/viewer-entry.mjs');
 assert.match(entry,/mode === 'shape-first-inspect'/);assert.match(entry,/import\('\.\/app.mjs/);
 assert.match(read('src/ui/index.html'),/index.html\?terrain=shape-first/);
});

test('runtime rejects tampered water arithmetic and cyclic parent labels',async()=>{
 for(const mutate of [x=>{x.water.accounting.outletM3PerSecond=999999;x.water.accounting.runoffM3PerSecond=999999;},x=>x.water.rivers[0].parent=x.water.rivers[0].id,x=>x.water.rivers[0].outletM3PerSecond*=2,x=>x.water.rivers[0].assignedAreaM2*=2]){
 const x=inputs();mutate(x);await assert.rejects(prepareShapeFirstModel(x));
 }
});

test('shared source controls preserve selected view and safely round-trip seeds',async()=>{
 const {shapeSourceURL}=await import('../src/globe/shape-first-controls.mjs');
 const href='https://example.com/src/globe/index.html?terrain=shape-first&world=custom.json';
 const next=new URL(shapeSourceURL(href,'山&river=2'));assert.equal(next.searchParams.get('sfSeed'),'山&river=2');assert.equal(next.searchParams.get('terrain'),'shape-first');assert.equal(next.searchParams.get('world'),'custom.json');
 assert.equal(new URL(shapeSourceURL(next.href,null)).searchParams.has('sfSeed'),false);
 for(const seed of ['', ' ', 'x'.repeat(129)])assert.throws(()=>shapeSourceURL(href,seed));
});

test('shared loader produces validated deterministic multi-seed native shapes',async()=>{
 const {loadShapeFirstModel}=await import('../src/globe/shape-first-loader.mjs');
 const a=await loadShapeFirstModel({seed:'runtime-001'}),b=await loadShapeFirstModel({seed:'runtime-001'}),c=await loadShapeFirstModel({seed:'runtime-002'});
 assert.equal(a.pyramid.provenance.sourceSha256,b.pyramid.provenance.sourceSha256);assert.notEqual(a.pyramid.provenance.sourceSha256,c.pyramid.provenance.sourceSha256);
 assert.equal(a.levels.length,5);assert(a.rivers.length>1);assert.equal(a.pointOrder,'downstream_to_upstream');
 const tiles=createShapeFirstRegions(a.candidate,{waterAnnotation:a.water,riverIds:a.rivers.map(r=>r.id),pointOrder:a.pointOrder});assert.equal(tiles.tiles.length,2);
 const controller=new AbortController();controller.abort();await assert.rejects(loadShapeFirstModel({seed:'cancelled',signal:controller.signal}),/Aborted/);
});

test('draft records persist exact data, round-trip and refuse same-seed conflicts',async()=>{
 const {generateShapeFirstBundle}=await import('../src/globe/shape-first-generated.mjs');
 const {makeShapeFirstDraft,readShapeFirstDraft,saveShapeFirstDraft,exportShapeFirstDraft,importShapeFirstDraft}=await import('../src/globe/shape-first-drafts.mjs');
 const records=new Map(),store={read:async seed=>records.get(seed)??null,keepFirst:async record=>{if(!records.has(record.seed))records.set(record.seed,structuredClone(record));return records.get(record.seed);}};
 const seed='persisted-runtime',bundle=generateShapeFirstBundle(seed),record=makeShapeFirstDraft(seed,bundle),saved=await saveShapeFirstDraft(record,{store});assert.equal(saved.persistent,true);
 const loaded=await readShapeFirstDraft(seed,{store});assert.deepEqual(loaded.record.bundle,bundle);
 const text=await exportShapeFirstDraft(seed,{store}),restored=await importShapeFirstDraft(text,{store});assert.deepEqual(restored,record);
 const freshStore={keepFirst:async x=>x};assert.deepEqual(await importShapeFirstDraft(text,{store:freshStore}),record);
 const conflict=structuredClone(record);conflict.sourceSha256='different';const conflictStore={keepFirst:async()=>conflict};await assert.rejects(importShapeFirstDraft(text,{store:conflictStore}),/識別子/);
 const broken=structuredClone(record);broken.bundle.pyramid.levels[0].elevation[0]+=1;await assert.rejects(saveShapeFirstDraft(record,{store:{keepFirst:async()=>broken}}),/source nodes/);
 const rejected=await saveShapeFirstDraft(record,{store:{keepFirst:async()=>{throw new Error('quota');}}});assert.equal(rejected.persistent,false);assert.equal(rejected.warning,'quota');
 await assert.rejects(importShapeFirstDraft(text,{store:{keepFirst:async()=>{throw new Error('quota');}}}),/quota/);
});

test('draft export/import preserves selected world and exact geographic placement',async()=>{
 const {captureShapeFirstView,restoreShapeFirstView,validateShapeFirstView}=await import('../src/globe/shape-first-placement.mjs');
 const href='https://planet.test/src/globe/index.html?terrain=shape-first&sfSeed=chosen&world=/examples/planet/custom/manifest.json&sfLat=35.5&sfLon=-125.25&sfElevation=32.75&sfTransition=5000&sfParentWorld=sha256:abc&sfView=global&sfChannelVersion=shape-first-designed-channels@2&sfRuntimeVersion=shape-first-sphere@2&sfOutletIdentity=sha256:receiver-and-route&sfSymbols=off';
 const view=captureShapeFirstView(href),next=new URL(restoreShapeFirstView('https://other.test/src/globe/index.html?terrain=shape-first-inspect',{seed:'chosen',view}));
 assert.equal(next.origin,'https://other.test');assert.equal(next.searchParams.get('world'),'/examples/planet/custom/manifest.json');assert.equal(next.searchParams.get('sfLat'),'35.5');assert.equal(next.searchParams.get('sfLon'),'-125.25');assert.equal(next.searchParams.get('sfElevation'),'32.75');assert.equal(next.searchParams.get('sfParentWorld'),'sha256:abc');assert.equal(next.searchParams.get('terrain'),'shape-first');assert.equal(next.searchParams.get('sfChannelVersion'),'shape-first-designed-channels@2');assert.equal(next.searchParams.get('sfRuntimeVersion'),'shape-first-sphere@2');assert.equal(next.searchParams.get('sfOutletIdentity'),'sha256:receiver-and-route');assert.equal(next.searchParams.get('sfSymbols'),'off');
 assert.throws(()=>captureShapeFirstView('https://planet.test/src/globe/index.html?world=https://external.test/world.json'),/外部サイト/);
 for(const patch of [{world:'//outside.test/world.json'},{sfLat:100},{sfElevation:Infinity},{terrain:'arbitrary'},{sfChannelVersion:'shape-first-designed-channels@1'},{sfRuntimeVersion:'shape-first-sphere@1'},{sfSymbols:'arbitrary'},{sfOutletIdentity:undefined}])assert.throws(()=>validateShapeFirstView({...view,...patch}));
});


test('source changes clear derived outlet/datum while same-source reload and archive restore retain pins',async()=>{
 const {shapeSourceURL}=await import('../src/globe/shape-first-controls.mjs');
 const href='https://planet.test/src/globe/index.html?terrain=shape-first&sfSeed=original&sfLat=35&sfLon=135&sfTransition=4000&sfElevation=400&sfOutletIdentity=sha256:old&sfRuntimeVersion=shape-first-sphere@2&sfChannelVersion=shape-first-designed-channels@2&sfParentWorld=sha256:parent';
 for(const seed of ['other',null]){const next=new URL(shapeSourceURL(href,seed));assert.equal(next.searchParams.has('sfOutletIdentity'),false);assert.equal(next.searchParams.has('sfElevation'),false);assert.equal(next.searchParams.get('sfLat'),'35');assert.equal(next.searchParams.get('sfRuntimeVersion'),'shape-first-sphere@2');assert.equal(next.searchParams.get('sfParentWorld'),'sha256:parent');}
 const same=new URL(shapeSourceURL(href,'original'));assert.equal(same.searchParams.get('sfElevation'),'400');assert.equal(same.searchParams.get('sfOutletIdentity'),'sha256:old');
 const {captureShapeFirstView,restoreShapeFirstView}=await import('../src/globe/shape-first-placement.mjs');
 const restored=new URL(restoreShapeFirstView('https://planet.test/src/globe/index.html?sfSeed=other',{seed:'original',view:captureShapeFirstView(href)}));assert.equal(restored.searchParams.get('sfElevation'),'400');assert.equal(restored.searchParams.get('sfOutletIdentity'),'sha256:old');
});


test('explicit saved-world switching drops stale shape constraints and retains renderer preferences',async()=>{
 const {worldCatalogEntries,ordinaryGlobeURL}=await import('../src/globe/world-link.mjs');
 const page='https://planet.test/src/globe/index.html?terrain=shape-first&sfSeed=old&sfParentWorld=old-parent&sfChannelVersion=old-model&sfOutletIdentity=old-route&sfElevation=500&sfAltitude=1000&river=shape-receiver&renderer=software&meshBudgetMiB=64&benchmark=1&duration=10';
 const catalog={schema:'planet-example-catalog@1',worlds:[{id:'other',name:'Other',worldId:'new-parent',manifest:'other/manifest.json'}]};
 const entry=worldCatalogEntries(catalog,'https://planet.test/examples/planet/catalog.json',page)[0],next=new URL(entry.url);
 assert.equal(next.searchParams.get('world'),'/examples/planet/other/manifest.json');assert.equal(next.searchParams.has('terrain'),false);assert([...next.searchParams.keys()].every(k=>!k.startsWith('sf')));assert.equal(next.searchParams.has('river'),false);assert.equal(next.searchParams.get('renderer'),'software');assert.equal(next.searchParams.get('meshBudgetMiB'),'64');assert.equal(next.searchParams.has('benchmark'),false);
 const back=new URL(ordinaryGlobeURL(page));assert.equal(back.searchParams.has('sfParentWorld'),false);assert.equal(back.searchParams.get('renderer'),'software');
});

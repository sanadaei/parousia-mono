import test from'node:test';import assert from'node:assert/strict';
import{worldExperimentLink,worldSnapshotRequest}from'../src/globe/world-link.mjs';
test('returning from a runoff experiment stays on the immutable generation, not the mutable entry manifest',()=>{
 const manifest={planetSnapshot:'worlds/abc/world.snapshot.json',generationManifest:'worlds/abc/manifest.json',canonicalWorldId:'sha256:one'},base='http://localhost:3000/examples/planet/generated/manifest.json';
 const link=worldExperimentLink('runoff.html',manifest,base,'http://localhost:3000/src/globe/index.html?renderer=software','village');
 const request=worldSnapshotRequest(link),back=new URL(request.globeURL);
 assert.equal(back.searchParams.get('world'),'/examples/planet/generated/worlds/abc/manifest.json');
 assert.equal(request.url,'http://localhost:3000/examples/planet/generated/worlds/abc/world.snapshot.json');assert.equal(request.expectedWorldId,'sha256:one');
 assert.throws(()=>worldExperimentLink('runoff.html',{...manifest,generationManifest:'https://elsewhere.test/map.json'},base,'http://localhost:3000/src/globe/index.html','village'),/origin/);
});
import{worldCatalogEntries}from'../src/globe/world-link.mjs';
test('world selection exposes saved examples without starting a benchmark or crossing origins',()=>{
 const catalog={schema:'planet-example-catalog@1',worlds:[{id:'dry',name:'低水位',worldId:'one',manifest:'./terminal/manifest.json'}]},source='http://localhost/examples/planet/catalog.json',page='http://localhost/src/globe/index.html?renderer=software&benchmark=auto';
 const [entry]=worldCatalogEntries(catalog,source,page),url=new URL(entry.url);
 assert.equal(url.searchParams.get('world'),'/examples/planet/terminal/manifest.json');assert.equal(url.searchParams.get('renderer'),'software');assert.equal(url.searchParams.has('benchmark'),false);
 assert.throws(()=>worldCatalogEntries({...catalog,worlds:[...catalog.worlds,...catalog.worlds]},source,page),/entry/);
 assert.throws(()=>worldCatalogEntries({...catalog,worlds:[{...catalog.worlds[0],manifest:'https://other.test/a'}]},source,page),/origin/);
});
test('worlds explicitly containing no settlements do not offer broken settlement experiments',()=>{
 for(const fields of[{settlements:[]},{generationDiagnostics:{generatedSettlements:0}}])assert.equal(worldExperimentLink('runoff.html',{planetSnapshot:'./world.snapshot.json',...fields},'http://localhost/manifest.json','http://localhost/src/globe/index.html'),null);
});

import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{pathToFileURL}from'node:url';
import{restoreGlobalTerrain,restoreProjectedTerrainView}from'../src/core/global-terrain.mjs';import{restoreTerrain}from'../src/core/index.mjs';
const directory=process.argv[2];if(!directory)throw new Error('Pass an independently verified baseline checkout path');
const previous=await import(pathToFileURL(path.resolve(directory,'src/core/global-terrain.mjs'))),previousFinite=await import(pathToFileURL(path.resolve(directory,'src/core/index.mjs')));
const reference=JSON.parse(fs.readFileSync('examples/handoff/2026-10-10/verification.json')),results=[];
for(const entry of reference.restored.slice(0,40)){
 const snapshot=JSON.parse(fs.readFileSync(entry.file)),witness=JSON.parse(fs.readFileSync(entry.file.replace('.snapshot.json','.witnesses.json')));let comparisons=0,maxSavedNumericDifference=0,savedNumericDifferences=0;
 function differences(actual,expected){if(typeof actual==='number'&&typeof expected==='number'){if(actual!==expected){savedNumericDifferences++;maxSavedNumericDifference=Math.max(maxSavedNumericDifference,Math.abs(actual-expected));}return;}
 if(actual&&expected&&typeof actual==='object'&&typeof expected==='object'){assert.deepEqual(Object.keys(actual).sort(),Object.keys(expected).sort());for(const k of Object.keys(actual))differences(actual[k],expected[k]);}else assert.deepEqual(actual,expected);}
 const compare=(a,b,expected)=>{assert.deepEqual(a,b,'Current implementation diverged from untouched baseline');comparisons++;differences(a,expected);};
 if(snapshot.schema.startsWith('minimal-world-global-')){
 const a=restoreGlobalTerrain(snapshot),b=previous.restoreGlobalTerrain(snapshot);assert.equal(a.worldId,entry.worldId);
 for(const p of witness.globalSamples??[])compare(a.sampleAt(p.latDeg,p.lonDeg),b.sampleAt(p.latDeg,p.lonDeg),p);
 for(const r of witness.regions??[]){const contract={...r.contract,world:snapshot},x=restoreProjectedTerrainView(contract),y=previous.restoreProjectedTerrainView(contract);for(const p of r.frames??[])compare(x.surfaceFrameAt(p.xM,p.yM),y.surfaceFrameAt(p.xM,p.yM),p);}
 }else{
 const a=restoreTerrain(snapshot),b=previousFinite.restoreTerrain(snapshot);assert.equal(a.worldId,entry.worldId);
 if(witness.frames)for(const p of witness.frames)compare(a.surfaceFrameAt(p.xM,p.yM),b.surfaceFrameAt(p.xM,p.yM),p);
 for(const p of(Array.isArray(witness)?witness:witness.samples??[]))compare(a.sampleAt(p.xM,p.yM),b.sampleAt(p.xM,p.yM),p);
 }
 assert.ok(comparisons>0,entry.file);results.push({file:entry.file,worldId:entry.worldId,comparisons,baselineExact:true,savedNumericDifferences,maxSavedNumericDifference});
}
const report={schema:'planet-baseline-comparison@1',node:process.version,baselineCommit:'69bb357d5bc95ef7c12e90dcc4cec59d5a9a851c',createdAt:new Date().toISOString(),status:'pass-against-baseline-same-runtime',scope:'saved samples and surface frames; not the separate-process complete legacy witness gate',results};fs.writeFileSync('examples/planet/verification/baseline-comparison.json',JSON.stringify(report,null,2));console.log(JSON.stringify({worlds:results.length,comparisons:results.reduce((s,r)=>s+r.comparisons,0),maxSavedNumericDifference:Math.max(...results.map(r=>r.maxSavedNumericDifference))}));

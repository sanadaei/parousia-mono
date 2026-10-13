import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrainageEnvelope } from '../scripts/experiments/drainage-envelope.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {restoreTerrain} from '../src/core/index.mjs';
const input=()=>({nodes:[{id:'up',xM:0,yM:100,heightM:10},{id:'out',xM:0,yM:0,heightM:0}],edges:[{from:'up',to:'out'}],crossSlope:.5});
test('explicit skeleton produces a shared valley field with stable order and owned inputs',()=>{
 const q=input(),a=createDrainageEnvelope(q),b=createDrainageEnvelope({...q,nodes:q.nodes.slice().reverse()});
 assert.equal(a.id,b.id);assert.equal(a.heightAt(0,0),0);assert.equal(a.heightAt(0,100),10);
 assert.ok(Math.abs(a.heightAt(0,50)-5)<1e-12);assert.ok(a.heightAt(20,50)>a.heightAt(0,50));
 const before=a.heightAt(20,50);q.nodes[0].heightM=100;a.contract.nodes[0].heightM=999;
 assert.equal(a.heightAt(20,50),before);assert.equal(a.diagnostics.compatibleAtSampledPoints,true);
});
test('overlapping queries use the same geometry, not camera-dependent regeneration',()=>{
 const a=createDrainageEnvelope(input()),small=a.sampleGrid({n:5,extentM:100}),large=a.sampleGrid({n:9,extentM:200});
 for(let y=0;y<5;y++)for(let x=0;x<5;x++)assert.equal(small[y*5+x],large[y*9+x]);
 assert.throws(()=>a.sampleGrid({n:1000,extentM:100}),/budget/);
});
test('invalid topology and incompatible slopes are refused; conflicts remain visible',()=>{
 const q=input();assert.throws(()=>createDrainageEnvelope({...q,crossSlope:.01}),/grade/);
 assert.throws(()=>createDrainageEnvelope({...q,edges:[{from:'out',to:'up'}]}),/downstream/);
 const flat={nodes:q.nodes.map(p=>({...p,heightM:0})),edges:[{from:'up',to:'out'},{from:'out',to:'up'}],crossSlope:1};
 assert.throws(()=>createDrainageEnvelope(flat),/cycle/);
 const conflict={...q,nodes:[...q.nodes,{id:'near-up',xM:1,yM:100,heightM:-20},{id:'near-out',xM:1,yM:0,heightM:-30}],edges:[...q.edges,{from:'near-up',to:'near-out'}]};
 assert.equal(createDrainageEnvelope(conflict).diagnostics.compatibleAtSampledPoints,false);
 assert.throws(()=>createDrainageEnvelope({...q,nodes:[...q.nodes,{id:'alone',xM:100,yM:100,heightM:5}]}),/Isolated/);
});
test('shared skeleton CLI retains actual input, outlets and canonical output without overwriting',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'drainage-envelope-'));
 try {
  const file=path.join(dir,'source.json'),output=path.join(dir,'output');
  const source={skeleton:input(),grid:{n:5,extentM:100},forcing:{steps:2,dtYears:100,erodibility:.0001,upliftMPerYear:.001}};
  fs.writeFileSync(file,JSON.stringify(source));
  const run=()=>spawnSync(process.execPath,['--max-old-space-size=128',fileURLToPath(new URL('../scripts/experiments/run-drainage-relief.mjs',import.meta.url)),file,output],{encoding:'utf8',timeout:15000});
  const first=run();assert.equal(first.status,0,first.stderr);
  const saved=fs.readFileSync(path.join(output,'terrain.json'),'utf8'),terrain=restoreTerrain(saved);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'input.json'),'utf8')),source);
  assert.deepEqual(terrain.toSnapshot().references.reliefResearch.parameters.outlets,[0]);
  assert.equal(terrain.toSnapshot().references.reliefResearch.initialSkeleton.id,createDrainageEnvelope(source.skeleton).id);
  const report=JSON.parse(fs.readFileSync(path.join(output,'report.json'),'utf8'));
  assert.equal(report.surfaceDrainage.strictGroundCatchments.schema,'sampled-d8-catchments@1');
  assert.equal(report.surfaceDrainage.strictGroundCatchments.diagnostics.cells,25);
  assert.equal(terrain.toSnapshot().fields.waterLevelElevationM,null);
  assert.notEqual(run().status,0);assert.equal(fs.readFileSync(path.join(output,'terrain.json'),'utf8'),saved);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

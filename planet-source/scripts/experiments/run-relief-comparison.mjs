import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {generatePlanet} from '../../src/core/planet-generation.mjs';
import {requireVerificationMemory} from '../verification-runtime.mjs';
import {createExperiment,auditExperiment,smoothReconstruction,reliefSvg} from './drainage-led-relief.mjs';
import {extractParent} from './planet-parent-relief.mjs';
import {solveSteady,correctDiscontinuities} from './steady-stream-power.mjs';
requireVerificationMemory();
const out=process.argv[2]||'/tmp/planet-relief-comparison';mkdirSync(out,{recursive:true});
const source=generatePlanet({settlementCount:0}),snapshot=source.base.toSnapshot(),input=extractParent(snapshot),model=createExperiment({seed:`${snapshot.worldId}/${input.source.profileId}`,parent:input.parent}),raw=auditExperiment(model),smooth=smoothReconstruction(model),heights=[],oldHeights=[];
let edgeMaximumChangeM=0,maxChangeM=0,squaredChange=0,bedErrorM=0;
for(let y=0;y<129;y++)for(let x=0;x<129;x++) {
 const xm=x*64,ym=y*64,p=input.projection.toGeographic(xm-4096,ym-4096),old=source.base.groundElevationAt(p.latDeg,p.lonDeg),z=smooth.sample(xm,ym),d=z-old;
 heights.push(z);oldHeights.push(old);maxChangeM=Math.max(maxChangeM,Math.abs(d));squaredChange+=d*d;if(x===0||y===0||x===128||y===128)edgeMaximumChangeM=Math.max(edgeMaximumChangeM,Math.abs(d));
}
for(const s of model.segments)for(let k=0;k<=64;k++){const t=k/64,z=smooth.sample(s.a.x+(s.b.x-s.a.x)*t,s.a.y+(s.b.y-s.a.y)*t);bedErrorM=Math.max(bedErrorM,Math.abs(z-s.a.z-(s.b.z-s.a.z)*t));}
const t=performance.now(),steady=solveSteady({initial:oldHeights}),corrected=correctDiscontinuities(steady),runtimeMs=performance.now()-t;
const scriptHashes=Object.fromEntries(['drainage-led-relief.mjs','planet-parent-relief.mjs','steady-stream-power.mjs','run-relief-comparison.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL(f,import.meta.url))).digest('hex')]));
const report={status:'UNADOPTED RESEARCH COMPARISON',source:input.source,scriptHashes,graph:raw.report,reconstruction:{bedErrorM,maxChangeM,rmsChangeM:Math.sqrt(squaredChange/heights.length),edgeMaximumChangeM,primitiveCount:smooth.cache.size},steady:steady.report,corrected:corrected.report,steadyAndCorrectionRuntimeMs:runtimeMs,decision:'Neither candidate passes production acceptance. The graph preserves sampled parent beds but does not join regional edges; the numerical candidate fixes edge heights but changes internal drainage and retains visible grid artifacts. The actual viewer, water, saved worlds and production evaluator remain unchanged.'};
writeFileSync(`${out}/report.json`,JSON.stringify(report,null,2));writeFileSync(`${out}/fields.json`,JSON.stringify({oldHeights,graphHeights:heights,steadyHeights:[...steady.heights],correctedHeights:[...corrected.heights],segments:model.segments}));
for(const [name,z,segments] of [['existing',oldHeights,[]],['graph',heights,model.segments],['steady',steady.heights,[]],['corrected',corrected.heights,[]]])writeFileSync(`${out}/${name}.svg`,reliefSvg({...model,segments},{heights:z}));
console.log(JSON.stringify(report,null,2));

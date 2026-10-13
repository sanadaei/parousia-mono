/** Repeatable multi-site comparison. Dry valleys are not published rivers. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {generatePlanet} from '../../src/core/planet-generation.mjs';
import {createGlobalTerrain} from '../../src/core/global-terrain.mjs';
import {requireVerificationMemory} from '../verification-runtime.mjs';
import {extractParent} from './planet-parent-relief.mjs';
import {createExperiment,reliefSvg} from './drainage-led-relief.mjs';
import {fitConstrainedValleys,auditConstrained} from './constrained-valley-relief.mjs';
requireVerificationMemory();
const out=process.argv[2]||'/tmp/planet-constrained-comparison';mkdirSync(out,{recursive:true});
const snapshot=generatePlanet({settlementCount:0}).base.toSnapshot(),base=createGlobalTerrain(snapshot),reports=[];
for(const profileId of ['river:2156:2285','river:3670:3541','river:3552:3424','river:3926:3798']){
 const input=extractParent(snapshot,{profileId}),graph=createExperiment({seed:`${snapshot.worldId}/${profileId}`,parent:input.parent});
 const groundAt=(x,y)=>{const p=input.projection.toGeographic(x-4096,y-4096);return base.groundElevationAt(p.latDeg,p.lonDeg);};
 const start=performance.now(),model=fitConstrainedValleys({graph,groundAt}),audit=auditConstrained(model,graph);
 const reasons={};for(const r of model.rejected)reasons[r.reason]=(reasons[r.reason]??0)+1;
 const report={source:input.source,...audit.report,rejected:reasons,originalReliefM:Math.max(...audit.oldHeights)-Math.min(...audit.oldHeights),runtimeMs:performance.now()-start,status:model.curves.length?'UNADOPTED: constrained dry valley prototype':'NO-OP: no admissible valleys; not an acceptance pass'};
 reports.push(report);
 const segments=model.curves.flatMap(c=>c.points.slice(1).map((b,i)=>({a:c.points[i],b,level:c.level}))),name=profileId.replaceAll(':','-');
 writeFileSync(`${out}/${name}.json`,JSON.stringify({heights:audit.heights,oldHeights:audit.oldHeights,segments,report}));
 writeFileSync(`${out}/${name}.svg`,reliefSvg({...graph,segments},{heights:audit.heights}));
 console.log(JSON.stringify({profileId,acceptedValleys:report.acceptedValleys,edgeChangeM:report.edgeChangeM,corridorChangeM:report.corridorChangeM,connectorUphillSteps:report.connectorUphillSteps}));
}
const scriptHashes=Object.fromEntries(['constrained-valley-relief.mjs','planet-parent-relief.mjs','drainage-led-relief.mjs','run-constrained-comparison.mjs'].map(f=>[f,createHash('sha256').update(readFileSync(new URL(f,import.meta.url))).digest('hex')]));
writeFileSync(`${out}/report.json`,JSON.stringify({status:'UNADOPTED RESEARCH; PRODUCTION UNCHANGED',worldId:snapshot.worldId,scriptHashes,reports,decision:'The compact-support revision removes the observed boundary displacement and protects the existing river corridor. Some existing-bank connections require uphill travel and are rejected. Four selected sites in one seed are not planet-wide validation. No-op preservation is not generation success. The current straight hierarchical proposals are still too terrain-agnostic; no rainfall, natural lake generation, viewer integration, cross-region catchment solution or medieval settlement improvement is claimed.'},null,2));

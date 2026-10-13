import fs from 'node:fs';
import {createL0ResolutionSeries} from './l0-resolution-series.mjs';
import {createL1BroadRegion} from '../../src/core/l1-broad-region.mjs';
import {createRegionalWaterContext} from '../../src/core/regional-water-context.mjs';
import {solveRegionalDrainage} from '../../src/core/regional-drainage.mjs';
import {reconcileWaterCandidate} from '../../src/core/refine-water-candidates.mjs';
import {CommittedMaterializer} from '../../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from '../materialization-file-store.mjs';
import {buildSavedLayerHandoff} from './staged-layer-handoff.mjs';
import {hashJson} from '../../src/core/json-contract.mjs';
const [input,output,...flags]=process.argv.slice(2);if(!output)throw Error('Usage: review-generated-layer-handoff.mjs SAVED_L0.json OUTPUT_DIR [--reload]');
const reload=flags.includes('--reload');fs.mkdirSync(output,{recursive:true});
const l0=JSON.parse(fs.readFileSync(input)),store=new CommittedMaterializer(createFileMaterializationStorage(`${output}/save`));
// Persist bounded inputs independently. A fresh-process reload does not invoke
// global or local terrain generators at all.
const parent=await store.resolve({worldId:l0.snapshot.worldId,entityId:'generated-handoff/L1-sampled-parent',conditions:{l0WorldId:l0.snapshot.worldId,l0ClimateId:l0.climate.id,method:'L1-bilinear-context@1'},generator:'L1-bilinear-context@1',generate:()=>{
 if(reload)throw Error('Reload cannot reconstruct source layers');
 const series=createL0ResolutionSeries(l0.snapshot,{levels:3}),l1=createL1BroadRegion(l0,series.cases[2]),s=l1.snapshot,c=l1.climate,w=s.grid.columns,h=s.grid.rows,R=s.frame.radiusM,rad=Math.PI/180;
 const cell=s.fields.groundElevationM.findIndex((z,i)=>{const y=Math.floor(i/w),lat=90-(y+.5)*180/h;return Math.abs(lat)<60&&z>400&&z<1000&&s.fields.landMask[i]&&!s.fields.lakeFillDepthM[i]&&[-w-1,-w,-w+1,-1,1,w-1,w,w+1].every(d=>s.fields.landMask[i+d]&&!s.fields.lakeFillDepthM[i+d]);});
 if(cell<0)throw Error('No bounded inland L1 demonstration location');
 const latDeg=90-(Math.floor(cell/w)+.5)*180/h,lonDeg=(cell%w+.5)*360/w;
 const grid={columns:13,rows:11,cellSizeM:480,cellSizeYM:600},elevation=[],supply=[];
 const sample=(a,lat,lon)=>{const xx=((lon%360+360)%360)/360*w-.5,yy=(90-lat)/180*h-.5,ix=Math.floor(xx),iy=Math.max(0,Math.min(h-2,Math.floor(yy))),u=xx-ix,v=Math.max(0,Math.min(1,yy-iy)),at=(x,y)=>a[(iy+y)*w+((ix+x)%w+w)%w];return at(0,0)*(1-u)*(1-v)+at(1,0)*u*(1-v)+at(0,1)*(1-u)*v+at(1,1)*u*v;};
 for(let y=0;y<grid.rows;y++)for(let x=0;x<grid.columns;x++){const lat=latDeg+(5-y)*600/R/rad,lon=lonDeg+(x-6)*480/(R*rad*Math.cos(latDeg*rad));elevation.push(sample(s.fields.groundElevationM,lat,lon));supply.push(Math.max(0,sample(c.catchmentWater.annualLocalYieldMm,lat,lon))/1000*480*600*(x===0||x===12?.5:1)*(y===0||y===10?.5:1));}
 const outlets=elevation.flatMap((z,i)=>i<13||i>=130||i%13===0||i%13===12?[{id:`unresolved-survey:${i}`,cell:i,kind:'open-boundary',levelM:z}]:[]);
 const geography={latDeg,lonDeg,latStepDeg:600/R/rad,lonStepDeg:480/(R*rad*Math.cos(latDeg*rad))};
 const context=createRegionalWaterContext({sourceWorldId:s.worldId,sourceLayerId:s.layerId,geography,grid,elevation,drainage:solveRegionalDrainage({...grid,elevation,retainSupplyOwnership:true,localSupplyM3PerYear:supply,outlets})});
 return {context,provenance:{sourceL0WorldId:s.worldId,sourceL0ClimateId:l0.climate.id,sourceL1LayerId:s.layerId,sourceL1ClimateId:c.id,l1SelectedCell:cell,geography,l0Grid:l0.snapshot.grid,l1Grid:s.grid,l0ToL1Stages:series.cases.map(q=>({id:q.id,columns:q.columns,rows:q.rows,spacingXM:R*2*Math.PI/q.columns*Math.cos(latDeg*rad),spacingYM:R*Math.PI/q.rows})),l1SourceSpacingM:{x:R*2*Math.PI/w*Math.cos(latDeg*rad),y:R*Math.PI/h},contextSpacingM:{x:480,y:600},initialJump:{kind:'Bilinear L1 terrain/climate sampling only; no intermediate physical detail or water boundary adoption',ratioX:R*2*Math.PI/w*Math.cos(latDeg*rad)/480,ratioY:R*Math.PI/h/600},hydrology:'Local L1-projected yield only; outer survey exits unresolved and no global imported flow'}};
}});
const refineWater=reload?()=>{throw Error('Reload cannot regenerate detail');}:(p,o)=>reconcileWaterCandidate(p,{...o,method:'provisional-boundary',boundaryState:'provisional'},{downstreamBudgetsStatus:'provisional',adoptedOutletBudgets:[]});
const windows=[{x0M:480,y0M:600,widthM:4800,heightM:2175,cellSizeM:150},{x0M:480,y0M:2775,widthM:4800,heightM:2175,cellSizeM:150}];
const result=await buildSavedLayerHandoff(store,parent.context,{entityId:'generated-handoff/L2-shared',refineWater,waterMethod:'provisional-boundary@1',waterOptions:{method:'provisional-boundary',boundaryState:'provisional'},windows});
const [a,b]=result.windows,ports=a.ports.filter(p=>p.boundarySides.includes('south'));
let anchorsExact=true,prior=parent.context;for(const stage of result.stages){const f=stage.surface.factor,w=stage.surface.grid.columns;for(let y=0;y<prior.grid.rows;y++)for(let x=0;x<prior.grid.columns;x++)anchorsExact&&=stage.surface.elevation[y*f*w+x*f]===prior.elevation[y*prior.grid.columns+x];prior=stage.water.context;}
const report={schema:'generated-layer-handoff-review@1',provenance:parent.provenance,contextId:result.context.id,contentHash:hashJson(result),stages:result.stages.map(s=>({grid:s.surface.grid,surface:s.surface.diagnostics,drainage:s.water.drainage.diagnostics,ledger:s.water.downstreamBudgetLedger})),anchorsExact,sharedHeightsExact:JSON.stringify(a.elevation.slice(-a.grid.columns))===JSON.stringify(b.elevation.slice(0,b.grid.columns)),sharedPorts:ports.length,allPortsMatch:ports.length>0&&ports.every(p=>b.ports.some(q=>q.id===p.id&&q.direction!==p.direction&&q.annualFlowM3===p.annualFlowM3&&q.parentProfileElevationM===p.parentProfileElevationM)),freshProcessReloadWithoutGenerators:reload,limits:['Terrain and projected climate connected to saved L1; imported global water remains unresolved','Initial coarse-to-regional scale jump remains explicit, not fixed by later factor2 stages','Views share one jointly solved persisted context; independent context adjacency not certified','Native120m morphology creates actual detail; no invented sub120m evidence','Point anchors preserved; parent cell means and sediment volume not conserved']};
if(!report.anchorsExact||!report.sharedHeightsExact||!report.allPortsMatch)throw Error('Layer handoff acceptance failed');
fs.writeFileSync(`${output}/${reload?'reload-report':'report'}.json`,JSON.stringify(report,null,2));if(!reload)fs.writeFileSync(`${output}/generated-handoff.json`,JSON.stringify({parent,...result}));console.log(JSON.stringify(report,null,2));

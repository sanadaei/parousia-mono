/** Explicit snapshot input; never generates or mutates a production world. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createGlobalTerrain} from '../../src/core/global-terrain.mjs';
import {auditRiverRouteTopology} from './river-route-topology.mjs';
import {selectResearchRiverRoute,compareResearchCorridorWidths} from './terrain-cost-routing.mjs';
const [input,output,...ids]=process.argv.slice(2);
if(!input||!output)throw new Error('Usage: node run-terrain-route-comparison.mjs snapshot.json report.json [profile IDs]');
const raw=readFileSync(input),saved=JSON.parse(raw),source=structuredClone(saved);
delete source.worldId;delete source.sourceWorldId;delete source.references.rivers;
const terrain=createGlobalTerrain(source),sampleSurface=(lat,lon)=>terrain.sampleSurfaceAt(lat,lon);
const selectedIds=ids.length?ids:['river:2156:2285','river:3552:3424','river:3670:3541'];
if(selectedIds.length>16)throw new RangeError('At most 16 profiles per research run');
const results=[];
for(const id of selectedIds){
 const profile=saved.references.rivers.profiles.find(p=>p.id===id);if(!profile)throw new Error('Missing actual profile '+id);
 const start=profile.points[0],end=profile.points.at(-1),options={sampleSurface,radiusM:saved.frame.radiusM,depthM:start.depthM,maxIncisionM:600,stepM:500,corridorStepM:3000};
 const r=selectResearchRiverRoute(start,end,options),widths=compareResearchCorridorWidths(start,end,options);
 const widthSensitivity={adoptionReady:false,searchBoundaryResolved:widths.searchBoundaryResolved,selectedInteriorWidthM:widths.selectedInterior?.halfWidthM??null,limitations:widths.limitations,attempts:widths.attempts.map(a=>({halfWidthM:a.halfWidthM,lateralSpacingM:a.lateralSpacingM,cells:a.result.search.cells,boundaryContactNodes:a.result.search.boundaryContactNodes,selected:a.result.selected?.kind??null,scoreM:a.result.selected?.fit.scoreM??null,topology:a.result.selected?auditRiverRouteTopology(saved.references.rivers,profile,a.result.selected.path):null}))};
 results.push({id,widthSensitivity,selected:r.selected?.kind??null,adoptionReady:r.adoptionReady,remainingChecks:r.remainingChecks,cells:r.search.cells,boundaryContactNodes:r.search.boundaryContactNodes,boundaryContactFraction:r.search.boundaryContactFraction,candidates:r.candidates.map(c=>({kind:c.kind,topology:auditRiverRouteTopology(saved.references.rivers,profile,c.path),...c.fit,points:c.fit.points?.length,pathPoints:c.path.length}))});
}
const report={kind:'unadopted-terrain-route-comparison@1',inputSha256:createHash('sha256').update(raw).digest('hex'),sourceFiles:['terrain-cost-routing.mjs','river-route-topology.mjs','run-terrain-route-comparison.mjs'].map(name=>({name,sha256:createHash('sha256').update(readFileSync(new URL(name,import.meta.url))).digest('hex')})),conditions:{profileStepM:500,corridorStepM:3000,maxIncisionM:600,incisionScaleM:30,halfWidthM:20000},results};
writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(results.map(r=>({id:r.id,selected:r.selected,adoptionReady:r.adoptionReady}))));

import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePlanet} from '../src/core/planet-generation.mjs';
import {snapshotPlanetWorld,restorePlanetWorld} from '../src/core/planet-world.mjs';
import {createPlanetRunoffScenario} from '../src/core/planet-runoff.mjs';
import {mapCulvertRouting,validateCulvertRouting} from '../src/core/culvert-routing.mjs';
import {stepRunoff} from '../src/core/runoff-dynamics.mjs';
let saved;
const snapshot=()=>saved??=snapshotPlanetWorld(generatePlanet());
test('generated drainage passages survive world save/restore and reach the actual runoff scenario',()=>{
 const s=snapshot(),w=restorePlanetWorld(s),r=w.recipes[0];
 assert.ok(r.drainageRouting.links.length>0);
 assert.deepEqual(w.toSnapshot(),s);
 const state=createPlanetRunoffScenario(w,{initialWater:'dry'});
 assert.ok(state.culverts.length>0);
 assert.equal(state.scenarioDiagnostics.drainage.savedLinks,r.drainageRouting.links.length);
 assert.equal(state.culverts.length+state.scenarioDiagnostics.drainage.unresolved.length,r.drainageRouting.links.length);
 const c=state.culverts[0],area=state.cellSizeM**2;
 state.waterVolumeM3[c.fromCell]=(Math.max(state.groundElevationM[c.toCell],c.invertM)+2-state.groundElevationM[c.fromCell])*area;
 assert.ok(state.waterVolumeM3[c.fromCell]>0);
 const next=stepRunoff(state,{seconds:10,conductanceM2PerSecond:0,boundaries:[]});
 assert.ok(next.diagnostics.culvertTransfers.some(f=>f.kind===c.id&&f.volumeM3>0));
 assert.ok(Math.abs(next.diagnostics.balanceErrorM3)<1e-8);
 assert.ok(next.waterVolumeM3.every(v=>v>=0));
 for(const transfer of next.diagnostics.culvertTransfers){const link=state.culverts.find(c=>c.id===transfer.kind);assert.ok(link.hydraulics);assert.ok(Number.isFinite(transfer.volumeM3));}
});
test('culvert mapping discloses outside, subcell, and structure-blocked endpoints',()=>{
 const c=snapshot().recipes[0].drainageRouting.links[0],routing={links:[c]},state={columns:2,rows:2,cellSizeM:10000,originXM:-5000,originYM:-5000};
 assert.equal(mapCulvertRouting(routing,state).unresolved[0].reason,'both-mouths-in-one-cell');
 assert.equal(mapCulvertRouting(routing,{...state,originXM:5000}).unresolved[0].reason,'mouth-outside-simulation');
 const normal={columns:140,rows:140,cellSizeM:5,originXM:-350,originYM:-350};
 assert.equal(mapCulvertRouting(routing,normal,{isSolid:()=>true}).unresolved[0].reason,'mouth-cell-occupied-by-structure');
 assert.equal(mapCulvertRouting(undefined,normal).links.length,0);
});
test('culvert contracts reject invalid references, duplicate IDs and fabricated capacities',()=>{
 const recipe=snapshot().recipes[0];
 for(const mutate of [r=>r.links[0].roadId='missing',r=>r.links.push(r.links[0]),r=>r.links[0].hydraulics.diameterM=-1,r=>r.links[0].upstream.xM=1000,r=>r.links[0].lengthM+=1,r=>r.coefficientBasis='physical-certification']){
  const r=structuredClone(recipe.drainageRouting);mutate(r);assert.throws(()=>validateCulvertRouting(r,recipe));
 }
 assert.doesNotThrow(()=>validateCulvertRouting(undefined,recipe));
});
test('closing saved passages changes routing only, not the generated world or initial terrain',()=>{
 const w=restorePlanetWorld(snapshot()),opened=createPlanetRunoffScenario(w),closed=createPlanetRunoffScenario(w,{includeDrainage:false});
 assert.ok(opened.culverts.length>0);assert.equal(closed.culverts.length,0);
 assert.deepEqual(opened.groundElevationM,closed.groundElevationM);assert.deepEqual(opened.waterVolumeM3,closed.waterVolumeM3);
 assert.equal(opened.sourceWorldId,closed.sourceWorldId);assert.equal(closed.scenarioDiagnostics.drainage.enabled,false);
});
test('old authored coefficient contracts retain their flow law and forbid hidden hydraulic overrides',()=>{
 const recipe=snapshot().recipes[0],routing=structuredClone(recipe.drainageRouting);
 routing.schema='culvert-reservoir-links@1';routing.coefficientBasis='authored-game-reservoir-ceiling; not hydraulic pipe sizing';
 for(const c of routing.links){delete c.hydraulics;c.capacityM3PerSecond=.2;c.conductanceM2PerSecond=.2;}
 assert.doesNotThrow(()=>validateCulvertRouting(routing,recipe));
 const grid={columns:140,rows:140,cellSizeM:5,originXM:-350,originYM:-350};
 const mapped=mapCulvertRouting(routing,grid);assert.ok(mapped.links.length);assert.equal(mapped.links[0].hydraulics,undefined);assert.equal(mapped.links[0].capacityM3PerSecond,.2);
 routing.links[0].hydraulics=snapshot().recipes[0].drainageRouting.links[0].hydraulics;
 assert.throws(()=>validateCulvertRouting(routing,recipe),/Legacy/);
});
test('explicit design flow selects saved diameters and reaches runoff after restoration',()=>{
 const culvertDesign={diametersM:[.2,.3,.4,.6,.8,1],safetyFactor:1.2,headCases:[{id:'authored-design-case',targetFlowM3PerSecond:.06,upstreamDepthM:.6,downstreamDepthM:.1}]};
 const generated=generatePlanet({settlementCount:1,culvertDesign}),s=snapshotPlanetWorld(generated),world=restorePlanetWorld(s),routing=world.recipes[0].drainageRouting;
 assert.equal(routing.schema,'culvert-reservoir-links@3');assert.ok(routing.links.length>0);assert.deepEqual(routing.designInput,culvertDesign);
 for(const c of routing.links){assert.equal(c.hydraulics.diameterM,c.design.selectedDiameterM);assert.equal(c.design.status,'sized-within-input-model');}
 const state=createPlanetRunoffScenario(world);assert.ok(state.culverts.length>0);
 for(const c of state.culverts)assert.equal(c.hydraulics.diameterM,routing.links.find(r=>r.id===c.id).design.selectedDiameterM);
 const rounded=structuredClone(routing);rounded.links[0].design.candidates[0].cases[0].availableFlowM3PerSecond+=Number.EPSILON;assert.doesNotThrow(()=>validateCulvertRouting(rounded,world.recipes[0]));
 rounded.links[0].design.candidates[0].cases[0].availableFlowM3PerSecond+=1e-6;assert.throws(()=>validateCulvertRouting(rounded,world.recipes[0]));
 const bad=structuredClone(routing);bad.links[0].hydraulics.diameterM+=.1;assert.throws(()=>validateCulvertRouting(bad,world.recipes[0]));
 assert.throws(()=>generatePlanet({settlementCount:0,culvertDesign:{headCases:[]}}));
});

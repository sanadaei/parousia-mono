import test from 'node:test';import assert from 'node:assert/strict';
import {auditL0} from '../scripts/audit-l0.mjs';
import {planRegionalDomains} from '../src/core/regional-domains.mjs';
import {generateClimate} from '../src/core/planet-climate.mjs';
const fixture=()=>auditL0('regional-plan-test',{columns:32,rows:16});
test('regional work domains cover parent land exactly once and conserve potential water',()=>{
 const {snapshot,climate}=fixture(),p=planRegionalDomains(snapshot,climate);
 assert.equal(p.diagnostics.assignedCells,p.diagnostics.landCells);assert.ok(p.diagnostics.maxRelativeBudgetResidual<1e-10);
 const cells=p.regions.flatMap(r=>r.cellIndices);assert.equal(new Set(cells).size,cells.length);
 for(let i=0;i<cells.length;i++)assert.equal(snapshot.fields.landMask[cells[i]],1);
 for(const port of p.ports){assert.ok(p.regions.find(r=>r.id===port.fromRegionId).outgoingPortIds.includes(port.id));if(port.toRegionId)assert.ok(p.regions.find(r=>r.id===port.toRegionId).incomingPortIds.includes(port.id));assert.equal(port.waterLevelM,null);}
});
test('climate forcing updates supply but does not move region ownership',()=>{
 const {snapshot,climate}=fixture(),a=planRegionalDomains(snapshot,climate),b=planRegionalDomains(snapshot,generateClimate(snapshot,{precipitationScale:.1}));
 assert.equal(a.geometryId,b.geometryId);assert.deepEqual(a.regionIndexByCell,b.regionIndexByCell);assert.deepEqual(a.contacts,b.contacts);assert.notEqual(a.id,b.id);
 assert.ok(b.regions.reduce((s,r)=>s+r.localPotentialYieldM3PerYear,0)<a.regions.reduce((s,r)=>s+r.localPotentialYieldM3PerYear,0));
});
test('serialization and repeat planning preserve decisions without changing parent',()=>{
 const {snapshot,climate}=fixture(),before=JSON.stringify(snapshot),a=planRegionalDomains(snapshot,climate);
 assert.deepEqual(JSON.parse(JSON.stringify(a)),planRegionalDomains(snapshot,climate));assert.equal(JSON.stringify(snapshot),before);
});
test('small area budget reports unresolved oversized source cells rather than invented subdivisions',()=>{
 const {snapshot,climate}=fixture(),p=planRegionalDomains(snapshot,climate,{maxAreaKm2:1});assert.equal(p.regions.length,p.diagnostics.landCells);assert.equal(p.diagnostics.oversizedSourceCells,p.regions.length);
});
test('invalid budgets, climate identity and cyclic source drainage reject',()=>{
 const {snapshot,climate}=fixture();assert.throws(()=>planRegionalDomains(snapshot,climate,{maxAreaKm2:0}));assert.throws(()=>planRegionalDomains(snapshot,{...climate,sourceWorldId:'wrong'}));
 const bad=structuredClone(snapshot);bad.fields.downstream[0]=0;assert.throws(()=>planRegionalDomains(bad,climate));
 const w=snapshot.grid.columns;let i=snapshot.fields.landMask.findIndex((v,k)=>v&&k+1<w*snapshot.grid.rows&&k%w<w-1&&snapshot.fields.landMask[k+1]);assert.ok(i>=0);bad.fields.downstream=[...snapshot.fields.downstream];bad.fields.downstream[i]=i+1;bad.fields.downstream[i+1]=i;assert.throws(()=>planRegionalDomains(bad,climate),/Cyclic/);
});
test('coastal grouping retains separate exits, shared contacts and water budgets',()=>{
 const {snapshot,climate}=fixture(),a=planRegionalDomains(snapshot,climate,{maxAreaKm2:3000000,mergeCoastal:false}),b=planRegionalDomains(snapshot,climate,{maxAreaKm2:3000000,mergeCoastal:true});
 assert.ok(b.regions.length<=a.regions.length);assert.equal(b.ports.length,a.ports.length);
 assert.ok(b.diagnostics.maxRelativeBudgetResidual<1e-10);
 for(const contact of b.contacts){assert.equal(contact.regions.length,2);assert.notEqual(...contact.regions);for(const [i,j] of contact.cellFacePairs)assert.notEqual(b.regionIndexByCell[i],b.regionIndexByCell[j]);}
});
test('file persistence survives reopen and rejects silent replanning',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path'),{saveRegionalDomainPlan}=await import('../scripts/plan-regional-domains.mjs'),dir=await fs.mkdtemp(path.join(os.tmpdir(),'regional-plan-'));
 try{const {snapshot,climate}=fixture(),a=await saveRegionalDomainPlan(snapshot,climate,dir),b=await saveRegionalDomainPlan(snapshot,climate,dir);assert.deepEqual(a,b);await assert.rejects(()=>saveRegionalDomainPlan(snapshot,climate,dir,{maxAreaKm2:12345}),/migration/);}finally{await fs.rm(dir,{recursive:true,force:true});}
});

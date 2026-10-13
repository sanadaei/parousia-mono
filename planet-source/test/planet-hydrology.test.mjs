import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePlanetHydrology} from '../src/core/planet-hydrology.mjs';
import {createPlanetWaterSampler,SEA_LEVEL_SCHEMA} from '../src/core/sea-level.mjs';
const columns=8,rows=5;
const elevation=Array.from({length:40},(_,i)=>i<8?-10:10);
elevation[19]=2;elevation[20]=3;
test('priority flood creates an overflow lake with an acyclic outlet graph',()=>{
 const h=derivePlanetHydrology({elevation,columns,rows});assert.ok(h.lakes.length>0);assert.equal(h.lakes[0].spillLevelM,10);
 for(let i=0;i<40;i++){const seen=new Set();for(let at=i;at>=0;at=h.downstream[at]){assert.ok(!seen.has(at));seen.add(at);}}
 assert.deepEqual(h,derivePlanetHydrology({elevation,columns,rows}));
});
test('a prescribed low-fill lake is terminal, not an invented ocean or overflowing river',()=>{
 const h=derivePlanetHydrology({elevation,columns,rows,lakeFillFraction:.5});const lake=h.lakes[0];
 assert.equal(lake.kind,'terminal-lake');assert.ok(lake.levelElevationM<lake.spillLevelM);
 for(const i of lake.outletCellIndices)assert.equal(h.downstream[i],-1);
 const sea={schema:SEA_LEVEL_SCHEMA,id:'sea',levelElevationM:0,verticalDatum:'datum'};
 const sample=createPlanetWaterSampler(sea,h.lakes,{columns,rows});
 const i=lake.cells[0],lat=90-(Math.floor(i/columns)+.5)*180/rows,lon=(i%columns+.5)*360/columns;
 const s=sample(lat,lon,elevation[i]);assert.equal(s.surfaceKind,'terminal-lake');assert.deepEqual(s.waterSourceIds,[lake.id]);
 assert.equal(s.waterDepthM,lake.levelElevationM-elevation[i]);
 for(const j of lake.cells)assert.equal(h.lakeFillDepthM[j],Math.max(0,lake.levelElevationM-elevation[j]));
});
test('invalid lake cells, duplicate regions, and no ocean inputs reject',()=>{
 assert.throws(()=>derivePlanetHydrology({elevation:Array(40).fill(10),columns,rows}),/ocean/);
 assert.throws(()=>derivePlanetHydrology({elevation,columns,rows,lakeFillFraction:2}));
 const h=derivePlanetHydrology({elevation,columns,rows});assert.throws(()=>createPlanetWaterSampler(null,[h.lakes[0],h.lakes[0]],{columns,rows}));
});
test('lake membership follows source interpolation support; legacy snapshots retain their old halo',()=>{
 const lake={id:'isolated',levelElevationM:10,spillLevelM:10,cells:[19],kind:'overflow-lake'},sea={schema:SEA_LEVEL_SCHEMA,id:'sea',levelElevationM:0,verticalDatum:'datum'};
 const legacy=createPlanetWaterSampler(sea,[lake],{columns,rows}),current=createPlanetWaterSampler(sea,[{...lake,membershipMethod:'interpolation-support@1'}],{columns,rows});
 // Query lies in the old halo but outside the source-centre interpolation patches.
 const lat=90-(1.1)*180/rows,lon=2.1*360/columns;
 assert.equal(legacy(lat,lon,1).waterDepthM,9);assert.equal(current(lat,lon,1).waterDepthM,0);
 const centreLat=90-2.5*180/rows,centreLon=3.5*360/columns;assert.equal(current(centreLat,centreLon,2).waterDepthM,8);
 assert.throws(()=>createPlanetWaterSampler(sea,[{...lake,membershipMethod:'invented'}],{columns,rows}),/membership/);
});
test('exposed terminal-lake bed drains toward the remaining wet cells without exporting water',()=>{
 const z=Array.from({length:64},(_,i)=>i<8?-5:20);z[26]=2;z[27]=6;z[28]=12;z[35]=8;
 const h=derivePlanetHydrology({elevation:z,columns:8,rows:8,lakeFillFraction:.3});
 assert.ok(h.diagnostics.redirectedDryLakeCells>0);
 for(const lake of h.lakes){assert.equal(lake.outletCellIndices.length,0);assert.ok(lake.terminalSinkCellIndices.length>0);const members=new Set(lake.cells);
  for(const i of lake.cells){let at=i;const seen=new Set();while(h.downstream[at]>=0){assert.ok(!seen.has(at));seen.add(at);at=h.downstream[at];assert.ok(members.has(at));}assert.ok(lake.terminalSinkCellIndices.includes(at));assert.ok(z[at]<=lake.levelElevationM+1e-9);}
 }
 const sinks=h.downstream.flatMap((j,i)=>j<0?[i]:[]);assert.equal(sinks.reduce((sum,i)=>sum+h.runoffIndex[i],0),z.length,'unit runoff must be conserved across all terminal/ocean sinks');
});
test('fully dry terminal basins still have deterministic bottom sinks and no cycles',()=>{
 const h=derivePlanetHydrology({elevation,columns,rows,lakeFillFraction:0});for(const lake of h.lakes){assert.ok(lake.terminalSinkCellIndices.length>0);for(const i of lake.terminalSinkCellIndices)assert.equal(elevation[i],lake.levelElevationM);}
});

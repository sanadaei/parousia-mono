import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePlanetHydrology} from '../src/core/planet-hydrology.mjs';
const columns=16,rows=8;
const elevation=Array.from({length:columns*rows},(_,i)=>Math.floor(i/columns)*10-5);
function checkGraph(h){
 const n=h.downstream.length,incoming=Array(n).fill(0),queue=[],sum=Array(n).fill(1);
 for(const j of h.downstream)if(j>=0)incoming[j]++;
 for(let i=0;i<n;i++)if(!incoming[i])queue.push(i);
 for(let k=0;k<queue.length;k++){const i=queue[k],j=h.downstream[i];if(j>=0){sum[j]+=sum[i];if(!--incoming[j])queue.push(j);}}
 assert.equal(queue.length,n);assert.deepEqual(h.runoffIndex,sum);
 assert.equal(sum.reduce((s,v,i)=>s+(h.downstream[i]<0?v:0),0),n);
}
test('routing mode retains historical results when omitted',()=>{
 assert.deepEqual(derivePlanetHydrology({elevation,columns,rows}),derivePlanetHydrology({elevation,columns,rows,routingMode:'flood-tree'}));
 assert.throws(()=>derivePlanetHydrology({elevation,columns,rows,routingMode:'unknown'}),/routing/);
});
test('uniform north-facing slope uses northward steepest receiver instead of flood visitation diagonal',()=>{
 const a=derivePlanetHydrology({elevation,columns,rows});
 const b=derivePlanetHydrology({elevation,columns,rows,routingMode:'steepest-filled'});
 for(let i=columns;i<elevation.length;i++)assert.equal(b.downstream[i],i-columns);
 assert.ok(a.downstream.some((v,i)=>i>=columns&&v!==b.downstream[i]));checkGraph(b);
});
test('steepest routing preserves full and terminal lake policies and conserved accumulation',()=>{
 const z=[...elevation];z[53]=-20;z[54]=-10;z[69]=-15;z[70]=-5;
 for(const lakeFillFraction of [0,.2,1]){
  const a=derivePlanetHydrology({elevation:z,columns,rows,lakeFillFraction});
  const b=derivePlanetHydrology({elevation:z,columns,rows,lakeFillFraction,routingMode:'steepest-filled'});
  assert.deepEqual(a.oceanCells,b.oceanCells);assert.deepEqual(a.lakeFillDepthM,b.lakeFillDepthM);checkGraph(b);
  if(lakeFillFraction<1)for(const lake of b.lakes)for(const i of lake.terminalSinkCellIndices)assert.equal(b.downstream[i],-1);
 }
});
test('routing handles wrapped longitude and deterministic plateau ties without source mutation',()=>{
 const before=[...elevation],settings={elevation,columns,rows,routingMode:'steepest-filled'};
 const a=derivePlanetHydrology(settings),b=derivePlanetHydrology(settings);
 assert.deepEqual(a,b);assert.deepEqual(elevation,before);checkGraph(a);
});

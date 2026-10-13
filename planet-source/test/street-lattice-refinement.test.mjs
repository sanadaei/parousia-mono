import test from 'node:test';import assert from 'node:assert/strict';
import {refineStreetLattice} from '../src/core/street-lattice-refinement.mjs';
import {planTerrainLedStreets} from '../src/core/terrain-led-streets.mjs';
const sample=(xM,yM)=>({xM,yM,roadElevationM:100.06,distanceM:0}),road=(id,points)=>({roadId:id,halfWidthM:3,samples:points.map(p=>sample(...p))});
test('refinement removes lattice zigzags but retains shared junctions and endpoints',()=>{
 const roads=[road('main',[[0,0],[10,0],[20,10],[30,10],[40,20],[50,20]]),road('branch',[[20,10],[20,20],[30,30]])],args={ground:()=>100,safeSegment:()=>true},r=refineStreetLattice(roads,args);assert.ok(r.shortcuts>0);assert.deepEqual(r,refineStreetLattice(roads,args));
 for(let i=0;i<roads.length;i++){assert.equal(r.roads[i].samples[0].xM,roads[i].samples[0].xM);assert.equal(r.roads[i].samples.at(-1).yM,roads[i].samples.at(-1).yM);assert.ok(r.roads[i].samples.some(p=>p.xM===20&&p.yM===10));}assert.equal(roads[0].samples.length,6);
});
test('failed surveys preserve original route and shortcuts cannot cross other streets',()=>{
 const roads=[road('a',[[0,0],[10,0],[20,10]])],r=refineStreetLattice(roads,{ground:()=>100,safeSegment:()=>false});assert.equal(r.shortcuts,0);assert.deepEqual(r.roads[0].samples.map(p=>[p.xM,p.yM]),[[0,0],[10,0],[20,10]]);
 const crossing=road('b',[[10,4],[10,6]]),c=refineStreetLattice([...roads,crossing],{ground:()=>100,safeSegment:()=>true});assert.equal(c.shortcuts,0);
});
test('production refinement preserves connections and surveys sub-grid water and grade',()=>{
 const args={ground:(x,y)=>100+.01*x,water:(x,y)=>({waterDepthM:x>45&&x<65&&y>6&&y<22?2:0}),branchFromNetwork:true,gateNames:['east','north'],gatePoints:[{name:'east',xM:200,yM:70},{name:'north',xM:-90,yM:230}],residentialCatchments:true},old=planTerrainLedStreets(args),r=planTerrainLedStreets({...args,refineLattice:true});assert.ok(r.refinement.shortcuts>0);assert.deepEqual(r.connections.map(p=>[p.gate,p.status]),old.connections.map(p=>[p.gate,p.status]));assert.deepEqual(r,planTerrainLedStreets({...args,refineLattice:true}));
 for(const road of r.roads)for(let i=1;i<road.samples.length;i++){const a=road.samples[i-1],b=road.samples[i],length=Math.hypot(b.xM-a.xM,b.yM-a.yM),steps=Math.ceil(length);for(let k=0;k<=steps;k++){const t=k/steps;assert.equal(args.water(a.xM+(b.xM-a.xM)*t,a.yM+(b.yM-a.yM)*t).waterDepthM,0);}assert.ok(Math.abs(b.roadElevationM-a.roadElevationM)/length<=.18);}
 assert.equal(old.refinement,undefined);assert.throws(()=>planTerrainLedStreets({...args,branchFromNetwork:false,refineLattice:true}));
});

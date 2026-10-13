import {createSphericalNoise} from '../../src/core/spherical-noise.mjs';
import {createSphericalProjection,sphereBasis} from '../../src/core/spherical.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createReliefMesh,meshHeightSampler} from '../../src/core/triangular-geometry.mjs';
import {routeBasinGraph} from './mst-relief.mjs';
import {deriveClimateCatchments} from '../../src/core/climate-catchments.mjs';
import {classifyEnvironment} from '../../src/core/environment-cover.mjs';
import {classifyBiome} from '../../src/core/planet-climate.mjs';

// Controlled demonstration: fixed saved geometry, explicit climate scenarios.
// Channel lines are potential supply corridors, not constructed water meshes.
const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Expected canonical triangle JSON and output directory');
const terrain=JSON.parse(fs.readFileSync(input)),mesh=createReliefMesh(terrain.mesh),points=terrain.mesh.points,z=terrain.fields.groundElevationM,N=z.length,sampler=meshHeightSampler(mesh,z);
const outlets=terrain.references.reliefResearch?.parameters?.outlets;if(!outlets)throw Error('Saved explicit outlets required');
const routing=routeBasinGraph(z,mesh,{outlets});if(routing.report.uphillRoutingEdges)throw Error('Review drainage has unresolved uphill edges');
const scenarios=[
 {id:'humid',label:'Humid forest',temperature:26,rain:Array(12).fill(210)},
 {id:'seasonal',label:'Seasonal savanna',temperature:25,rain:[10,10,15,35,100,230,260,240,120,40,15,10]},
 {id:'temperate',label:'Temperate landscape',temperature:14,rain:[90,80,85,90,100,110,100,90,95,100,95,90]},
 {id:'dry',label:'Dry interior',temperature:25,rain:[10,10,15,10,5,0,0,0,5,10,15,10]},
 {id:'mediterranean',label:'Winter rain / dry summer',temperature:16,rain:[110,100,80,45,20,5,2,5,20,65,95,110],amplitude:9},
 {id:'cold',label:'Cold upland',temperature:3,rain:Array(12).fill(45),amplitude:5}
];
fs.mkdirSync(output,{recursive:true});
const projection=createSphericalProjection({centerLatDeg:0,centerLonDeg:0,radiusM:6371000,maxRadiusM:50000}),patchNoise=createSphericalNoise(terrain.seed+'/cover-review',6371000,1800),patches=points.map(([x,y])=>patchNoise(sphereBasis(projection.toGeographic(x,y)).up));
const slopes=points.map(p=>{const g=sampler.sampleAt(...p).gradient;return Math.hypot(g.x,g.y);}),summary=[];
for(const scenario of scenarios){
 const temperature=Array.from({length:12},(_,m)=>z.map(h=>scenario.temperature-.0065*h+(scenario.amplitude??3)*Math.cos(2*Math.PI*(m-6)/12))),rain=scenario.rain.map(v=>points.map(([x])=>v*(.9+.2*(x/20000+.5))));
 const water=deriveClimateCatchments({downstream:Array.from(routing.receiver),cellAreaM2:Array.from(mesh.nodeAreasM2),landMask:Array(N).fill(1),monthlyPrecipitationMm:rain,monthlyTemperatureC:temperature});
 const channels=[];for(let i=0;i<N;i++){const j=routing.receiver[i];if(j>=0&&water.meanPotentialFlowM3PerSecond[i]>.08)channels.push({from:i,to:j,flowM3PerSecond:water.meanPotentialFlowM3PerSecond[i],supplyMonths:water.yieldMonths[i]});}
 const size=250,bins=new Map();for(const c of channels){const a=points[c.from],b=points[c.to];for(let y=Math.floor((Math.min(a[1],b[1])-200)/size);y<=Math.floor((Math.max(a[1],b[1])+200)/size);y++)for(let x=Math.floor((Math.min(a[0],b[0])-200)/size);x<=Math.floor((Math.max(a[0],b[0])+200)/size);x++){const key=x+','+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(c);}}
 const counts={},cover=points.map(([x,y],i)=>{
   let nearest=null;for(const c of bins.get(Math.floor(x/size)+','+Math.floor(y/size))??[]){const a=points[c.from],b=points[c.to],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy))),d=Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);if(d<=200&&(!nearest||d<nearest.d))nearest={d,height:z[c.from]*(1-t)+z[c.to]*t};}
   const ts=temperature.map(m=>m[i]),ps=rain.map(m=>m[i]),v=classifyEnvironment({biome:classifyBiome(ts,ps),temperatureC:ts.reduce((a,b)=>a+b,0)/12,annualRainMm:ps.reduce((a,b)=>a+b,0),soilMoisture:water.meanSoilMoisture[i],slopeMPerM:slopes[i],riverDistanceM:nearest?.d??null,heightAboveRiverM:nearest?z[i]-nearest.height:null,patch:patches[i]});counts[v.kind]=(counts[v.kind]??0)+1;return {kind:v.kind,color:v.color,wetness:v.wetness};
 });
 const result={sourceWorldId:terrain.worldId,scenario,points,triangles:terrain.mesh.triangles,heights:z,cover,channels,diagnostics:{counts,outletPotentialFlow:outlets.map(i=>water.meanPotentialFlowM3PerSecond[i]),waterBalance:water.diagnostics,geometryUnchanged:true,scope:'Controlled potential environment; channel lines are supply corridors, not surveyed river widths or water surfaces. Simplified monthly snow storage; no glacier dynamics.'}};
 fs.writeFileSync(path.join(output,scenario.id+'.json'),JSON.stringify(result));summary.push({id:scenario.id,...result.diagnostics});console.log(scenario.id,counts);
}
fs.writeFileSync(path.join(output,'summary.json'),JSON.stringify(summary,null,2));

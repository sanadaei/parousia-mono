#!/usr/bin/env node
import fs from 'node:fs';
import {createTriangularPatchView,buildTriangularPatchMesh} from '../../src/globe/triangular-patch.mjs';
const [file,lat,lon,radius,output]=process.argv.slice(2);
if(!output)throw new Error('Usage: verify-triangular-globe.mjs SAVED_TERRAIN_JSON CENTRE_LAT CENTRE_LON RADIUS_M NEW_REPORT_JSON');
if(fs.existsSync(output))throw new Error('Report already exists');
if(fs.statSync(file).size>16*1024*1024)throw new RangeError('Input exceeds 16 MiB');
const raw=JSON.parse(fs.readFileSync(file)),xs=raw.mesh.points.map(p=>p[0]),ys=raw.mesh.points.map(p=>p[1]);
const min=values=>values.reduce((a,b)=>Math.min(a,b),Infinity),max=values=>values.reduce((a,b)=>Math.max(a,b),-Infinity);
const origin={xM:(min(xs)+max(xs))/2,yM:(min(ys)+max(ys))/2},width=max(xs)-min(xs),height=max(ys)-min(ys);
const view=createTriangularPatchView(raw,{projection:{centerLatDeg:Number(lat),centerLonDeg:Number(lon),radiusM:Number(radius),maxRadiusM:Math.hypot(width,height)},metricOrigin:origin});
const windows=[],start=performance.now();
for(let y=0;y<4;y++)for(let x=0;x<4;x++){
 const bounds={minXM:min(xs)+x*width/4,minYM:min(ys)+y*height/4,maxXM:min(xs)+(x+1)*width/4,maxYM:min(ys)+(y+1)*height/4};
 try{const m=buildTriangularPatchMesh(view,{...bounds,maxTriangles:16384});windows.push({bounds,...m.diagnostics});}
 catch(error){if(error.message==='No observed terrain in draw window')windows.push({bounds,status:'empty-source-coverage'});else throw error;}
}
const present=windows.filter(w=>w.triangles),report={status:'Regional renderer-buffer verification; not live globe adoption or WebGL acceptance',binding:view.contract,
 viewId:view.viewId,elapsedMs:performance.now()-start,windows,
 maximumBufferBytes:Math.max(...present.map(w=>w.bufferBytes)),maximumVertexFloat32ErrorM:Math.max(...present.map(w=>w.maxVertexFloat32ErrorM)),
 maximumSampledChordErrorM:Math.max(...present.map(w=>w.maxSampledChordErrorM))};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log({...report,windows:windows.length});

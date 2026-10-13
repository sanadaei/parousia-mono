import fs from 'node:fs';
import {restoreTerrain} from '../../src/core/index.mjs';
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw new Error('Usage: verify-mesh-canonical.mjs RESULT_DIRECTORY NEW_REPORT_JSON');
if(fs.existsSync(output))throw new Error('Report already exists');
const root=directory.replace(/\/$/,'')+'/',raw=JSON.parse(fs.readFileSync(root+'terrain.json')),t=restoreTerrain(raw),r=restoreTerrain(JSON.parse(fs.readFileSync(root+'raster-preview.json'))),m=t.toMesh();
let vertexMax=0,centroidMax=0,edgeMax=0,worst={differenceM:-1};
for(let i=0;i<m.points.length;i++){const[x,y,z]=m.points[i];vertexMax=Math.max(vertexMax,Math.abs(t.groundElevationAt(x,y)-z));const diff=Math.abs(r.groundElevationAt(x-t.bounds.minXM,y-t.bounds.minYM)-z);if(diff>worst.differenceM)worst={index:i,xM:x,yM:y,zM:z,differenceM:diff};}
for(const tri of m.triangles){const p=tri.map(i=>m.points[i]),x=p.reduce((v,p)=>v+p[0],0)/3,y=p.reduce((v,p)=>v+p[1],0)/3,z=p.reduce((v,p)=>v+p[2],0)/3;centroidMax=Math.max(centroidMax,Math.abs(t.groundElevationAt(x,y)-z));for(let k=0;k<3;k++){const a=p[k],b=p[(k+1)%3];edgeMax=Math.max(edgeMax,Math.abs(t.groundElevationAt((a[0]+b[0])/2,(a[1]+b[1])/2)-(a[2]+b[2])/2));}}
const windows=[],start=performance.now(),dx=(t.bounds.maxXM-t.bounds.minXM)/10,dy=(t.bounds.maxYM-t.bounds.minYM)/10;
let maxWindowCentroidErrorM=0,maxWindowAreaErrorM2=0;
for(let y=1;y<9;y++)for(let x=1;x<9;x++){
 const w=t.meshWindow({minXM:t.bounds.minXM+x*dx,minYM:t.bounds.minYM+y*dy,maxXM:t.bounds.minXM+(x+1)*dx,maxYM:t.bounds.minYM+(y+1)*dy});let area=0;
 for(const tri of w.triangles){const [a,b,c]=tri.map(i=>w.points[i]);area+=((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
  const p=a.map((v,k)=>(v+b[k]+c[k])/3);maxWindowCentroidErrorM=Math.max(maxWindowCentroidErrorM,Math.abs(t.groundElevationAt(p[0],p[1])-p[2]));}
 maxWindowAreaErrorM2=Math.max(maxWindowAreaErrorM2,Math.abs(area-dx*dy));windows.push({bounds:w.bounds,triangles:w.triangles.length,candidates:w.candidateTriangles,jsonBytes:JSON.stringify(w).length});
}
const windowAudit={count:windows.length,maxWindowCentroidErrorM,maxWindowAreaErrorM2,elapsedMs:performance.now()-start,windows};
const report={windowAudit,worldId:t.worldId,vertices:m.points.length,triangles:m.triangles.length,maxVertexErrorM:vertexMax,maxTriangleCentroidErrorM:centroidMax,maxEdgeMidpointErrorM:edgeMax,restoredWorldId:restoreTerrain(JSON.stringify(t.toSnapshot())).worldId,worstRasterConversionVertex:worst,limitation:'Finite geometry checks, not a global adoption or browser visual acceptance'};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(report);

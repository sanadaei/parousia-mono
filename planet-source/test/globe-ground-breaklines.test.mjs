import test from 'node:test';
import assert from 'node:assert/strict';
import {straightBridgeGroundBreaklines,splitGroundTriangle,groundToRenderedEdgeBound,closedGroundReverseBound} from '../src/globe/ground-breaklines.mjs';
const road={roadId:'r',samples:[
 {xM:-2,yM:0,structureKind:'fill',segmentKind:'fill'},
 {xM:-1,yM:0,structureKind:'bridge-deck',segmentKind:'bridge-deck'},
 {xM:1,yM:0,structureKind:'bridge-deck',segmentKind:'fill'},
 {xM:2,yM:0,structureKind:'fill'}]};
test('straight bridge breaklines come from saved span kinds, not elevations',()=>{
 const before=JSON.stringify(road),lines=straightBridgeGroundBreaklines([road]);
 assert.deepEqual(lines.map(l=>[l.point.xM,l.deckSide]),[[-1,1],[1,-1]]);
 assert.equal(JSON.stringify(road),before);
 const curved=structuredClone(road);curved.samples[1].yM=.1;
 assert.deepEqual(straightBridgeGroundBreaklines([curved]),[]);
 const reversed=structuredClone(road);[reversed.samples[1],reversed.samples[2]]=[reversed.samples[2],reversed.samples[1]];
 assert.deepEqual(straightBridgeGroundBreaklines([reversed]),[]);
});
test('cut ground triangles stay on one side and a separate face joins both heights',async()=>{
 const triangle=[{x:-1,y:0,z:3},{x:1,y:0,z:0},{x:0.5,y:1,z:0}];
 const split=await splitGroundTriangle(triangle,p=>p.x,async(a,b,da,db)=>{
  const t=-da/(db-da),y=a.y+(b.y-a.y)*t;
  return{negative:{x:-1e-6,y,z:3},positive:{x:1e-6,y,z:0}};
 });
 assert.equal(split.ground.length,3);assert.equal(split.wall.length,2);
 for(const tri of split.ground)assert.ok(tri.every(p=>p.x<0)||tri.every(p=>p.x>0));
 for(const tri of split.wall)assert.equal(Math.max(...tri.map(p=>p.z))-Math.min(...tri.map(p=>p.z)),3);
 assert.equal(await splitGroundTriangle(triangle,p=>p.x,async()=>null),null);
 assert.equal(await splitGroundTriangle(triangle,p=>p.y,async()=>assert.fail()),null);
});

test('real bridge-end tile has finite one-sided faces and distinguishes radial from surface error',async()=>{
 const fs=await import('node:fs'),{pathToFileURL,fileURLToPath}=await import('node:url'),
  {PagedSource}=await import('../src/globe/paged-source.mjs'),{buildMesh}=await import('../src/globe/mesh.mjs');
 const file=new URL('../examples/planet/generated/manifest.json',import.meta.url),manifest=JSON.parse(fs.readFileSync(file));
 const source=new PagedSource(manifest,file.href,async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};});
 const mesh=await buildMesh(source,{face:3,level:28,x:12729054,y:242685123});
 assert.ok(mesh.samplingStats.groundBreaklines.splitTriangles>0);
 assert.ok(mesh.samplingStats.groundBreaklines.wallTriangles>0);
 assert.ok(mesh.samplingStats.groundBreaklines.maxHorizontalGapM<=.000021);
 assert.ok(mesh.vertex.every(Number.isFinite));assert.ok(mesh.overlayVertex.every(Number.isFinite));
 // The original radial mismatch remains visible. The independent positional
 // certificate uses an edge that is actually in the rendered face.
 assert.ok(mesh.geometricError.cellGroundErrorM>3);
 assert.ok(mesh.geometricError.edgeCertifiedCells>0);
 assert.ok(mesh.geometricError.geometricErrorM<mesh.geometricError.cellGroundErrorM);
 assert.equal(mesh.geometricError.errorMetric,'symmetric positional distance to closed canonical ground surface');
 const beside=await buildMesh(source,{face:3,level:28,x:12729061,y:242685111});
 assert.equal(beside.samplingStats.groundBreaklines.splitTriangles,0);
 assert.ok(beside.geometricError.geometricErrorM<.001,'a disk extending across an outside cliff must not force a fictitious 3m error');
});

 test('rendered edge distance certificate encloses a whole cap and full cliff height',()=>{
  const R=6371000,theta=.0001/R,bound={center:[1,0,0],angular:theta},edge=[[R,0,0],[R+3,0,0]],heights=[0,3],limit=groundToRenderedEdgeBound(bound,heights,edge,R);
  assert.ok(limit<.000101);
  for(let i=0;i<=10;i++)for(let j=0;j<=10;j++)for(let k=0;k<8;k++){
    const a=theta*i/10,z=3*j/10,phi=k*Math.PI/4,p=[(R+z)*Math.cos(a),(R+z)*Math.sin(a)*Math.cos(phi),(R+z)*Math.sin(a)*Math.sin(phi)],
      closest=[Math.max(R,Math.min(R+3,p[0])),0,0],distance=Math.hypot(...p.map((v,n)=>v-closest[n]));assert.ok(distance<=limit);
  }
  assert.ok(groundToRenderedEdgeBound(bound,[-1,4],edge,R)>1);
  assert.equal(groundToRenderedEdgeBound(bound,[3,0],edge,R),Infinity);
 });

 test('reverse surface certificate encloses a ramp or vertical face at a canonical height jump',()=>{
  const R=6371000,angular=.1/R,cap={center:[1,0,0],angular},bound=closedGroundReverseBound(cap,[0,3],R);
  assert.ok(bound>=.2 && bound<.200001);
  // The physical ground is z=0 on the left, z=3 on the right, with the
  // vertical face at x=0. A sampled ramp across it is at most its width away.
  for(let i=0;i<=100;i++){
    const x=-.09+.18*i/100,z=3*i/100;
    assert.ok(Math.min(Math.abs(x),Math.abs(z),Math.abs(z-3))<=bound);
  }
  assert.equal(closedGroundReverseBound(cap,[3,0],R),Infinity);
 });

import fs from 'node:fs';import {pathToFileURL,fileURLToPath}from'node:url';import assert from'node:assert/strict';
import {requireVerificationMemory} from './verification-runtime.mjs';requireVerificationMemory();
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
const {tileDirection,geographic}=await import('../src/globe/cube.mjs');
const edgeDistance=(p,a,b)=>{const d=b.map((v,k)=>v-a[k]),square=d.reduce((n,v)=>n+v*v,0),t=square?Math.max(0,Math.min(1,d.reduce((n,v,k)=>n+v*(p[k]-a[k]),0)/square)):0;return Math.hypot(...p.map((v,k)=>v-a[k]-t*d[k]));};
const {PagedSource}=await import(root+'/src/globe/paged-source.mjs'),{buildMesh}=await import(root+'/src/globe/mesh.mjs');
const file=root+'/examples/planet/generated/manifest.json',manifest=JSON.parse(fs.readFileSync(file)),source=()=>new PagedSource(manifest,pathToFileURL(file).href,async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};});
let t={face:3,level:28,x:12729054,y:242685123};const tiles=[];while(t.level>=23){tiles.push(t);t={face:t.face,level:t.level-1,x:Math.floor(t.x/2),y:Math.floor(t.y/2)}}
const results=[];
for(const tile of tiles){const s=source(),before=performance.now(),mesh=await buildMesh(s,tile);assert.ok(mesh.vertex.every(Number.isFinite));
 const probes=[];
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const direction=tileDirection(tile,(x+.37)/8,(y+.61)/8),point=geographic(direction),sample=await s.ready(()=>s.sample(point.latDeg,point.lonDeg)),
   p=direction.map((d,k)=>d*(manifest.base.frame.radiusM+sample.groundElevationM)-mesh.anchor[k]);
  let distance=Infinity;
  for(let i=0;i<mesh.index.length;i+=3)for(let j=0;j<3;j++){
   const a=Array.from(mesh.vertex.slice(mesh.index[i+j]*12,mesh.index[i+j]*12+3)),b=Array.from(mesh.vertex.slice(mesh.index[i+(j+1)%3]*12,mesh.index[i+(j+1)%3]*12+3));
   distance=Math.min(distance,edgeDistance(p,a,b));
  }
  assert.ok(distance<=mesh.geometricError.geometricErrorM+1e-7);
  probes.push({...point,groundElevationM:sample.groundElevationM,distanceToAnActualMeshEdgeM:distance});
 }
 const r={tile,elapsedMs:performance.now()-before,vertices:mesh.vertex.length/12,triangles:mesh.index.length/3,breaklines:mesh.samplingStats.groundBreaklines,geometricError:mesh.geometricError,witness:mesh.witness,probes};results.push(r);console.log(JSON.stringify({tile,boundM:r.geometricError.geometricErrorM,maxObservedM:Math.max(...probes.map(p=>p.distanceToAnActualMeshEdgeM)),breaklines:r.breaklines}));}
fs.writeFileSync(root+'/examples/planet/verification/bridge-breakline-mesh.json',JSON.stringify({worldId:manifest.canonicalWorldId,scope:'Canonical samples unchanged. Retains radial interval error and separately certifies symmetric spatial distance to the closed ground surface including jump faces. Not radial interpolation, water, normal, or whole-view acceptance.',results},null,2));
assert.ok(results.some(r=>r.breaklines.splitTriangles>0));

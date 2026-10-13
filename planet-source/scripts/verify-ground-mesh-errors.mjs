import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {PagedSource} from '../src/globe/paged-source.mjs';
import {buildMesh,GRID,VERTEX_STRIDE} from '../src/globe/mesh.mjs';
import {tileDirection,geographic,triangleInterpolate} from '../src/globe/cube.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';
requireVerificationMemory();
const manifestPath=path.resolve('examples/planet/generated/manifest.json'),url=pathToFileURL(manifestPath).href,manifest=JSON.parse(fs.readFileSync(manifestPath)),
 hulls=JSON.parse(fs.readFileSync('examples/planet/verification/ground-hulls.json'));
const source=()=>new PagedSource(manifest,url,async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};});
const results=[];
for(const entry of hulls.results.filter(r=>r.locationId.startsWith('settlement:')&&[19,22].includes(r.tile.level))){
 const p=source(),started=performance.now(),mesh=await buildMesh(p,entry.tile),samples=[];
 assert.equal(mesh.geometricError.intervalCellCount,256);
 assert.ok(mesh.geometricError.geometricErrorM<=mesh.geometricError.intervalGroundErrorM+mesh.witness.maxVertexFloat32ErrorM);
 const vertex=(x,y)=>mesh.anchor.map((v,k)=>v+mesh.vertex[(y*(GRID+1)+x)*VERTEX_STRIDE+k]);
 for(let y=0;y<8;y++)for(let x=0;x<8;x++){
  const u=(x+.37)/8,v=(y+.61)/8,ix=Math.floor(u*GRID),iy=Math.floor(v*GRID),direction=tileDirection(entry.tile,u,v),point=geographic(direction),
    z=await p.ready(()=>p.sample(point.latDeg,point.lonDeg).groundElevationM),actual=direction.map(d=>d*(manifest.base.frame.radiusM+z)),
    interpolated=triangleInterpolate(vertex(ix,iy),vertex(ix+1,iy),vertex(ix,iy+1),vertex(ix+1,iy+1),u*GRID-ix,v*GRID-iy),
    errorM=Math.hypot(...actual.map((a,i)=>a-interpolated[i]));
  assert.ok(errorM<=mesh.geometricError.geometricErrorM+1e-7,`${entry.locationId}: ${errorM} > ${mesh.geometricError.geometricErrorM}`);
  samples.push({...point,groundElevationM:z,interpolationErrorM:errorM});
 }
 const result={locationId:entry.locationId,tile:entry.tile,geometricError:mesh.geometricError,maxObservedErrorM:Math.max(...samples.map(s=>s.interpolationErrorM)),elapsedMs:performance.now()-started,samples};results.push(result);
 console.log(entry.locationId,entry.tile.level,'bound',result.geometricError.geometricErrorM,'observed',result.maxObservedErrorM);
}
fs.writeFileSync('examples/planet/verification/ground-mesh-errors.json',JSON.stringify({sourceWorldId:manifest.canonicalWorldId,scope:'Interior finite witnesses on original triangles support, but do not replace, the conservative cell-interval proof. Adaptive triangles stay inside original cells. Display skirts, morphs and water/road overlays have separate contracts.',results},null,2));

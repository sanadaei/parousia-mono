#!/usr/bin/env node
/** Sample actual paged world state for repeatable landscape comparisons.
 * Local files only. Reference-time choices use the supplied persistent store.
 * This is not a screenshot or an independent decorative world generator. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {PagedSource} from '../src/globe/paged-source.mjs';
import {createFileMaterializationStorage} from './materialization-file-store.mjs';
import {sphereBasis,createSphericalProjection} from '../src/core/spherical.mjs';

const [manifestPath,savePath,outputPath,latitude,longitude,width='20000',size='129']=process.argv.slice(2);
if(!manifestPath||!savePath||!outputPath||latitude===undefined||longitude===undefined){
 console.error('Usage: node scripts/sample-landscape-comparison.mjs manifest.json save-directory output.json latitude longitude [width-metres=20000] [grid-size=129]');
 process.exitCode=2;
}else{
 const center={latDeg:Number(latitude),lonDeg:Number(longitude)},extentM=Number(width),grid=Number(size);
 if(!Number.isFinite(center.latDeg)||Math.abs(center.latDeg)>90||!Number.isFinite(center.lonDeg)||Math.abs(center.lonDeg)>180||!Number.isFinite(extentM)||extentM<100||extentM>64000||!Number.isSafeInteger(grid)||grid<3||grid>255)throw new RangeError('Invalid bounded comparison region');
 const absolute=path.resolve(manifestPath),out=path.resolve(outputPath);
 if(out===absolute)throw new Error('Output must not overwrite the world manifest');
 if(fs.existsSync(out))throw new Error('Choose a new output path; existing comparison evidence is preserved');
 const manifest=JSON.parse(fs.readFileSync(absolute,'utf8')),radiusM=manifest.base.frame.radiusM;
 const fetcher=async u=>{const b=fs.readFileSync(fileURLToPath(u));return{ok:true,text:async()=>b.toString(),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
 const source=new PagedSource(manifest,pathToFileURL(absolute),fetcher,{materializationStorage:createFileMaterializationStorage(path.resolve(savePath))});
 const half=extentM/2,bound={center:sphereBasis(center).up,angular:Math.SQRT2*half/radiusM},projection=createSphericalProjection({centerLatDeg:center.latDeg,centerLonDeg:center.lonDeg,radiusM,maxRadiusM:Math.SQRT2*half+10}),start=Date.now();
 await source.withWaterWork(async()=>{
  await source.prepareWater(bound);
  if(!source.landscape||!source.settlementPages)throw new Error('World has no production landscape or settlement pages');
  const context=await source.settlementPages.landCoverNeighbors(bound);
  if(!context.complete)throw new Error(`Incomplete settlement influence: ${context.reason}`);
  const surface=source.settlementBase(),samples=[],counts={};
  for(let y=0;y<grid;y++){
   for(let x=0;x<grid;x++){
    const xm=-half+x*extentM/(grid-1),ym=half-y*extentM/(grid-1),p=projection.toGeographic(xm,ym);
    const record=await source.ready(()=>{
     const s=surface.sampleSurfaceAt(p.latDeg,p.lonDeg),at=(dx,dy)=>{const q=projection.toGeographic(xm+dx,ym+dy);return surface.sampleSurfaceAt(q.latDeg,q.lonDeg).groundElevationM;};
     s.slopeMPerM=Math.hypot((at(2,0)-at(-2,0))/4,(at(0,2)-at(0,-2))/4);
     const c=source.landscape.sample(p,s,{settlements:context.sites});
     return{kind:c.kind,color:c.color,elevationM:s.groundElevationM,waterDepthM:s.waterDepthM,slopeMPerM:s.slopeMPerM,environmentKind:c.environment?.kind??null,ownerId:c.ownerId??null,reasons:c.reasons};
    });
    samples.push(record);counts[record.kind]=(counts[record.kind]??0)+1;
   }
   if(y%32===0)console.error(JSON.stringify({row:y,grid,elapsedMs:Date.now()-start}));
  }
  const result={schema:'production-landscape-comparison@1',worldId:manifest.worldId??null,landscapeProfile:manifest.landscape,center,radiusM,extentM,grid,sampleSpacingM:extentM/(grid-1),samples,counts,sites:context.sites.map(s=>({id:s.id,latDeg:s.latDeg,lonDeg:s.lonDeg,population:s.population})),elapsedMs:Date.now()-start,roadLayerIncluded:false,scope:'Actual production terrain, installed water and potential cover. Regional farm hinterlands and settlement envelopes, not detailed parcels, houses or roads. Fine streams may fall between samples. This is not browser-render acceptance.'};
  fs.writeFileSync(out,JSON.stringify(result),{flag:'wx'});
  console.log(JSON.stringify({output:out,counts,sites:result.sites.length,elapsedMs:result.elapsedMs}));
 });
}

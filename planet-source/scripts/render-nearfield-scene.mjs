import {compactSettlementLand,createSettlementLandClearance} from '../src/core/settlement-land-clearance.mjs';
import {createWoodlandRecipe,landscapeDescriptors} from '../src/core/regional-landscape.mjs';
import {automaticContourInterval} from '../src/globe/thematic-map.mjs';
/** Actual shared paged meshes rendered by the production CPU diagnostic renderer.
 * Bounded 3x3 tile window, one real village/district, not browser acceptance.
 * Usage: node render-nearfield-scene.mjs WORLD.json REGION OUTPUT_PREFIX [SITE_ID]
 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import{deflateSync}from'node:zlib';import{pathToFileURL,fileURLToPath}from'node:url';
import{restorePlanetWorld}from'../src/core/planet-world.mjs';import{createSettlementLayout}from'../src/core/settlement-layout.mjs';import{createSettlementRegionPlanner}from'./package-settlements.mjs';import{packageGlobe}from'./package-globe.mjs';import{PagedSource}from'../src/globe/paged-source.mjs';import{buildMesh}from'../src/globe/mesh.mjs';import{buildBuildingMesh}from'../src/globe/buildings.mjs';import{SoftwareRenderer}from'../src/globe/software-renderer.mjs';import{createOrbitCamera}from'../src/globe/view-state.mjs';import{directionTile}from'../src/globe/lod-neighbors.mjs';import{sphereBasis}from'../src/core/spherical.mjs';import{requireVerificationMemory}from'./verification-runtime.mjs';
function png(width,height,rgba){
 const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
 const chunk=(name,data)=>{const tag=Buffer.from(name),size=Buffer.alloc(4),check=Buffer.alloc(4);size.writeUInt32BE(data.length);check.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([size,tag,data,check]);};
 const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 const scan=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)Buffer.from(rgba.buffer,rgba.byteOffset+y*width*4,width*4).copy(scan,y*(width*4+1)+1);
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
}
export async function renderNearfieldScene(world,cellIndex,output,siteId=null,{contours=false,heightScale=1,tilt=.65,altitude=750,sunElevation=.6,terrainPoint=null,tileLevel=15,tileRadius=1,environment=false,savedPopulationRegion=null}={}){
 if(!Number.isSafeInteger(tileLevel)||tileLevel<0||tileLevel>22||!Number.isSafeInteger(tileRadius)||tileRadius<0||tileRadius>3)throw new RangeError('Invalid bounded inspection tile window');
 if(savedPopulationRegion&&(savedPopulationRegion.cellIndex!==cellIndex||!savedPopulationRegion.zoneId||savedPopulationRegion.sites.some(s=>s.economicContext?.populationId!==world.population?.id)))throw new Error('Saved population region does not match this world census');
 const region=terrainPoint?null:(savedPopulationRegion??createSettlementRegionPlanner(world).plan(cellIndex)),site=terrainPoint?{...terrainPoint,id:'terrain-inspection'}:siteId?(region.sites.find(s=>s.id===siteId)??world.settlements.find(s=>s.id===siteId)):region.sites.find(s=>s.kind==='village');if(!site)throw new Error('Requested actual settlement not found');
 const recipe=terrainPoint?null:(world.recipes.find(r=>r.id===site.id)??createSettlementLayout(world.base,site,{nearbySettlements:region.sites.filter(s=>s.id!==site.id)})),dir=fs.mkdtempSync(path.join(os.tmpdir(),'planet-nearfield-render-'));
 const manifest=packageGlobe(world.base,dir,{recipes:recipe?[recipe]:[],focus:site,canonicalWorldId:world.worldId}),fetcher=async url=>{const b=fs.readFileSync(fileURLToPath(url));return{ok:true,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),text:async()=>b.toString()};};
 if(environment&&world.landscape)manifest.landscape=world.landscape;
 const source=new PagedSource(manifest,pathToFileURL(path.join(dir,'manifest.json')).href,fetcher);
 if(environment&&region)source.settlementPages.landCoverNeighbors=async()=>({complete:true,sites:region.sites});
 let image;const canvas={clientWidth:1200,clientHeight:900,getContext:()=>({createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData:v=>image=v})},renderer=new SoftwareRenderer(canvas,{pixelScale:1,maxDimension:1200});renderer.radiusM=world.base.frame.radiusM;
 const basis=sphereBasis(site),tile=directionTile(basis.up,tileLevel),tiles=[];
 for(let dy=-tileRadius;dy<=tileRadius;dy++)for(let dx=-tileRadius;dx<=tileRadius;dx++){const t={...tile,x:tile.x+dx,y:tile.y+dy};if(t.x<0||t.y<0||t.x>=2**t.level||t.y>=2**t.level)continue;const mesh=await buildMesh(source,t);tiles.push({tile:renderer.upload(mesh),morph:1});}
 if(recipe)tiles.push({tile:renderer.upload(buildBuildingMesh(recipe,renderer.radiusM,{includeRoads:true})),morph:1});
 let treeCount=0,woodlandTileCount=0;
 if(environment&&world.landscape){
  const descriptors=landscapeDescriptors(renderer.radiusM,{center:basis.up,angular:2*altitude/renderer.radiusM}).slice(0,96);
  for(const descriptor of descriptors){
   const trees=createWoodlandRecipe(world.base,world.landscape,descriptor.landscapeTile,{nearbySettlements:region?.sites??[],settlementClearance:recipe?createSettlementLandClearance([compactSettlementLand(recipe,recipe.id)]):null});woodlandTileCount++;
   if(trees.vegetation.length||trees.landParcels.length){treeCount+=trees.vegetation.length;tiles.push({tile:renderer.upload(buildBuildingMesh(trees,renderer.radiusM,{coarse:true,coarseSurfaces:true})),morph:1});}
  }
 }
 const camera=createOrbitCamera({point:site,ground:world.base.groundElevationAt(site.latDeg,site.lonDeg),altitude,tilt,heading:0},{radiusM:renderer.radiusM,aspect:4/3,heightScale});camera.radiusM=renderer.radiusM;camera.sun=basis.up.map((v,i)=>sunElevation*v+Math.sqrt(1-sunElevation*sunElevation)*basis.east[i]);
 if(contours)camera.contourInterval=automaticContourInterval(2*altitude/camera.focal*Math.max(1,camera.aspect));
 const result=renderer.draw(camera,tiles,0),report={worldId:world.worldId,siteId:site.id,cellIndex,location:{latDeg:site.latDeg,lonDeg:site.lonDeg},recipeSha256:recipe?createHash('sha256').update(JSON.stringify(recipe)).digest('hex'):null,earthworkEnvelope:recipe?.earthworkEnvelope??null,renderer:result,view:{heightScale,tilt,altitude,sunElevation,tileLevel,tileRadius},contourIntervalM:camera.contourInterval??0,environment:{enabled:environment,trees:treeCount,woodlandTiles:woodlandTileCount,policy:world.landscape?.environmentPolicy??null},scope:`Production paged mesh and CPU renderer, ${terrainPoint?'terrain-only inspection':'one real district'}, local oblique inspection light. No browser, WebGL, texture or complete-world visual acceptance.`,blackBackground:`Outside the bounded ${2*tileRadius+1}x${2*tileRadius+1} mesh window; not a hole in generated world`,packageDirectory:dir};
 fs.writeFileSync(output+'.png',png(canvas.width,canvas.height,image.data));fs.writeFileSync(output+'.json',JSON.stringify(report,null,2)+'\n');renderer.destroy();return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){requireVerificationMemory();const[input,region,output,siteId,contourFlag]=process.argv.slice(2);if(!input||!output||!Number.isSafeInteger(Number(region)))throw new Error('Usage: node render-nearfield-scene.mjs WORLD.json REGION OUTPUT_PREFIX [SITE_ID]');const world=restorePlanetWorld(JSON.parse(fs.readFileSync(input)));console.log(JSON.stringify(await renderNearfieldScene(world,Number(region),output,siteId,{contours:contourFlag==='--contours'})));}

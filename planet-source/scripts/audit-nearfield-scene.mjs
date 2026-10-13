/** Reproducible plan-view inspection of the production regional/site planners.
 * This is a geometry diagnostic, never browser or all-world acceptance. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {restorePlanetWorld} from '../src/core/planet-world.mjs';
import {createGlobeFeatureChart} from '../src/core/globe-features.mjs';
import {createSettlementLayout} from '../src/core/settlement-layout.mjs';
import {createSettlementRegionPlanner} from './package-settlements.mjs';
import {requireVerificationMemory} from './verification-runtime.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const color = rgb => `rgb(${rgb.map(v => Math.round(v * 255)).join(',')})`;
function buildingCorners(building) {
 const b=building.bounds, x=(b.minXM+b.maxXM)/2, y=(b.minYM+b.maxYM)/2, o=building.orientation;
 if(!o)return [[b.minXM,b.minYM],[b.maxXM,b.minYM],[b.maxXM,b.maxYM],[b.minXM,b.maxYM]];
 const c=Math.cos(o.headingRad),s=Math.sin(o.headingRad);
 return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[x+u*o.lengthM/2*c-v*o.widthM/2*s,y+u*o.lengthM/2*s+v*o.widthM/2*c]);
}
function parcelBoundary(parcel) {
 const n=parcel.steps+1,p=parcel.points;
 if(!Number.isInteger(n)||n<2||p?.length!==n*n)return null;
 return [...p.slice(0,n),...Array.from({length:n-1},(_,i)=>p[(i+1)*n+n-1]),...p.slice((n-1)*n,(n-1)*n+n-1).reverse(),...Array.from({length:n-2},(_,i)=>p[(n-2-i)*n])].map(q=>[q.xM,q.yM]);
}
export function nearfieldPlanSvg(scenes) {
 const width=750,height=850;
 const body=scenes.map(({site,layout},panel)=>{
  const b=layout.bounds,scale=Math.min(680/(b.maxXM-b.minXM),720/(b.maxYM-b.minYM));
  const cx=(b.minXM+b.maxXM)/2,cy=(b.minYM+b.maxYM)/2;
  const xy=([x,y])=>`${(panel*width+width/2+(x-cx)*scale).toFixed(2)},${(420-(y-cy)*scale).toFixed(2)}`;
  const parcels=layout.landParcels.map(p=>{const boundary=parcelBoundary(p);return boundary?`<polygon points="${boundary.map(xy).join(' ')}" fill="${color(p.color??[.65,.69,.47])}" stroke="#758153" stroke-width=".6"><title>${escape(p.type+' '+p.id)}</title></polygon>`:'';}).join('');
  const roads=layout.roadCenterlineProfiles.map(r=>`<polyline points="${r.samples.map(p=>xy([p.xM,p.yM])).join(' ')}" fill="none" stroke="#aa906f" stroke-width="${2*r.halfWidthM*scale}" stroke-linejoin="round"><title>${escape(r.roadId)}</title></polyline>`).join('');
  const buildings=layout.buildings.map(b=>`<polygon points="${buildingCorners(b).map(xy).join(' ')}" fill="#915f4e" stroke="#443a32" stroke-width=".8"><title>${escape(b.id)}</title></polygon>`).join('');
  return `<g><text x="${panel*width+20}" y="25">${escape(site.kind+' '+site.id)} / district 0</text>${parcels}${roads}${buildings}<text x="${panel*width+20}" y="795">${layout.buildings.length} buildings; ${layout.roadCenterlineProfiles.length} roads; ${layout.landParcels.length} parcels</text><text x="${panel*width+20}" y="820">Actual production geometry. No terrain, water, trees or browser rendering.</text></g>`;
 }).join('');
 return `<svg xmlns="http://www.w3.org/2000/svg" width="${width*scenes.length}" height="${height}" viewBox="0 0 ${width*scenes.length} ${height}"><rect width="100%" height="100%" fill="#eeeeea"/><g font-family="sans-serif" font-size="13">${body}</g></svg>\n`;
}
export function auditNearfieldScene(world, cellIndex, siteId=null) {
 const planner=createSettlementRegionPlanner(world),region=planner.plan(cellIndex),scenes=[];
 if(siteId!==null&&!region.sites.some(s=>s.id===siteId))throw new Error('Requested site is not in the actual region');
 for(const kind of (siteId?[region.sites.find(s=>s.id===siteId).kind]:['village','town'])) {
  const site=siteId?region.sites.find(s=>s.id===siteId):region.sites.find(s=>s.kind===kind);
  if(!site)continue;
  const layout=createSettlementLayout(world.base,site,{districtIndex:0,nearbySettlements:region.sites.filter(s=>s.id!==site.id)});
  scenes.push({site,layout});
 }
 if(!scenes.length)throw new Error('Selected region has no actual village or town; no synthetic fallback');
 const physicalChecks=new Map();
 for(const {site,layout}of scenes){const paths=layout.roadCenterlineProfiles.filter(r=>r.waterSourceId),checks={tested:paths.length>0,samples:0,wet:0,buildingObstructions:0,missingRoadSurface:0};if(paths.length){const chart=createGlobeFeatureChart(world.base,layout);for(const road of paths)for(let i=0;i<road.samples.length;i+=Math.max(1,Math.floor(road.samples.length/40))){const p=road.samples[i],g=chart.projection.toGeographic(p.xM,p.yM),v=chart.sampleAt(g.latDeg,g.lonDeg);checks.samples++;if(v.waterDepthM!==0)checks.wet++;if(v.buildingId)checks.buildingObstructions++;if(!v.roadSurface)checks.missingRoadSurface++;}}physicalChecks.set(site.id,checks);}
 const populated=world.population.cells.filter(c=>c.population>0);
 const covered=planner.waterIndex?populated.filter(c=>['village','town','city'].some(k=>planner.waterIndex.forCell(c.cellIndex,k).length)).length:null;
 return {scenes,report:{schema:'nearfield-production-scene-audit@1',worldId:world.worldId,region:cellIndex,
  waterCandidateCoverage:{populatedRegions:populated.length,regionsWithCandidate:covered,index:planner.waterIndex?.diagnostics??null,scope:'Saved river-based siting proposals, not an inventory of all water or proof of an accepted access route'},
  scenes:scenes.map(({site,layout})=>({siteId:site.id,kind:site.kind,location:{latDeg:site.latDeg,lonDeg:site.lonDeg},population:site.population,riverbankAccess:layout.riverbankAccess??null,riverbankPhysicalChecks:physicalChecks.get(site.id),waterAccess:site.siting?.waterAccess??null,status:layout.layoutStatus,buildings:layout.buildings.length,roads:layout.roadCenterlineProfiles.length,parcels:layout.landParcels.length,geometrySha256:digest(JSON.stringify({buildings:layout.buildings,roads:layout.roadCenterlineProfiles,parcels:layout.landParcels}))})),
  limitations:['Selected region only, town district zero is not a complete town','SVG draws actual oriented footprints, sampled roads and parcels only; blank background does not mean vegetation, water or terrain are absent','No browser, visual LOD, continuous collision or universal historical-plausibility acceptance','Locations come from the production planner and saved world policies; no alternate inspection-only siting']}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 requireVerificationMemory();
 const [input,regionArg,output,siteId=null]=process.argv.slice(2),cellIndex=Number(regionArg);
 if(!input||!output||!Number.isSafeInteger(cellIndex)||cellIndex<0)throw new Error('Usage: node audit-nearfield-scene.mjs SAVED_WORLD.json REGION_INDEX OUTPUT_PREFIX [SITE_ID]');
 const bytes=fs.readFileSync(input),world=restorePlanetWorld(JSON.parse(bytes)),result=auditNearfieldScene(world,cellIndex,siteId);
 result.report.inputSha256=digest(bytes);
 result.report.sourceFiles=['scripts/audit-nearfield-scene.mjs','scripts/package-settlements.mjs','src/core/settlement-layout.mjs','src/core/settlement-catalogue.mjs','src/core/terrain-led-neighborhood.mjs','src/core/riverbank-access.mjs','src/core/public-access.mjs','src/core/communal-pond.mjs'].map(file=>({path:file,sha256:digest(fs.readFileSync(new URL('../'+file,import.meta.url)))}));
 fs.writeFileSync(output+'.json',JSON.stringify(result.report,null,2)+'\n');
 fs.writeFileSync(output+'.svg',nearfieldPlanSvg(result.scenes));
 console.log(JSON.stringify({worldId:world.worldId,report:output+'.json',plan:output+'.svg',scenes:result.report.scenes.map(s=>({id:s.siteId,buildings:s.buildings,districtComplete:s.status.districtComplete,wholeSettlementComplete:s.status.complete}))}));
}

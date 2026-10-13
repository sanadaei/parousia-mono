import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {requireVerificationMemory} from '../verification-runtime.mjs';
import {erodeBoundedValley} from './transient-valley-relief.mjs';
requireVerificationMemory();
const [input,output,gridOutput]=process.argv.slice(2);if(!input||!output)throw new Error('Usage: node run-nearfield-incision-comparison.mjs SAVED_WORLD.json REPORT.json [GRID_OUTPUT.json]');
import {restorePlanetWorld} from '../../src/core/planet-world.mjs';
import {createSphericalProjection} from '../../src/core/spherical.mjs';
import {createRegionalLandscape} from '../../src/core/regional-landscape.mjs';
const raw=JSON.parse(fs.readFileSync(input)),world=restorePlanetWorld(raw),base=world.base,r=base.frame.radiusM,landscape=createRegionalLandscape(raw.landscape,r),river=raw.base.references.rivers.profiles.find(p=>p.id==='river:2156:2285')??raw.base.references.rivers.profiles[0];
const forestIndex=raw.climate.biome.findIndex(b=>b==='temperate_forest'),w=raw.climate.grid.columns,h=raw.climate.grid.rows;
if(forestIndex<0||!river||!raw.settlementNetwork?.sites?.length)throw new Error('Actual river, settlement candidate and forest are required; no synthetic fallback');
const locations=[{name:'river midpoint',...river.points[Math.floor(river.points.length/2)]},{name:'settlement candidate',...raw.settlementNetwork.sites[0]},{name:'forest region',latDeg:90-(Math.floor(forestIndex/w)+.5)*180/h,lonDeg:(forestIndex%w+.5)*360/w}];
const results=[];
for(const site of locations){const projection=createSphericalProjection({centerLatDeg:site.latDeg,centerLonDeg:site.lonDeg,radiusM:r,maxRadiusM:10000}),size=97,extentM=3200,heights=[],details=[],water=[],cover=[],counts={};for(let y=0;y<size;y++)for(let x=0;x<size;x++){const p=projection.toGeographic((x/(size-1)-.5)*extentM,(y/(size-1)-.5)*extentM),s=base.sampleSurfaceAt(p.latDeg,p.lonDeg),c=landscape.sample(p,s);heights.push(s.groundElevationM);details.push(s.detailElevationM);water.push(s.waterDepthM);cover.push(c.kind);counts[c.kind]=(counts[c.kind]??0)+1;}results.push({site,size,extentM,heights,details,water,cover,counts,minM:Math.min(...heights),maxM:Math.max(...heights)});console.log(JSON.stringify({site:site.name,minM:Math.min(...heights),maxM:Math.max(...heights),counts}));}
for(const v of results){const {extentM,size:n}=v,projection=createSphericalProjection({centerLatDeg:v.site.latDeg,centerLonDeg:v.site.lonDeg,radiusM:r,maxRadiusM:r*.1}),protectedSegments=[];
 for(const river of raw.base.references.rivers.profiles)for(let i=1;i<river.points.length;i++){
  const a=projection.toLocalIfWithin(river.points[i-1].latDeg,river.points[i-1].lonDeg),b=projection.toLocalIfWithin(river.points[i].latDeg,river.points[i].lonDeg);if(!a||!b)continue;const widthM=5+Math.max(...[river.points[i-1],river.points[i]].map(p=>p.halfWidthM+p.bankWidthM)),margin=extentM/2+widthM+300;if(Math.max(a.xM,b.xM)<-margin||Math.min(a.xM,b.xM)>margin||Math.max(a.yM,b.yM)<-margin||Math.min(a.yM,b.yM)>margin)continue;protectedSegments.push({ax:a.xM+extentM/2,ay:a.yM+extentM/2,bx:b.xM+extentM/2,by:b.yM+extentM/2,widthM});
 }
 console.log(JSON.stringify({site:v.site.name,protectedSegments:protectedSegments.length,n,extentM}));const t=performance.now(),candidate=erodeBoundedValley({initial:v.heights,extentM,protectedSegments,fixed:v.water.flatMap((depth,i)=>depth>0?[i]:[])});v.proposed=v.heights.map((z,i)=>z+candidate.displacement(i%n*extentM/(n-1),Math.floor(i/n)*extentM/(n-1)));v.erosion={...candidate.report,protectedSegments:protectedSegments.length,runtimeMs:performance.now()-t};console.log(JSON.stringify({site:v.site.name,...v.erosion}));
}

const digest=b=>createHash('sha256').update(b).digest('hex');
const report={kind:'unadopted-nearfield-incision-comparison@1',inputSha256:digest(fs.readFileSync(input)),worldId:raw.worldId,sourceFiles:['transient-valley-relief.mjs','run-nearfield-incision-comparison.mjs'].map(name=>({name,sha256:digest(fs.readFileSync(new URL(name,import.meta.url)))})),scope:'Three selected windows, not comprehensive terrain or browser acceptance; potential cover excludes settlement clearing and tree meshes.',results:results.map(v=>({site:v.site,size:v.size,extentM:v.extentM,originalReliefM:v.maxM-v.minM,originalDetailRangeM:[Math.min(...v.details),Math.max(...v.details)],coverCounts:v.counts,erosion:v.erosion})),decision:'Not adopted: conservative incision barely changes flat inputs and retains the straight parent trench. Landform controls and parent hydrology/terrain coupling require further work.'};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');if(gridOutput)fs.writeFileSync(gridOutput,JSON.stringify({worldId:raw.worldId,results}));

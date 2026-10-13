import {DeferredPopulationPages,DEFERRED_POPULATION} from './deferred-population-pages.mjs';
import {landscapeDescriptors} from '../core/regional-landscape.mjs';
import {agricultureDescriptors,planSettlementAgriculture} from '../core/settlement-agriculture.mjs';
import {regionalRoadSegments,localRoadSurveyIntersects} from '../core/regional-road-network.mjs';
import {planSettlementRoadTree} from '../core/settlement-road-tree.mjs';
import {planSettlementDistricts} from '../core/settlement-districts.mjs';
import {ByteLRU} from './lru.mjs';
import {readPage} from './page-request.mjs';
import {createHash} from '../core/sha256.mjs';
import {sphereBasis} from '../core/spherical.mjs';
import {intersectsCatalogueRegion} from '../core/settlement-catalogue.mjs';
/** Demand page cache, never 300,000 labels, recipes or meshes in memory. */
export class SettlementPages{
 constructor(manifest,url,fetcher=fetch,options={}){this.landscape=manifest.landscape;this.catalogue=manifest.settlementCatalogue;if(this.catalogue&&this.catalogue.baseWorldId!==manifest.base.worldId)throw new Error('Settlement catalogue geography mismatch');this.radius=manifest.base.frame.radiusM;this.url=url;this.fetcher=fetcher;this.cache=new ByteLRU(8*1024*1024);this.active=[];this.deferred=this.catalogue?.method===DEFERRED_POPULATION?new DeferredPopulationPages(manifest,url,fetcher,options):null;}
 async region(r,signal){if(this.deferred)return this.deferred.region(r.zone,signal);let page=this.cache.get(r.path);if(!page){const text=await readPage(this.fetcher,new URL(r.path,this.url),{kind:'text',signal});if(new TextEncoder().encode(text).length!==r.bytes||createHash('sha256').update(text).digest('hex')!==r.sha256)throw new Error('Corrupt settlement page');page=JSON.parse(text);if(page.cellIndex!==r.cellIndex||page.sites.length!==r.count)throw new Error('Settlement page identity mismatch');this.cache.put(r.path,page,r.bytes*3);}return page;}
 async getSite(id,signal){if(this.deferred)return this.deferred.getSite(id,signal);const existing=this.catalogue?.landmarks.find(s=>s.id===id);if(existing)return existing;const match=/^pop:(\d+):(\d+)$/.exec(id??'');if(!match)return null;const r=this.catalogue?.regions.find(r=>r.cellIndex===Number(match[1]));return r?(await this.region(r,signal)).sites.find(s=>s.id===id)??null:null;}
 async prepareRegionList(bound,signal,paddingM=0){if(this.deferred)this.catalogue={...this.catalogue,regions:await this.deferred.descriptors(bound,signal,paddingM)};}
 async settlementNeighbors(site,signal){const extent=Math.max(planSettlementDistricts(site,this.radius).extentM,planSettlementAgriculture(site,this.radius).extentM??0);return this.roadNeighbors({fromPoint:site,toPoint:site,distanceM:extent*4},signal);}
 async roadNeighbors(link,signal){if(!this.catalogue)return[];const a=sphereBasis(link.fromPoint).up,b=sphereBasis(link.toPoint).up,v=a.map((x,i)=>x+b[i]),norm=Math.hypot(...v),bound={center:v.map(x=>x/norm),angular:(link.distanceM/2+16000)/this.radius};await this.prepareRegionList(bound,signal);const regions=this.catalogue.regions.filter(r=>intersectsCatalogueRegion(r,bound));if(regions.length>(this.deferred?64:24))throw new Error('Road reservation survey exceeds region budget');const result=[];for(const r of regions)result.push(...(await this.region(r,signal)).sites);return result;}
 async near(bound,signal,paddingM=16000,{includeRoads=true}={}){
  if(!this.catalogue)return[];this.nearRoadLinks=[...(this.catalogue.roadNetwork?.links??[])];
  if(bound.angular>(this.deferred?.012:.06))return this.catalogue.landmarks;
  await this.prepareRegionList(bound,signal,paddingM);
  const regions=this.catalogue.regions.filter(r=>intersectsCatalogueRegion(r,bound,paddingM/this.radius));
  if(regions.length>(this.deferred?64:24))return this.catalogue.landmarks;
  const result=[];
  for(const r of regions){const page=await this.region(r,signal);
   if(includeRoads)this.nearRoadLinks.push(...(page.roadNetwork??planSettlementRoadTree(page.sites,this.radius)).links);
   for(const site of page.sites){const center=sphereBasis(site).up;if(Math.acos(Math.max(-1,Math.min(1,center.reduce((sum,v,i)=>sum+v*bound.center[i],0))))<=bound.angular+paddingM/this.radius)result.push(site);}
  }
  if(includeRoads&&this.deferred)this.nearRoadLinks.push(...await this.deferred.roadLinks(bound,signal));
  return result;
 }
 /** Complete influence neighbourhood for regional cover, independent of mesh
  * visibility and of whichever recipe happened to be loaded previously. */
 async landCoverNeighbors(bound,signal){
  if(!this.catalogue)return{sites:[],complete:true};
  if(bound.angular>.012)return{sites:[],complete:false,reason:'coarse-regional-view'};
  const stated=this.catalogue.maximumSettlementExtentM,paddingM=Math.max(7000,Number.isFinite(stated)&&stated>=0?stated:46000);
  await this.prepareRegionList(bound,signal,paddingM);
  const regions=this.catalogue.regions.filter(r=>intersectsCatalogueRegion(r,bound,paddingM/this.radius));
  if(regions.length>(this.deferred?64:24)||regions.some(r=>r.bytes*3>this.cache.maxBytes))return{sites:[],complete:false,reason:'land-cover-page-budget'};
  const sites=[];
  for(const r of regions)for(const site of(await this.region(r,signal)).sites){
   const up=sphereBasis(site).up,distance=Math.acos(Math.max(-1,Math.min(1,up.reduce((n,v,i)=>n+v*bound.center[i],0))))*this.radius;
   if(distance>bound.angular*this.radius+Math.max(7000,planSettlementDistricts(site,this.radius).extentM+100))continue;
   if(sites.length>=8192)return{sites:[],complete:false,reason:'land-cover-site-budget'};sites.push(site);
  }
  sites.sort((a,b)=>a.id.localeCompare(b.id));return{sites,complete:true};
 }
 async landscapeRoadLinks(tile,signal){
  if(!this.catalogue)return[];const bound={center:sphereBasis(tile).up,angular:500/this.radius};await this.prepareRegionList(bound,signal,16000);const regions=this.catalogue.regions.filter(r=>intersectsCatalogueRegion(r,bound,16000/this.radius));if(regions.length>(this.deferred?64:24))throw new Error('Landscape road survey exceeds region budget');const links=[...(this.catalogue.roadNetwork?.links??[])];for(const r of regions){const page=await this.region(r,signal);links.push(...(page.roadNetwork??planSettlementRoadTree(page.sites,this.radius)).links);}if(this.deferred)links.push(...await this.deferred.roadLinks(bound,signal));const unique=new Map();for(const link of links)for(const part of regionalRoadSegments(link,this.radius,20000,bound))if(part.distanceM<=60000&&localRoadSurveyIntersects(part,bound,this.radius))unique.set(part.id,part);return[...unique.values()];
 }
 async descriptors(bound,signal){
  if(bound.angular>.012)return[];
  const maxRadius=Math.max(500,...(this.catalogue?.landmarks??[]).map(s=>Math.max(planSettlementDistricts(s,this.radius).extentM,planSettlementAgriculture(s,this.radius).extentM??0)));
  const sites=await this.near(bound,signal,maxRadius),descriptors=[];
  for(const site of sites){const plan=planSettlementDistricts(site,this.radius);for(let i=0;i<plan.count;i++){const district=plan.district(i),center=sphereBasis(district).up;if(Math.acos(Math.max(-1,Math.min(1,center.reduce((sum,v,k)=>sum+v*bound.center[k],0))))>bound.angular+320/this.radius)continue;descriptors.push({path:`procedural:${district.id}`,site,districtIndex:i,district,center,angularRadius:310/this.radius,verticalAllowanceM:100,bytes:32768,procedural:true});}}
  if(!this.landscape)for(const site of sites)descriptors.push(...agricultureDescriptors(site,this.radius,bound));
  for(const link of (this.nearRoadLinks??[]).flatMap(link=>regionalRoadSegments(link,this.radius,20000,bound))){if(link.distanceM>60000)continue;const a=sphereBasis(link.fromPoint).up,b=sphereBasis(link.toPoint).up,v=a.map((x,i)=>x+b[i]),length=Math.hypot(...v),center=v.map(x=>x/length),angularRadius=(link.distanceM/2+16000)/this.radius;if(Math.acos(Math.max(-1,Math.min(1,center.reduce((s,x,i)=>s+x*bound.center[i],0))))>angularRadius+bound.angular)continue;descriptors.push({path:`procedural:${link.id}`,roadLink:link,center,angularRadius,verticalAllowanceM:2,bytes:65536,procedural:true});}
  if(this.landscape)descriptors.push(...landscapeDescriptors(this.radius,bound));
  return descriptors;
 }
}

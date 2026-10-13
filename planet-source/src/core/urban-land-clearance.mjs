import {createUrbanBlockPlanner,insideUrbanBlock} from './urban-blocks.mjs';
import {planSettlementDistricts} from './settlement-districts.mjs';
import {createSphericalProjection} from './spherical.mjs';
export const URBAN_LAND_TRANSITION='planned-block-boundaries@1';
// Inverse of the existing square-ring district enumeration. It changes neither
// district identities nor positions and never enumerates an entire metropolis.
export function districtIndexForCell(x,y){const r=Math.max(Math.abs(x),Math.abs(y));if(!r)return 0;const d=y===-r?r-x:x===-r?3*r+y:y===r?5*r+x:7*r-y;return(2*r+1)**2-1-d;}
const cross=(a,b,c)=>(b.xM-a.xM)*(c.yM-a.yM)-(b.yM-a.yM)*(c.xM-a.xM);
const distance=(p,a,b)=>{const dx=b.xM-a.xM,dy=b.yM-a.yM,t=Math.max(0,Math.min(1,((p.xM-a.xM)*dx+(p.yM-a.yM)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.xM-a.xM-dx*t,p.yM-a.yM-dy*t);};
const inTriangle=(p,t)=>{const s=t.map((a,i)=>cross(a,t[(i+1)%3],p));return s.every(v=>v>=0)||s.every(v=>v<=0);};
const intersects=(a,b,c,d)=>{if(Math.max(a.xM,b.xM)<Math.min(c.xM,d.xM)||Math.max(c.xM,d.xM)<Math.min(a.xM,b.xM)||Math.max(a.yM,b.yM)<Math.min(c.yM,d.yM)||Math.max(c.yM,d.yM)<Math.min(a.yM,b.yM))return false;return cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0;};
/** Reserve the same planned town blocks used by housing, plus a conservative 20m gate/plot edge margin.
 * Vacant block interiors remain urban land; this does not plant forests inside
 * courtyards or infer a town history. Only the artificial square outer buffer
 * is released. Planners/caches are local and bounded; no household generation. */
export function createUrbanLandClearance(base,sites){
 if(sites.length>8)throw new RangeError('Urban footprint site budget exceeded');
 const contexts=sites.map(site=>{const plan=planSettlementDistricts(site,base.frame.radiusM),projection=createSphericalProjection({centerLatDeg:site.latDeg,centerLonDeg:site.lonDeg,radiusM:base.frame.radiusM,maxRadiusM:Math.max(2000,plan.extentM*2)}),geo=(x,y)=>projection.toGeographic(x,y),planner=createUrbanBlockPlanner({settlementId:site.id,seedPolicy:site.economicContext?.urbanBlockSeedPolicy,ground:(x,y)=>{const p=geo(x,y);return base.groundElevationAt(p.latDeg,p.lonDeg);},water:(x,y)=>{const p=geo(x,y);return base.sampleSurfaceAt(p.latDeg,p.lonDeg);}}),cache=new Map();
 const cell=(x,y)=>{const index=districtIndexForCell(Math.floor((x+1)/3),Math.floor((y+1)/3));if(index>=plan.count)return null;const key=x+':'+y;if(cache.has(key))return cache.get(key);const block=planner.cell(x,y);if(cache.size>=128)cache.delete(cache.keys().next().value);cache.set(key,block);return block;};
 const blocks=points=>{const xs=points.map(p=>p.xM),ys=points.map(p=>p.yM),x0=Math.floor(Math.min(...xs)/80)-2,x1=Math.ceil(Math.max(...xs)/80)+2,y0=Math.floor(Math.min(...ys)/80)-2,y1=Math.ceil(Math.max(...ys)/80)+2;if((x1-x0+1)*(y1-y0+1)>256)return null;const result=[];for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const b=cell(x,y);if(b)result.push(b);}return result;};
 return{site,projection,blocks,cache};});
 const contains=(p,b)=>insideUrbanBlock(p,b.polygon)||b.polygon.some((a,i)=>distance(p,a,b.polygon[(i+1)%b.polygon.length])<=20);
 return{reserved(id,point){const c=contexts.find(c=>c.site.id===id);if(!c)return null;const p=c.projection.toLocalIfWithin(point.latDeg,point.lonDeg);if(!p)return null;const bs=c.blocks([p]);return bs?bs.some(b=>contains(p,b)):null;},intersectsGeographicTriangle(triangle){return contexts.some(c=>{const t=triangle.map(p=>c.projection.toLocalIfWithin(p.latDeg,p.lonDeg));if(t.some(p=>!p))return false;const bs=c.blocks(t);if(!bs)return true;return bs.some(b=>t.some(p=>contains(p,b))||b.polygon.some(p=>inTriangle(p,t))||b.polygon.some((a,i)=>t.some((p,j)=>intersects(a,b.polygon[(i+1)%b.polygon.length],p,t[(j+1)%3])||distance(a,p,t[(j+1)%3])<=20)));});},cacheStats:()=>contexts.map(c=>({siteId:c.site.id,blocks:c.cache.size}))};
}

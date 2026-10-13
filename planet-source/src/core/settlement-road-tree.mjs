import {sphereBasis,greatCircle} from './spherical.mjs';
/** Spatial divide-and-connect tree: O(n log n) sorting, O(n) edges/storage.
 * Every site participates. These are desired links, not claims that an ocean
 * crossing is buildable. Local routing must resolve each link separately. */
export function planSettlementRoadTree(sites,radiusM){
 if(!Array.isArray(sites)||sites.length>8192||!Number.isFinite(radiusM)||radiusM<=0)throw new RangeError('Invalid road-tree budget');
 const ids=new Set();const nodes=sites.map(s=>{if(typeof s.id!=='string'||ids.has(s.id)||![s.latDeg,s.lonDeg].every(Number.isFinite))throw new TypeError('Unique valid road sites required');ids.add(s.id);return{site:s,v:sphereBasis(s).up};}),links=[];
 function connect(list){if(!list.length)return null;if(list.length===1)return list[0];
  const ranges=[0,1,2].map(k=>Math.max(...list.map(n=>n.v[k]))-Math.min(...list.map(n=>n.v[k]))),axis=ranges.indexOf(Math.max(...ranges));
  list.sort((a,b)=>a.v[axis]-b.v[axis]||a.site.id.localeCompare(b.site.id));const middle=list.length>>1,left=list.slice(0,middle),right=list.slice(middle),nearLeft=left.slice(-8),nearRight=right.slice(0,8),a=connect(left),b=connect(right);
  // Join nearest split-boundary candidates instead of distant arbitrary roots.
  let best=null;for(const x of nearLeft)for(const y of nearRight){const distanceM=greatCircle(x.site,y.site,radiusM).distanceM,key=[x.site.id,y.site.id].sort().join('|');if(!best||distanceM<best.distanceM||(distanceM===best.distanceM&&key<best.key))best={x,y,distanceM,key};}
  links.push({id:`road:${best.key}`,from:best.x.site.id,to:best.y.site.id,fromPoint:{latDeg:best.x.site.latDeg,lonDeg:best.x.site.lonDeg,id:best.x.site.id,population:best.x.site.population},toPoint:{latDeg:best.y.site.latDeg,lonDeg:best.y.site.lonDeg,id:best.y.site.id,population:best.y.site.population},distanceM:best.distanceM,status:'awaiting-local-route'});
  return a.site.id<b.site.id?a:b;
 }
 const root=connect(nodes);return{method:'spatial-settlement-tree@2',rootId:root?.site.id??null,siteCount:sites.length,links,coverage:sites.map(s=>({siteId:s.id,status:sites.length===1?'isolated-single-site':'linked-for-routing'}))};
}

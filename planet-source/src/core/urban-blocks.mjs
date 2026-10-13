export const URBAN_BLOCK_SEED_POLICY='terrain-ranked-block-seeds@2';
/** One town-wide street tessellation. Districts merely page pieces of it; there
 * is no separate cross-shaped town center in every streamed neighborhood. */
function fraction(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);return(h>>>0)/4294967296;}
function mixedFraction(s){let h=2166136261;for(const c of s)h=Math.imul(h^c.charCodeAt(0),16777619);h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return((h^(h>>>16))>>>0)/4294967296;}
function clip(poly,nx,ny,k){const out=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=a.xM*nx+a.yM*ny-k,db=b.xM*nx+b.yM*ny-k;if(da<=1e-8)out.push(a);if(da*db<0){const t=da/(da-db);out.push({xM:a.xM+(b.xM-a.xM)*t,yM:a.yM+(b.yM-a.yM)*t});}}return out;}
export function insideUrbanBlock(p,polygon,margin=0){return polygon.every((a,i)=>{const b=polygon[(i+1)%polygon.length],dx=b.xM-a.xM,dy=b.yM-a.yM;return dx*(p.yM-a.yM)-dy*(p.xM-a.xM)>=margin*Math.hypot(dx,dy)-1e-6;});}
export function createUrbanBlockPlanner({settlementId,ground,water,seedPolicy=null}){
 const rand=seedPolicy===URBAN_BLOCK_SEED_POLICY?mixedFraction:fraction;
 const cache=new Map();
 function seed(x,y){const key=`${x}:${y}`;if(cache.has(key))return cache.get(key);const sx=x*80,sy=y*80;if(!x&&!y){const p={xM:0,yM:0};if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(key,p);return p;}
  const candidates=Array.from({length:4},(_,i)=>({xM:sx+(rand(settlementId+key+i+'x')-.5)*30,yM:sy+(rand(settlementId+key+i+'y')-.5)*30}));let chosen=candidates[0],best=Infinity;
  for(const p of candidates){const z=ground(p.xM,p.yM),slope=Math.hypot(ground(p.xM+5,p.yM)-z,ground(p.xM,p.yM+5)-z)/5,score=(water(p.xM,p.yM).waterDepthM>0?10000:0)+slope*100+Math.hypot(p.xM-sx,p.yM-sy)*.01;if(score<best){best=score;chosen=p;}}if(cache.size>=512)cache.delete(cache.keys().next().value);cache.set(key,chosen);return chosen;
 }
 function cell(x,y){const center=seed(x,y);let polygon=[{xM:center.xM-160,yM:center.yM-160},{xM:center.xM+160,yM:center.yM-160},{xM:center.xM+160,yM:center.yM+160},{xM:center.xM-160,yM:center.yM+160}];
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){if(!dx&&!dy)continue;const p=seed(x+dx,y+dy);polygon=clip(polygon,p.xM-center.xM,p.yM-center.yM,(p.xM*p.xM+p.yM*p.yM-center.xM*center.xM-center.yM*center.yM)/2);}
  return{id:`${settlementId}/block:${x}:${y}`,x,y,center,polygon};
 }
 return{cell,method:'town-wide-terrain-biased-voronoi@1',...(seedPolicy===URBAN_BLOCK_SEED_POLICY?{seedPolicy}: {})};
}
export function surveyUrbanBlockStreets(block,{ground,water,occupied=()=>false}){
 const roads=[],rejected=[];
 for(let edge=0;edge<block.polygon.length;edge++){const a=block.polygon[edge],b=block.polygon[(edge+1)%block.polygon.length],length=Math.hypot(b.xM-a.xM,b.yM-a.yM);if(length<.05)continue;const steps=Math.ceil(length/3),samples=[];let valid=true,prior=null;
  for(let i=0;i<=steps;i++){const t=i/steps,xM=a.xM+(b.xM-a.xM)*t,yM=a.yM+(b.yM-a.yM)*t,z=ground(xM,yM),nx=-(b.yM-a.yM)/length,ny=(b.xM-a.xM)/length;
   if([-2.5,0,2.5].some(w=>water(xM+nx*w,yM+ny*w).waterDepthM>0||occupied(xM+nx*w,yM+ny*w))||prior!=null&&Math.abs(z-prior)/(length/steps)>.18){valid=false;break;}prior=z;samples.push({xM,yM,distanceM:length*t,roadElevationM:z+.06,structureKind:'fill',segmentKind:'fill'});
  }
  if(valid)roads.push({roadId:`${block.id}/edge:${edge}`,halfWidthM:2.5,surfaceMaterial:'compacted-earth',samples});else rejected.push({edge,reason:'water-grade-or-reservation'});
 }
 return{roads,rejected};
}

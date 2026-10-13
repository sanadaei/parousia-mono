import {greatCircle,sphereBasis} from './spherical.mjs';
/** Multi-source wavefront on the existing dry terrain grid. The resulting
 * forest connects every root reachable through dry, grade-limited cells.
 * Ocean-separated components remain separate. Local surveys still refine it. */
export function planRegionalRoadNetwork(snapshot,sites,{maxGrade=.12,travelResistance=null}={}){
 const {columns:w,rows:h}=snapshot.grid,n=w*h,R=snapshot.frame.radiusM,z=snapshot.fields.groundElevationM;
 if(n>32768||sites.length>8192)throw new RangeError('Regional road budget exceeded');
 if(travelResistance!==null&&(!Array.isArray(travelResistance)||travelResistance.length!==n||!travelResistance.every(v=>Number.isFinite(v)&&v>=1&&v<=100)))throw new RangeError('Invalid environment travel resistance');
 const resistance=(i,j)=>travelResistance?(travelResistance[i]+travelResistance[j])/2:1;
 const point=i=>({latDeg:90-(Math.floor(i/w)+.5)*180/h,lonDeg:(i%w+.5)*360/w}),cell=p=>Math.max(0,Math.min(h-1,Math.floor((90-p.latDeg)*h/180)))*w+((Math.floor(p.lonDeg*w/360)%w)+w)%w;
 const wet=i=>!snapshot.fields.landMask[i]||(snapshot.fields.lakeFillDepthM?.[i]??0)>0,owner=new Int32Array(n).fill(-1),prev=new Int32Array(n).fill(-1),distance=new Float64Array(n).fill(Infinity),queue=[],roots=[...sites].sort((a,b)=>a.id.localeCompare(b.id)),edges=[],unconnected=[];
 // Binary heap, storing immutable candidate distance and deterministic cell tie.
 const push=v=>{let i=queue.length;queue.push(v);while(i){const p=(i-1)>>1;if(queue[p][0]<v[0]||(queue[p][0]===v[0]&&queue[p][1]<=v[1]))break;queue[i]=queue[p];i=p;}queue[i]=v;};
 const pop=()=>{const v=queue[0],last=queue.pop();if(queue.length){let i=0;while(2*i+1<queue.length){let j=2*i+1;if(j+1<queue.length&&(queue[j+1][0]<queue[j][0]||(queue[j+1][0]===queue[j][0]&&queue[j+1][1]<queue[j][1])))j++;if(queue[j][0]>last[0]||(queue[j][0]===last[0]&&queue[j][1]>=last[1]))break;queue[i]=queue[j];i=j;}queue[i]=last;}return v;};
 for(let k=0;k<roots.length;k++){const i=cell(roots[k]);if(wet(i)){unconnected.push({siteId:roots[k].id,reason:'root-cell-is-water'});continue;}if(owner[i]>=0){edges.push({a:owner[i],b:k,i,j:i,cost:0});continue;}owner[i]=k;distance[i]=0;push([0,i]);}
 const neighbors=i=>{const x=i%w,y=Math.floor(i/w),a=[y*w+(x+w-1)%w,y*w+(x+1)%w];if(y)a.push(i-w);if(y<h-1)a.push(i+w);return a;};
 while(queue.length){const [d,i]=pop();if(d!==distance[i])continue;for(const j of neighbors(i)){if(wet(j))continue;const length=greatCircle(point(i),point(j),R).distanceM,grade=Math.abs(z[i]-z[j])/Math.max(1,length);if(grade>maxGrade)continue;const cost=length*(1+grade*10)*resistance(i,j),next=d+cost;if(next<distance[j]){distance[j]=next;owner[j]=owner[i];prev[j]=i;push([next,j]);}}}
 for(let i=0;i<n;i++)if(owner[i]>=0)for(const j of neighbors(i)){if(j<=i||owner[j]<0||owner[i]===owner[j])continue;const length=greatCircle(point(i),point(j),R).distanceM,grade=Math.abs(z[i]-z[j])/Math.max(1,length);if(grade<=maxGrade)edges.push({a:owner[i],b:owner[j],i,j,cost:distance[i]+distance[j]+length*(1+grade*10)*resistance(i,j)});}
 const parent=roots.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;},links=[];
 const path=i=>{const p=[];for(let k=i;k>=0;k=prev[k])p.push(k);return p;};
 for(const e of edges.sort((a,b)=>a.cost-b.cost||a.a-b.a||a.b-b.b)){const a=find(e.a),b=find(e.b);if(a===b)continue;parent[b]=a;const cells=[...path(e.i).reverse(),...path(e.j)],from=roots[e.a],to=roots[e.b];
  const points=[{latDeg:from.latDeg,lonDeg:from.lonDeg,id:from.id,...(Number.isSafeInteger(from.population)?{population:from.population}:{})},...cells.map(point),{latDeg:to.latDeg,lonDeg:to.lonDeg,id:to.id,...(Number.isSafeInteger(to.population)?{population:to.population}:{})}];
  links.push({id:`regional-road:${[from.id,to.id].sort().join('|')}`,from:from.id,to:to.id,fromPoint:points[0],toPoint:points.at(-1),points,status:'dry-grid-corridor-requires-local-survey',distanceM:points.slice(1).reduce((sum,p,k)=>sum+greatCircle(points[k],p,R).distanceM,0)});
 }
 const groups=new Map();for(let i=0;i<roots.length;i++){const root=find(i);if(!groups.has(root))groups.set(root,[]);groups.get(root).push(roots[i].id);}
 return{method:'dry-grid-multisource-forest@1',...(travelResistance?{environmentRouting:'potential-cover-resistance@1'}:{}),links,components:[...groups.values()].map((members,i)=>({id:`road-component:${i}`,members})),unconnected,limitations:['Coarse cells can hide local water and cliffs','No ocean bridges or ferry links are invented','Local route validation required before construction']};
}

/** Fixed canonical segments, never split according to a camera tile. */
export function regionalRoadSegments(link,radiusM,maxSegmentM=20000,bound=null){
 const intersects=(a,b,lengthM)=>{
  if(!bound)return true;
  const av=sphereBasis(a).up,bv=sphereBasis(b).up,v=av.map((x,i)=>x+bv[i]),norm=Math.hypot(...v);
  if(norm<1e-12)return true;
  const center=v.map(x=>x/norm),angle=Math.acos(Math.max(-1,Math.min(1,center.reduce((sum,x,i)=>sum+x*bound.center[i],0))));
  // Local routing may use a 10 km rectangular search margin. Its diagonal,
  // plus local endpoint/road allowances, is conservatively covered by16 km.
  return angle<=bound.angular+(lengthM/2+16000)/radiusM;
 };
 if(!link.points){if(link.distanceM<=maxSegmentM)return intersects(link.fromPoint,link.toPoint,link.distanceM)?[link]:[];link={...link,points:[link.fromPoint,link.toPoint]};}
 const result=[];let slot=0;
 for(let i=1;i<link.points.length;i++){
  const a=link.points[i-1],b=link.points[i],arc=greatCircle(a,b,radiusM);if(arc.distanceM<.01)continue;
  const steps=Math.ceil(arc.distanceM/maxSegmentM),bearing=arc.bearingDeg*Math.PI/180;let prior=a;
  if(!intersects(a,b,arc.distanceM)){slot+=steps;continue;}
  for(let k=1;k<=steps;k++){
   const p=k===steps?b:offsetGeographic(a,Math.sin(bearing)*arc.distanceM*k/steps,Math.cos(bearing)*arc.distanceM*k/steps,radiusM),id=`${link.id}/segment:${slot++}`;
   // Test each fixed segment too: passing the coarse 300 km leg must not make
   // a256 m field tile survey every distant segment along that entire leg.
   if(intersects(prior,p,arc.distanceM/steps))result.push({id,parentRoadId:link.id,from:link.from,to:link.to,fromPoint:prior,toPoint:p,distanceM:arc.distanceM/steps,status:'awaiting-local-route'});
   prior=p;
  }
 }
 return result;
}
import {offsetGeographic} from './spherical.mjs';

/** Conservative rejection against the actual local router's rectangular search
 * domain. Its widest margin is10 km, with <1 km grid rounding for <=60 km links.
 * This is a culling bound only: it neither chooses nor changes a saved route. */
export function localRoadSurveyIntersects(link,bound,radiusM){
 if(!link?.fromPoint||!link?.toPoint||!bound?.center||!Number.isFinite(bound.angular)||bound.angular<0)return true;
 const arc=greatCircle(link.fromPoint,link.toPoint,radiusM);if(arc.distanceM>60000)return true;
 const p={latDeg:Math.asin(Math.max(-1,Math.min(1,bound.center[2])))*180/Math.PI,lonDeg:Math.atan2(bound.center[1],bound.center[0])*180/Math.PI};
 const reach=bound.angular*radiusM,centerDistance=greatCircle(link.fromPoint,p,radiusM).distanceM,rho=(centerDistance+reach)/radiusM;
 if(rho>=.1||arc.distanceM>=radiusM*.1)return true;
 const projection=createSphericalProjection({centerLatDeg:link.fromPoint.latDeg,centerLonDeg:link.fromPoint.lonDeg,radiusM,maxRadiusM:radiusM*.1}),end=projection.toLocal(link.toPoint.latDeg,link.toPoint.lonDeg),q=projection.toLocal(p.latDeg,p.lonDeg);
 const pad=reach*(rho>1e-8?rho/Math.sin(rho):1)+.01,margin=11000;
 return q.xM+pad>=Math.min(0,end.xM)-margin&&q.xM-pad<=Math.max(0,end.xM)+margin&&q.yM+pad>=Math.min(0,end.yM)-margin&&q.yM-pad<=Math.max(0,end.yM)+margin;
}
import {createSphericalProjection} from './spherical.mjs';

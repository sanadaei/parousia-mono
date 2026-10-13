import {createIncisionKernel,smoothIncisionUnion} from './incision-kernel.mjs';
export const PLANAR_C1_BED='compact-c1-incision@1';
export function validatePlanarBed(bed){
 if(bed==null)return null;
 if(typeof bed!=='object'||Array.isArray(bed)||Object.keys(bed).some(k=>!['method','maxIncisionM'].includes(k))||bed.method!==PLANAR_C1_BED||!Number.isFinite(bed.maxIncisionM)||bed.maxIncisionM<=0||bed.maxIncisionM>10000)throw new RangeError('Invalid explicit C1 river bed policy');
 return bed;
}
const smooth=t=>t*t*(3-2*t),distance=(a,b)=>Math.hypot(a.xM-b.xM,a.yM-b.yM);
/** Explicit continuous planar channel field. Compile only after graph/width
 * validation. Legacy strip triangulation is left intact for old saves. */
export function createPlanarRiverBed(model,bounds){
 validatePlanarBed(model.bed);if(!model.bed)throw new TypeError('Explicit bed policy required');
 const {positive,ceiling}=createIncisionKernel(model.bed.maxIncisionM),segments=[],nodes=new Map(model.nodes.map(n=>[n.id,n]));
 for(const edge of [...model.edges].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)){
  const points=edge.points.map(p=>({...p}));
  for(const end of[0,1]){const node=nodes.get(end?edge.to:edge.from);if(node.kind!=='regional-boundary')continue;
   const at=end?points.at(-1):points[0],neighbor=end?points.at(-2):points[1],length=distance(at,neighbor),dx=(at.xM-neighbor.xM)/length,dy=(at.yM-neighbor.yM)/length,
    outward=Math.max(at.xM===bounds.minXM?-dx:0,at.xM===bounds.maxXM?dx:0,at.yM===bounds.minYM?-dy:0,at.yM===bounds.maxYM?dy:0);
   if(!(outward>0))throw new RangeError('Boundary channel must point outward');
   const extension=2*(at.halfWidthM+at.bankWidthM)/outward,p={...at,xM:at.xM+dx*extension,yM:at.yM+dy*extension};end?points.push(p):points.unshift(p);
  }
  for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],length=distance(a,b),radius=Math.max(a.halfWidthM+a.bankWidthM,b.halfWidthM+b.bankWidthM);if(!Number.isFinite(length)||length<1e-8||!Number.isFinite(radius))throw new RangeError('Invalid channel capsule');
   if(segments.length>=131072)throw new RangeError('C1 channel segment budget exceeded');
   segments.push({a,b,length,dx:(b.xM-a.xM)/length,dy:(b.yM-a.yM)/length,radius,id:edge.id});
  }
 }
 const cell=segments.reduce((m,s)=>Math.max(m,s.length,2*s.radius),10),buckets=new Map(),key=(x,y)=>`${x},${y}`;let entries=0;
 const supportBounds=segments.length?{minXM:Infinity,maxXM:-Infinity,minYM:Infinity,maxYM:-Infinity}:null;
 for(let i=0;i<segments.length;i++){const s=segments[i],box={minXM:Math.min(s.a.xM,s.b.xM)-s.radius,maxXM:Math.max(s.a.xM,s.b.xM)+s.radius,minYM:Math.min(s.a.yM,s.b.yM)-s.radius,maxYM:Math.max(s.a.yM,s.b.yM)+s.radius};
  for(const k of Object.keys(box))supportBounds[k]=k.startsWith('min')?Math.min(supportBounds[k],box[k]):Math.max(supportBounds[k],box[k]);
  for(let y=Math.floor(box.minYM/cell);y<=Math.floor(box.maxYM/cell);y++)for(let x=Math.floor(box.minXM/cell);x<=Math.floor(box.maxXM/cell);x++){if(++entries>2000000)throw new RangeError('C1 channel spatial index budget exceeded');const k=key(x,y),list=buckets.get(k)??[];list.push(i);buckets.set(k,list);}
 }
 function sample(xM,yM,base){
  if(![xM,yM,base].every(Number.isFinite))throw new TypeError('Finite bed sample coordinates and elevation required');
  let union=0,level=null;const candidates=[],sources=new Set();
  for(const i of buckets.get(key(Math.floor(xM/cell),Math.floor(yM/cell)))??[]){const s=segments[i],t=Math.max(0,Math.min(1,((xM-s.a.xM)*s.dx+(yM-s.a.yM)*s.dy)/s.length)),u=smooth(t),mix=k=>s.a[k]*(1-u)+s.b[k]*u,
    d=Math.hypot(xM-s.a.xM-t*s.length*s.dx,yM-s.a.yM-t*s.length*s.dy),width=mix('halfWidthM'),bank=mix('bankWidthM');if(d>width+bank)continue;
   const z=mix('waterLevelElevationM'),depth=mix('depthM'),target=d<=width?z-depth+depth*smooth(d/width):z+(base-z)*smooth((d-width)/bank);
   union=smoothIncisionUnion(union,ceiling(positive(base-target)));if(d<=width)candidates.push({level:z,id:s.id});
  }
  const groundElevationM=base-ceiling(union);
  for(const c of candidates)if(groundElevationM<c.level){if(level==null||c.level>level+1e-7){level=c.level;sources.clear();sources.add(c.id);}else if(Math.abs(c.level-level)<=1e-7)sources.add(c.id);}
  return{groundElevationM,waterLevelElevationM:level,waterSourceIds:[...sources].sort()};
 }
 // Conservative contacts/events use maximum-width capsules, not an
 // inscribed polygon that could miss a curved cap.
 const contacts=new Map();
 for(const segment of segments)for(const side of['minXM','maxXM','minYM','maxYM']){
  const axis=side.endsWith('XM')?'xM':'yM',other=axis==='xM'?'yM':'xM',start={xM:0,yM:0};start[axis]=bounds[side];
  const delta={xM:axis==='xM'?0:1,yM:axis==='xM'?1:0},range=capsuleInterval(segment,start,delta,bounds[other==='xM'?'minXM':'minYM'],bounds[other==='xM'?'maxXM':'maxYM']);
  if(!range)continue;const[minM,maxM]=range,k=`${segment.id}/${side}`,old=contacts.get(k);contacts.set(k,{edgeId:segment.id,side,minM:Math.min(old?.minM??Infinity,minM),maxM:Math.max(old?.maxM??-Infinity,maxM)});
 }
 function segmentEvents(a,b){const marks=new Set([0,1]),delta={xM:b.xM-a.xM,yM:b.yM-a.yM};
  for(const segment of segments){const r=capsuleInterval(segment,a,delta,0,1);if(r){marks.add(r[0]);marks.add(r[1]);marks.add((r[0]+r[1])/2);}}
  return [...marks].sort((a,b)=>a-b);
 }

 return{sample,supportBounds,segmentEvents,boundaryContacts:[...contacts.values()],indexEntries:entries,segmentCount:segments.length};
}

function capsuleInterval(s,start,delta,minT,maxT){
 const ranges=[],alpha=delta.xM**2+delta.yM**2;
 if(alpha===0){const t=Math.max(0,Math.min(s.length,(start.xM-s.a.xM)*s.dx+(start.yM-s.a.yM)*s.dy));return Math.hypot(start.xM-s.a.xM-t*s.dx,start.yM-s.a.yM-t*s.dy)<=s.radius?[minT,maxT]:null;}
 for(const p of[s.a,s.b]){const x=start.xM-p.xM,y=start.yM-p.yM,beta=2*(x*delta.xM+y*delta.yM),gamma=x*x+y*y-s.radius*s.radius,disc=beta*beta-4*alpha*gamma;
  if(disc>=0){const root=Math.sqrt(disc),lo=Math.max(minT,(-beta-root)/(2*alpha)),hi=Math.min(maxT,(-beta+root)/(2*alpha));if(lo<=hi)ranges.push([lo,hi]);}
 }
 let lo=minT,hi=maxT;
 for(const[dx,dy,limit]of[[s.dx,s.dy,s.length],[-s.dx,-s.dy,0],[-s.dy,s.dx,s.radius],[s.dy,-s.dx,s.radius]]){
  const q=dx*delta.xM+dy*delta.yM,c=dx*(start.xM-s.a.xM)+dy*(start.yM-s.a.yM);
  if(q>0)hi=Math.min(hi,(limit-c)/q);else if(q<0)lo=Math.max(lo,(limit-c)/q);else if(c>limit){lo=1;hi=0;break;}
 }
 if(lo<=hi)ranges.push([lo,hi]);return ranges.length?[Math.min(...ranges.map(r=>r[0])),Math.max(...ranges.map(r=>r[1]))]:null;
}

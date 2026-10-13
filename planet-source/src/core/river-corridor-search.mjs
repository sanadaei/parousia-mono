import { sphereBasis, geographicPoint } from './spherical.mjs';
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],unit=v=>{const n=Math.hypot(...v);return v.map(x=>x/n);};
const geo=d=>geographicPoint(Math.atan2(d[2],Math.hypot(d[0],d[1]))*180/Math.PI,Math.atan2(d[1],d[0])*180/Math.PI);
/** Bounded, deterministic maximum-head path search inside a spherical corridor.
 * A higher arriving water level dominates a lower one for the supplied monotone
 * incision test. The callback must reject flooding/unsupported transitions.
 * Not a global optimum or a drainage simulation; failure remains explicit. */
export function searchRiverCorridor(start,end,radiusM,transition,{stepM=10000,halfWidthM=null,maxNodes=4096}={}) {
 if(!Number.isFinite(radiusM)||radiusM<=0||!Number.isFinite(stepM)||stepM<=0||!Number.isSafeInteger(maxNodes)||maxNodes<64||maxNodes>4096||typeof transition!=='function')throw new TypeError('Invalid river corridor search contract');
 const av=sphereBasis(start).up,bv=sphereBasis(end).up,c=cross(av,bv),angle=Math.atan2(Math.hypot(...c),dot(av,bv)),length=angle*radiusM;
 if(angle<1e-12||angle>Math.PI/2)return{status:'unsupported-span',path:null,visited:0};
 const normal=unit(c),half=halfWidthM??Math.min(radiusM*.025,length*.3);
 if(!Number.isFinite(half)||half<=0||half>radiusM*.1)throw new RangeError('Invalid river corridor width');
 const nx=Math.max(4,Math.min(128,Math.ceil(length/stepM))),ny=17,n=(nx+1)*ny;
 if(n>maxNodes)return{status:'node-budget',path:null,visited:0};
 const positions=Array.from({length:n},(_,i)=>{const x=Math.floor(i/ny),y=i%ny,t=x/nx,offset=(y-8)/8*half/radiusM;
 const v=unit(av.map((a,k)=>(Math.sin((1-t)*angle)*a+Math.sin(t*angle)*bv[k])/Math.sin(angle)));
 return geo(v.map((a,k)=>Math.cos(offset)*a+Math.sin(offset)*normal[k]));});
 const first=8,last=nx*ny+8;positions[first]={latDeg:start.latDeg,lonDeg:start.lonDeg};positions[last]={latDeg:end.latDeg,lonDeg:end.lonDeg};
 const best=new Float64Array(n).fill(-Infinity),distance=new Float64Array(n).fill(Infinity),parent=new Int32Array(n).fill(-1),closed=new Uint8Array(n),heap=[];
 const before=(a,b)=>a.level>b.level||(a.level===b.level&&(a.distance<b.distance||a.distance===b.distance&&a.i<b.i));
 const push=v=>{heap.push(v);let i=heap.length-1;while(i){const p=(i-1)>>1;if(!before(v,heap[p]))break;heap[i]=heap[p];i=p;}heap[i]=v;};
 const pop=()=>{const out=heap[0],v=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let k=i*2+1;if(k+1<heap.length&&before(heap[k+1],heap[k]))k++;if(!before(heap[k],v))break;heap[i]=heap[k];i=k;}heap[i]=v;}return out;};
 best[first]=start.waterLevelElevationM;distance[first]=0;push({i:first,level:best[first],distance:0});let visited=0,transitions=0;
 while(heap.length){const current=pop(),i=current.i;if(closed[i]||current.level!==best[i]||current.distance!==distance[i])continue;closed[i]=1;visited++;
 if(i===last){const path=[];for(let at=i;at>=0;at=parent[at])path.push(positions[at]);return{status:'routed',path:path.reverse(),visited,transitions,corridorHalfWidthM:half};}
 const x=Math.floor(i/ny),y=i%ny;
 for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){if(!dx&&!dy||x+dx<0||x+dx>nx||y+dy<0||y+dy>=ny)continue;const j=(x+dx)*ny+y+dy;if(closed[j])continue;
 const result=transition(positions[i],positions[j],current.level,j===last);transitions++;if(!result)continue;
 const level=result.endLevelM,total=current.distance+result.lengthM;if(!Number.isFinite(level)||level>current.level+1e-7||!Number.isFinite(total)||result.lengthM<=0)throw new TypeError('Invalid river search transition');
 if(level>best[j]||(level===best[j]&&total<distance[j])){best[j]=level;distance[j]=total;parent[j]=i;push({i:j,level,distance:total});}
 }
 }
 return{status:'no-feasible-path',path:null,visited,transitions,corridorHalfWidthM:half};
}

/** Isolated, bounded bedrock-incision experiment, not a production policy.
 * Implicit n=1 stream-power update motivated by Braun & Willett (2013).
 * Priority-flood routing motivated by Barnes et al. (2014), applied only to a
 * virtual routing surface: it does NOT fill the actual terrain or create water.
 * No sediment/deposition model, calibrated age, or new-world adoption claim. */
import {createPeriodicHermiteField} from '../../src/core/periodic-field.mjs';
const smooth=t=>t*t*(3-2*t),clamp=t=>Math.max(0,Math.min(1,t));
export function erodeBoundedValley({initial,extentM=3200,fixed=[],iterations=12,dtYears=100,erodibility=1e-4,areaExponent=.45,maxCutM=10,guardM=300,protectedSegments=[]}){
 const n=Math.sqrt(initial.length),N=n*n;
 if(!Number.isInteger(n)||n<5||n>129||!initial.every(Number.isFinite)||![extentM,dtYears,erodibility,areaExponent,maxCutM,guardM].every(Number.isFinite)||extentM<=0||extentM>32768||guardM<=0||guardM>=extentM/2||dtYears<=0||dtYears>10000||erodibility<=0||erodibility>.01||areaExponent<0||areaExponent>1||maxCutM<=0||maxCutM>100||!Number.isInteger(iterations)||iterations<1||iterations>32||!Array.isArray(fixed)||fixed.some(i=>!Number.isInteger(i)||i<0||i>=N)||protectedSegments.length>512||N*protectedSegments.length>8000000)throw new RangeError('Bounded valley experiment inputs required');
 for(const s of protectedSegments)if(![s.ax,s.ay,s.bx,s.by,s.widthM].every(Number.isFinite)||s.widthM<0||Math.hypot(s.bx-s.ax,s.by-s.ay)<1e-6)throw new RangeError('Explicit finite protected river segment required');
 const step=extentM/(n-1),edge=i=>i%n===0||i%n===n-1||i<n||i>=N-n,locked=new Uint8Array(N);for(let i=0;i<N;i++)if(edge(i))locked[i]=1;for(const i of fixed)locked[i]=1;
 const neighbours=i=>{const a=[],x=i%n,y=Math.floor(i/n);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<n&&y+dy>=0&&y+dy<n)a.push(i+dy*n+dx);return a;};
 let z=Float64Array.from(initial),filledCells=0;
 for(let iteration=0;iteration<iterations;iteration++){
  const seen=new Uint8Array(N),level=Float64Array.from(z),parent=new Int32Array(N).fill(-1),order=[],heap=[];
  const less=(a,b)=>a.z<b.z||a.z===b.z&&a.i<b.i;
  const push=v=>{let k=heap.length;heap.push(v);while(k){const p=(k-1)>>1;if(!less(v,heap[p]))break;heap[k]=heap[p];k=p;}heap[k]=v;};
  const pop=()=>{const q=heap[0],v=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let j=k*2+1;if(j+1<heap.length&&less(heap[j+1],heap[j]))j++;if(!less(heap[j],v))break;heap[k]=heap[j];k=j;}heap[k]=v;}return q;};
  for(let i=0;i<N;i++)if(locked[i]){seen[i]=1;push({i,z:z[i]});}
  while(heap.length){const {i}=pop();order.push(i);for(const q of neighbours(i))if(!seen[q]){seen[q]=1;level[q]=Math.max(z[q],level[i]);parent[q]=i;push({i:q,z:level[q]});}}
  const area=new Float64Array(N).fill(step*step);for(let k=order.length-1;k>=0;k--){const i=order[k];if(parent[i]>=0)area[parent[i]]+=area[i];}
  const next=Float64Array.from(z);for(const i of order){const q=parent[i];if(q<0)continue;if(level[i]>z[i]+1e-8)filledCells++;
   // The virtual flood only supplies ordering. Never erode a pit uphill.
   if(z[i]<=next[q])continue;const length=step*Math.hypot(i%n-q%n,Math.floor(i/n)-Math.floor(q/n)),a=dtYears*erodibility*area[i]**areaExponent/length;
   next[i]=Math.max(initial[i]-maxCutM,(z[i]+a*next[q])/(1+a));
  }z=next;
 }
 const residual=Array.from(z,(v,i)=>v-initial[i]),field=createPeriodicHermiteField(residual,n,n);
 function envelope(x,y){let weight=smooth(clamp(x/guardM))*smooth(clamp((extentM-x)/guardM))*smooth(clamp(y/guardM))*smooth(clamp((extentM-y)/guardM));
  for(const s of protectedSegments){const dx=s.bx-s.ax,dy=s.by-s.ay,t=clamp(((x-s.ax)*dx+(y-s.ay)*dy)/(dx*dx+dy*dy)),distance=Math.hypot(x-s.ax-t*dx,y-s.ay-t*dy);weight*=smooth(clamp((distance-s.widthM)/guardM));}return weight;}
 const displacement=(x,y)=>{if(!Number.isFinite(x)||!Number.isFinite(y))throw new RangeError('Finite sample required');if(x<=0||y<=0||x>=extentM||y>=extentM)return 0;return field(x/step+.5,y/step+.5)*envelope(x,y)||0;};
 let removedVolumeM3=0,maximumCutM=0;for(let i=0;i<N;i++){const cut=-displacement(i%n*step,Math.floor(i/n)*step);removedVolumeM3+=cut*step*step;maximumCutM=Math.max(maximumCutM,cut);}
 return{displacement,report:{method:'bounded-transient-incision-experiment@1',adoptionReady:false,nodes:N,iterations,extentM,guardM,maximumCutM,removedVolumeM3,virtualFilledCellVisits:filledCells,limitations:['Grid-direction bias and catchment/outlet assumptions remain','Removed material is not deposited; no sediment mass-conservation claim','Protected river corridors and patch borders retain the original surface','No new water is inferred; hydraulic and cross-scale visual acceptance outstanding']}};
}

/** Bounded research comparison, NOT production terrain.
 * Tzathas et al. 2024: steady-state integral (9), routing/slope correction (4.3),
 * fixed point (5.1), coarse-to-fine (5.2), hillslope/thermal terms (26,28,29).
 * https://www-sop.inria.fr/reves/Basilic/2024/TGSC24/Analytical_Terrains_EG.pdf
 * This is NOT a reproduction: it uses a priority-flood routing surrogate rather
 * than their depression-carving method; no transient solution or optimization.
 * Boundary heights are fixed experiment inputs, NOT newly identified water.
 */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {requireVerificationMemory} from '../verification-runtime.mjs';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function noise(i,seed) {let h=Math.imul(i+1,0x9e3779b1)^seed;h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;return(h>>>0)/4294967296;}
function neighbors(i,n) {const x=i%n,y=Math.floor(i/n),a=[];if(x)a.push(i-1);if(x<n-1)a.push(i+1);if(y)a.push(i-n);if(y<n-1)a.push(i+n);return a;}
const edge=(i,n)=>i%n===0||i%n===n-1||i<n||i>=n*(n-1);
function route(z,n,seed) {
 const seen=new Uint8Array(n*n),filled=Float64Array.from(z),parent=new Int32Array(n*n).fill(-1),rank=new Int32Array(n*n),order=[],heap=[];
 const before=(a,b)=>a.z<b.z||(a.z===b.z&&a.i<b.i);
 const push=v=>{let k=heap.length;heap.push(v);while(k){const p=(k-1)>>1;if(!before(v,heap[p]))break;heap[k]=heap[p];k=p;}heap[k]=v;};
 const pop=()=>{const top=heap[0],v=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let c=k*2+1;if(c+1<heap.length&&before(heap[c+1],heap[c]))c++;if(!before(heap[c],v))break;heap[k]=heap[c];k=c;}heap[k]=v;}return top;};
 for(let i=0;i<z.length;i++)if(edge(i,n)){seen[i]=1;push({i,z:z[i]});}
 while(heap.length){const {i}=pop();rank[i]=order.length;order.push(i);for(const q of neighbors(i,n))if(!seen[q]){seen[q]=1;filled[q]=Math.max(z[q],filled[i]);parent[q]=i;push({i:q,z:filled[q]});}}
 let reroutedDepressions=0;
 for(const i of order)if(!edge(i,n)) {
  const choices=neighbors(i,n).filter(q=>rank[q]<rank[i]&&z[q]<z[i]),total=choices.reduce((s,q)=>s+z[i]-z[q],0);
  if(total>0){let pick=noise(i,seed)*total;for(const q of choices){pick-=z[i]-z[q];if(pick<=0){parent[i]=q;break;}}}
  else reroutedDepressions++;
 }
 const area=new Float64Array(z.length).fill(1);
 for(let k=order.length-1;k>=0;k--){const i=order[k],q=parent[i];if(q>=0)area[q]+=area[i];}
 return {parent,area,order,reroutedDepressions};
}
function bilinear(z,n,x,y) {
 x=clamp(x,0,n-1);y=clamp(y,0,n-1);const a=Math.floor(x),b=Math.floor(y),c=Math.min(n-1,a+1),d=Math.min(n-1,b+1),u=x-a,v=y-b;
 return (z[b*n+a]*(1-u)+z[b*n+c]*u)*(1-v)+(z[d*n+a]*(1-u)+z[d*n+c]*u)*v;
}
export function solveSteady({initial,extentM=8192,resolutions=[17,33,65,129],iterations=6,seed=1927,upliftMPerYear=.001}={}) {
 const fullN=Math.sqrt(initial.length);
 if(!Number.isInteger(fullN)||fullN<3||fullN>257||!initial.every(Number.isFinite)||!resolutions.length||resolutions.some(n=>!Number.isInteger(n)||n<3||n>257)||!Number.isInteger(iterations)||iterations<1||iterations>64||!(extentM>0&&extentM<=32768)||!(upliftMPerYear>0&&upliftMPerYear<=.01))throw new RangeError('Bounded finite steady-state input required');
 let z=null,priorN=0;const stages=[];
 for(const n of resolutions) {
  const dx=extentM/(n-1),fixed=Float64Array.from({length:n*n},(_,i)=>bilinear(initial,fullN,(i%n)*(fullN-1)/(n-1),Math.floor(i/n)*(fullN-1)/(n-1)));
  z=z?Float64Array.from({length:n*n},(_,i)=>edge(i,n)?fixed[i]:bilinear(z,priorN,((i%n)+.5*(noise(i,seed+7)-.5))*(priorN-1)/(n-1),(Math.floor(i/n)+.5*(noise(i,seed+11)-.5))*(priorN-1)/(n-1))):Float64Array.from(fixed);
  let lastDelta=0,maxDelta=0,rerouted=0;
  for(let it=0;it<iterations;it++) {
   const r=route(z,n,seed),next=Float64Array.from(fixed);lastDelta=0;rerouted=r.reroutedDepressions;
   for(const i of r.order)if(!edge(i,n)) {
    const q=r.parent[i],x=i%n,y=Math.floor(i/n),area=r.area[i]*dx*dx;
    const dz=Math.max(1e-6,z[i]-z[q]);
    const gx=Math.max(0,z[i]-Math.min(z[i-1],z[i+1]))/dx,gy=Math.max(0,z[i]-Math.min(z[i-n],z[i+n]))/dx;
    const correction=Math.max(1,Math.hypot(gx,gy)*dx/dz);
    const a=(2e-5*area**.4+.1/1.5*area**(-.6))*correction;
    let delta=upliftMPerYear*dx/a;
    if(delta/dx>.57)delta=(upliftMPerYear+.001*.57)*dx/(a+.001*correction);
    next[i]=next[q]+delta;lastDelta=Math.max(lastDelta,Math.abs(next[i]-z[i]));
   }
   for(let i=0;i<z.length;i++)if(!edge(i,n))z[i]=.5*z[i]+.5*next[i];
   maxDelta=Math.max(maxDelta,lastDelta);
  }
  stages.push({resolution:n,iterations,lastUnrelaxedDeltaM:lastDelta,maximumUnrelaxedDeltaM:maxDelta,reroutedDepressionCells:rerouted});priorN=n;
 }
 const n=priorN,r=route(z,n,seed);let edgeErrorM=0,min=Infinity,max=-Infinity;
 for(let i=0;i<z.length;i++){min=Math.min(min,z[i]);max=Math.max(max,z[i]);if(edge(i,n))edgeErrorM=Math.max(edgeErrorM,Math.abs(z[i]-bilinear(initial,fullN,(i%n)*(fullN-1)/(n-1),Math.floor(i/n)*(fullN-1)/(n-1))));}
 return {heights:z,parent:r.parent,areaCells:r.area,report:{method:'steady-stream-power-research-surrogate@1',resolution:n,extentM,stages,reliefM:max-min,edgeErrorM,converged:stages.at(-1).lastUnrelaxedDeltaM<.1,limitations:['Priority-flood routing is not the paper depression-carving algorithm','Steady-state only: no finite geological time, sediment deposition or transient solution','No fixed-parent river constraints or adjacent-region hydrology guarantee','Satisfying fixed boundary heights does not prove boundary gradients or physical flow continuity','No production evaluator, saved-world policy or renderer integration']}};
}
/** Fixed-network nonnegative-increment correction, following paper section 5.3.
 * Boundary values stay fixed. This is NOT a convergence or morphology claim. */
export function correctDiscontinuities(result,{iterations=200,step=.01}={}) {
 if(!Number.isInteger(iterations)||iterations<1||iterations>500||!(step>0&&step<=.05))throw new RangeError('Bounded correction required');
 const n=result.report.resolution,initial=result.heights,parent=result.parent,N=initial.length,children=Array.from({length:N},()=>[]),order=[];
 let lo=Infinity,hi=-Infinity;for(const v of initial){lo=Math.min(lo,v);hi=Math.max(hi,v);}const span=Math.max(1,hi-lo);
 for(let i=0;i<N;i++)if(parent[i]>=0)children[parent[i]].push(i);else order.push(i);
 for(let k=0;k<order.length;k++)order.push(...children[order[k]]);
 if(order.length!==N)throw new Error('Cyclic correction graph');
 const target=new Float64Array(N),d=new Float64Array(N),z=new Float64Array(N),gradient=new Float64Array(N);
 for(let i=0;i<N;i++)if(parent[i]>=0)d[i]=target[i]=Math.max(0,(initial[i]-initial[parent[i]])/span);
 const reconstruct=()=>{for(const i of order)z[i]=parent[i]<0?(initial[i]-lo)/span:z[parent[i]]+d[i];};
 let initialLoss=null,lastLoss=Infinity,bestLoss=Infinity,best=d.slice();
 const upstream=new Float64Array(N).fill(1);for(let k=order.length-1;k>=0;k--){const i=order[k];if(parent[i]>=0)upstream[parent[i]]+=upstream[i];}
 for(let it=0;it<=iterations;it++) {
  reconstruct();gradient.fill(0);let loss=0;
  for(let i=0;i<N;i++) {
   loss+=(d[i]-target[i])**2/6;
   if(parent[i]<0)continue;
   for(const q of neighbors(i,n))if(q!==parent[i]&&parent[q]!==i) {
    const error=Math.max(0,z[i]-z[q]-target[i]);loss+=error*error/3;gradient[i]+=error;gradient[q]-=error;
   }
  }
  initialLoss??=loss;lastLoss=loss;if(loss<bestLoss){bestLoss=loss;best=d.slice();}
  if(it===iterations)break;
  for(let k=order.length-1;k>=0;k--){const i=order[k];if(parent[i]>=0)gradient[parent[i]]+=gradient[i];}
  for(let i=0;i<N;i++)if(parent[i]>=0)d[i]=Math.max(0,d[i]-step*((d[i]-target[i])/3+2*gradient[i]/(3*upstream[i])));
 }
 d.set(best);reconstruct();const heights=Float64Array.from(z,v=>lo+v*span);
 let correctedMin=Infinity,correctedMax=-Infinity,boundaryChangeM=0;
 for(let i=0;i<N;i++){correctedMin=Math.min(correctedMin,heights[i]);correctedMax=Math.max(correctedMax,heights[i]);if(parent[i]<0)boundaryChangeM=Math.max(boundaryChangeM,Math.abs(heights[i]-initial[i]));}
 return {...result,heights,report:{...result.report,reliefM:correctedMax-correctedMin,correctionBoundaryChangeM:boundaryChangeM,correction:{iterations,step,initialLoss,bestLoss,lastLoss,acceptedBestIterate:bestLoss<=initialLoss},converged:false}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 requireVerificationMemory();const field=JSON.parse(readFileSync(process.argv[2])),out=process.argv[3]||'/tmp/planet-steady-relief';mkdirSync(out,{recursive:true});const t=performance.now(),result=solveSteady({initial:field.oldHeights});result.report.runtimeMs=performance.now()-t;
 writeFileSync(`${out}/field.json`,JSON.stringify({heights:[...result.heights],segments:[],report:result.report}));writeFileSync(`${out}/report.json`,JSON.stringify(result.report,null,2));console.log(JSON.stringify(result.report,null,2));
}

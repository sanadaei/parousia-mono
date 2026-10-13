/** Independent, bounded research implementation of basin-graph routing.
 * Algorithmic reference: Cordonnier, Bovy & Braun 2019, sections 2.1–2.3,
 * https://doi.org/10.5194/esurf-7-549-2019 . Kruskal + receiver-path reversal.
 * No library source copied. O(E log E), not the paper's linear-time variant.
 * Graph routing over a depression is not a physical downhill surface or lake.
 */
export function createReliefGrid(n,spacingM){
 if(!Number.isInteger(n)||n<3||n>257||!Number.isFinite(spacingM)||spacingM<1e-6||spacingM>1e7)throw new RangeError('Bounded finite relief grid required');
 const neighbors=Array.from({length:n*n},(_,i)=>{const x=i%n,y=Math.floor(i/n),out=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<n&&y+dy>=0&&y+dy<n)out.push({i:i+dy*n+dx,distanceM:Math.hypot(dx,dy)*spacingM});return out;});
 return {n,spacingM,neighbors};
}
export function routeBasinGraph(heights,grid,{outlets=null}={}){
 const {n,neighbors}=grid,N=grid.nodeCount??n*n;if(heights.length!==N||!heights.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7))throw new TypeError('Finite grid heights required');
 const fixed=new Uint8Array(N);if(outlets===null){if(grid.boundaryNodes){for(const i of grid.boundaryNodes)fixed[i]=1;}else for(let i=0;i<N;i++)if(i<n||i>=N-n||i%n===0||i%n===n-1)fixed[i]=1;}else{if(!Array.isArray(outlets)||!outlets.length||outlets.some(i=>!Number.isInteger(i)||i<0||i>=N))throw new RangeError('Explicit outlets required');for(const i of outlets)fixed[i]=1;}
 if(!fixed.some(Boolean))throw new RangeError('At least one explicit or boundary outlet required');
 const receiver=new Int32Array(N).fill(-1),distance=new Float64Array(N);
 for(let i=0;i<N;i++)if(!fixed[i]){let best=0;for(const q of neighbors[i]){const s=(heights[i]-heights[q.i])/q.distanceM;if(s>best||(s===best&&s>0&&q.i<receiver[i])){best=s;receiver[i]=q.i;distance[i]=q.distanceM;}}}
 const basin=new Int32Array(N).fill(-1),roots=[];
 for(let i=0;i<N;i++)if(receiver[i]<0){basin[i]=roots.length;roots.push(i);}
 for(let i=0;i<N;i++){const path=[];let j=i;while(basin[j]<0){path.push(j);j=receiver[j];}for(const k of path)basin[k]=basin[j];}
 const passes=new Map();for(let i=0;i<N;i++)for(const q of neighbors[i])if(i<q.i&&basin[i]!==basin[q.i]){
  const a=Math.min(basin[i],basin[q.i]),b=Math.max(basin[i],basin[q.i]),key=a+':'+b,level=Math.max(heights[i],heights[q.i]),old=passes.get(key);
  if(!old||level<old.level||(level===old.level&&(i<old.i||i===old.i&&q.i<old.j)))passes.set(key,{a,b,i,j:q.i,level,distanceM:q.distanceM});
 }
 const B=roots.length,dsu=Int32Array.from({length:B},(_,i)=>i),rank=new Uint8Array(B),find=i=>{let j=i;while(dsu[j]!==j)j=dsu[j];while(dsu[i]!==i){const next=dsu[i];dsu[i]=j;i=next;}return j;},join=(a,b)=>{a=find(a);b=find(b);if(a===b)return false;if(rank[a]<rank[b])[a,b]=[b,a];dsu[b]=a;if(rank[a]===rank[b])rank[a]++;return true;};
 const external=roots.map((r,b)=>fixed[r]?b:-1).filter(b=>b>=0);for(let i=1;i<external.length;i++)join(external[0],external[i]);
 const tree=Array.from({length:B},()=>[]),links=[...passes.values()].sort((a,b)=>a.level-b.level||a.i-b.i||a.j-b.j);let selected=0;
 for(const p of links)if(join(p.a,p.b)){tree[p.a].push(p);tree[p.b].push(p);selected++;}
 const seen=new Uint8Array(B),queue=external.slice();for(const b of queue)seen[b]=1;let reversedEdges=0;
 for(let k=0;k<queue.length;k++){const outside=queue[k];for(const p of tree[outside]){const inside=p.a===outside?p.b:p.a;if(seen[inside])continue;seen[inside]=1;queue.push(inside);
  let i=basin[p.i]===inside?p.i:p.j,previous=basin[p.i]===inside?p.j:p.i,previousDistance=p.distanceM;
  // Follow ORIGINAL downhill edges within this basin while reversing them.
  while(i>=0){const next=receiver[i],nextDistance=distance[i];receiver[i]=previous;distance[i]=previousDistance;previous=i;previousDistance=nextDistance;i=next;reversedEdges++;}
 }}
 if(queue.length!==B)throw new Error('Disconnected basin graph');
 const donors=Array.from({length:N},()=>[]),order=[];for(let i=0;i<N;i++)if(receiver[i]<0)order.push(i);else donors[receiver[i]].push(i);
 for(let k=0;k<order.length;k++)for(const i of donors[order[k]])order.push(i);
 if(order.length!==N)throw new Error('Routing cycle');
 const area=grid.nodeAreasM2?Float64Array.from(grid.nodeAreasM2):new Float64Array(N).fill(grid.spacingM**2);for(let k=N-1;k>=0;k--){const i=order[k];if(receiver[i]>=0)area[receiver[i]]+=area[i];}
 let uphillEdges=0;for(let i=0;i<N;i++)if(receiver[i]>=0&&heights[receiver[i]]>heights[i])uphillEdges++;
 return {receiver,distance,area,order,fixed,basin,report:{basins:B,externalBasins:external.length,selectedPasses:selected,reversedEdges,uphillRoutingEdges:uphillEdges,method:'basin-graph-kruskal-path-reversal-research@1'}};
}
/** Conservative, constant-density hillslope diffusion on a metric raster.
 * Orthogonal equal-and-opposite transfers; fixed nodes act as reservoirs.
 * Explicit CFL bound, bounded substeps, no hidden clipping or sediment source.
 */
export function diffuseRelief(heights, { n, spacingM, dtYears, diffusivityM2PerYear, fixed, maxSubsteps = 64 }) {
 const N = n*n;
 if (!Number.isInteger(n)||n<3||n>257||heights.length!==N||!heights.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7)||
     !fixed||fixed.length!==N||!Array.from(fixed).every(v=>v===0||v===1)||
     ![spacingM,dtYears,diffusivityM2PerYear].every(Number.isFinite)||spacingM<1e-6||spacingM>1e7||dtYears<=0||
     diffusivityM2PerYear<0||diffusivityM2PerYear>1000||!Number.isInteger(maxSubsteps)||maxSubsteps<1||maxSubsteps>64) {
  throw new RangeError('Bounded diffusion grid, forcing and fixed-node mask required');
 }
 const ratio=diffusivityM2PerYear*dtYears/(spacingM*spacingM),steps=Math.max(1,Math.ceil(ratio/.2));
 if(steps>maxSubsteps)throw new RangeError('Hillslope diffusion exceeds explicit substep work budget');
 let z=Float64Array.from(heights),exchangeM3=0;
 for(let t=0;t<steps;t++){
  const delta=new Float64Array(N),r=ratio/steps;
  const transfer=(i,j)=>{
   if(fixed[i]&&fixed[j])return;
   const q=r*(z[i]-z[j]);
   if(!fixed[i])delta[i]-=q;
   if(!fixed[j])delta[j]+=q;
   if(fixed[j])exchangeM3+=q*spacingM*spacingM;
   if(fixed[i])exchangeM3-=q*spacingM*spacingM;
  };
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=y*n+x;if(x+1<n)transfer(i,i+1);if(y+1<n)transfer(i,i+n);}
  for(let i=0;i<N;i++)z[i]+=delta[i];
 }
 return {heights:z,substeps:steps,boundaryExportM3:exchangeM3};
}

function boundedForcing(value, count, name, low, high) {
 const valid = v => Number.isFinite(v) && v >= low && v <= high;
 if (typeof value === 'number') {
  if (!valid(value)) throw new RangeError(`Invalid ${name}`);
  return { at: () => value, saved: value };
 }
 if (!(Array.isArray(value) || ArrayBuffer.isView(value)) || value.length !== count || !Array.from(value).every(valid)) {
  throw new RangeError(`A bounded ${name} value or full node field is required`);
 }
 const owned = Float64Array.from(value);
 return { at: i => owned[i], saved: Array.from(owned) };
}
/** Implicit n=1 stream-power scenario. No sediment, no calibrated history.
 * Spatial forcing is explicit input; a landform label does not fabricate it.
 */
export function evolveRelief({initial,n,extentM,steps=40,dtYears=10000,erodibility=2e-4,areaExponent=.4,upliftMPerYear=.001,hillslopeDiffusivityM2PerYear=0,outlets=null}){
 if(!Number.isInteger(steps)||steps<1||steps>200||![extentM,dtYears,areaExponent].every(Number.isFinite)||extentM<1||extentM>100000||dtYears<=0||dtYears>100000||areaExponent<0||areaExponent>1)throw new RangeError('Bounded relief evolution required');
 if(!Number.isFinite(hillslopeDiffusivityM2PerYear)||hillslopeDiffusivityM2PerYear<0||hillslopeDiffusivityM2PerYear>1000)throw new RangeError('Invalid hillslope diffusivity');
 const grid=createReliefGrid(n,extentM/(n-1));
 if(Math.ceil(hillslopeDiffusivityM2PerYear*dtYears/(grid.spacingM**2)/.2)>64)throw new RangeError('Hillslope diffusion exceeds work budget');if(initial.length!==n*n||!initial.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7))throw new TypeError('Finite initial terrain required');
 const k=boundedForcing(erodibility,n*n,'erodibility',1e-12,.01),u=boundedForcing(upliftMPerYear,n*n,'upliftMPerYear',0,.1);
 let hillslopeBoundaryExportM3=0;
 let z=Float64Array.from(initial),last=routeBasinGraph(z,grid,{outlets});for(let step=0;step<steps;step++){
  for(let i=0;i<z.length;i++)if(!last.fixed[i])z[i]+=u.at(i)*dtYears;
  // Uplift can change relative outlet heights; derive routes on the uplifted field.
  last=routeBasinGraph(z,grid,{outlets});const next=z.slice();for(const i of last.order){const q=last.receiver[i];if(q<0||z[i]<=next[q])continue;const a=dtYears*k.at(i)*last.area[i]**areaExponent/last.distance[i];next[i]=(z[i]+a*next[q])/(1+a);}z=next;
  if(hillslopeDiffusivityM2PerYear>0){const d=diffuseRelief(z,{n,spacingM:grid.spacingM,dtYears,diffusivityM2PerYear:hillslopeDiffusivityM2PerYear,fixed:last.fixed});z=d.heights;hillslopeBoundaryExportM3+=d.boundaryExportM3;}
 }
 last=routeBasinGraph(z,grid,{outlets});return {heights:z,routing:last,report:{status:'UNADOPTED research solver',n,extentM,steps,dtYears,erodibility:k.saved,areaExponent,upliftMPerYear:u.saved,...(outlets!==null?{outlets:[...new Set(outlets)].sort((a,b)=>a-b)}:{}),...(hillslopeDiffusivityM2PerYear>0?{hillslopeDiffusivityM2PerYear,hillslopeBoundaryExportM3}:{}),...last.report,limitations:['Routes may cross depressions uphill: graph continuity is not hydraulic validity','Fixed outlets are scenario inputs, not automatically justified regional boundaries','No fluvial sediment routing/deposition, soil production, glaciation or geological age calibration','No shared regional surface or production LOD integration']}};
}

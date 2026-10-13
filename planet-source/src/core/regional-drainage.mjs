/** A supplied terrain + explicit receiving waters and inflows.
 * Rectangular array edges are CLOSED unless a receiving outlet is provided.
 * Flood levels are routing heads, never silently written back as ground or lake.
 * Priority flood followed by steepest descent avoids adopting flood-queue
 * discovery edges as the final river directions on sloping terrain.
 */
export function solveRegionalDrainage({columns,rows,cellSizeM,cellSizeYM=cellSizeM,elevation,activeMask=null,localSupplyM3PerYear,outlets,inflows=[],prescribedReceivers=[],preferredOutletCell=null,softSlopeFraction=0,retainSupplyOwnership=false}={}){
 const n=columns*rows;
 if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<3||rows<3||n>65536||!Number.isFinite(cellSizeM)||cellSizeM<=0||!Number.isFinite(cellSizeYM)||cellSizeYM<=0||!Array.isArray(elevation)||elevation.length!==n||!elevation.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e7)||!Array.isArray(localSupplyM3PerYear)||localSupplyM3PerYear.length!==n||!localSupplyM3PerYear.every(v=>Number.isFinite(v)&&v>=0&&v<=1e20)||!Array.isArray(outlets)||!outlets.length||!Array.isArray(inflows)||inflows.length>65536)throw new RangeError('Bounded terrain, water supply and explicit outlets required');
 const mask=activeMask??Array(n).fill(1);if(mask.length!==n||!Array.from(mask).every(v=>v===0||v===1))throw new RangeError('Invalid active domain mask');
 const neighbors=i=>{const result=[],x=i%columns,y=Math.floor(i/columns);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<columns&&y+dy>=0&&y+dy<rows){const j=i+dy*columns+dx;if(mask[j])result.push({i:j,d:Math.hypot(dx*cellSizeM,dy*cellSizeYM)});}return result;};
 const seed=new Map(),portIds=new Set();for(const o of outlets){if(!o||typeof o.id!=='string'||!o.id||portIds.has(o.id)||!Number.isSafeInteger(o.cell)||o.cell<0||o.cell>=n||!mask[o.cell]||seed.has(o.cell)||!Number.isFinite(o.levelM)||o.levelM<elevation[o.cell]||Math.abs(o.levelM)>1e7||!['sea','lake','river','terminal','open-boundary'].includes(o.kind))throw new RangeError('Valid unique receiving waters required');seed.set(o.cell,o);portIds.add(o.id);}
 const input=Float64Array.from(localSupplyM3PerYear);for(let i=0;i<n;i++)if(!mask[i]&&input[i]!==0)throw new RangeError('Supply outside domain');
 for(const p of inflows){if(!p||typeof p.id!=='string'||!p.id||portIds.has(p.id)||!Number.isSafeInteger(p.cell)||p.cell<0||p.cell>=n||!mask[p.cell]||!Number.isFinite(p.supplyM3PerYear)||p.supplyM3PerYear<0||p.supplyM3PerYear>1e20)throw new RangeError('Invalid incoming boundary flow');portIds.add(p.id);input[p.cell]+=p.supplyM3PerYear;}
 const heap=[],less=(a,b)=>a.level<b.level||a.level===b.level&&a.i<b.i;
 const push=v=>{heap.push(v);let k=heap.length-1;while(k){const j=(k-1)>>1;if(!less(v,heap[j]))break;heap[k]=heap[j];k=j;}heap[k]=v;};
 const pop=()=>{const a=heap[0],v=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let j=k*2+1;if(j+1<heap.length&&less(heap[j+1],heap[j]))j++;if(!less(heap[j],v))break;heap[k]=heap[j];k=j;}heap[k]=v;}return a;};
 const head=Float64Array.from(elevation),seen=new Uint8Array(n),floodParent=new Int32Array(n).fill(-1),rank=new Int32Array(n).fill(-1),order=[];
 for(const [i,o] of seed){head[i]=o.levelM;seen[i]=1;push({i,level:head[i]});}
 while(heap.length){const {i,level}=pop();rank[i]=order.length;order.push(i);for(const q of neighbors(i))if(!seen[q.i]){seen[q.i]=1;head[q.i]=Math.max(elevation[q.i],level);floodParent[q.i]=i;push({i:q.i,level:head[q.i]});}}
 const activeCount=Array.from(mask).reduce((s,v)=>s+v,0);if(order.length!==activeCount)throw new RangeError('An active component has no declared receiver');
 if(preferredOutletCell!==null&&(!Array.isArray(preferredOutletCell)||preferredOutletCell.length!==n||!preferredOutletCell.every(v=>Number.isSafeInteger(v)&&seed.has(v))))throw new RangeError('Preferred destinations must be declared outlets');
 if(!Number.isFinite(softSlopeFraction)||softSlopeFraction<0||softSlopeFraction>1)throw new RangeError('Soft slope fraction must lie in 0..1');
 const provisionalOutlet=new Int32Array(n).fill(-1);
 const receiver=new Int32Array(n).fill(-1);let depressionCells=0,maxRoutingFillM=0;
 for(const i of order){const fill=head[i]-elevation[i];if(fill>1e-7){depressionCells++;maxRoutingFillM=Math.max(maxRoutingFillM,fill);}if(seed.has(i)){provisionalOutlet[i]=i;continue;}
  let best=floodParent[i],slope=-Infinity;for(const q of neighbors(i)){if(head[q.i]>head[i]||head[q.i]===head[i]&&rank[q.i]>=rank[i])continue;const s=(head[i]-head[q.i])/q.d;if(s>slope||s===slope&&q.i<best){slope=s;best=q.i;}}
  // Preference only selects among valid non-ascending, lower-rank edges.
  // It cannot build a wall, change terrain/head, or create a cycle. At most
  // softSlopeFraction of the steepest available slope is sacrificed.
  if(preferredOutletCell&&provisionalOutlet[best]!==preferredOutletCell[i]){
   let preferred=-1,preferredSlope=-Infinity;
   for(const q of neighbors(i)){
    if(head[q.i]>head[i]||head[q.i]===head[i]&&rank[q.i]>=rank[i]||provisionalOutlet[q.i]!==preferredOutletCell[i])continue;
    const s=(head[i]-head[q.i])/q.d;
    if(s+1e-15<slope*(1-softSlopeFraction))continue;
    if(s>preferredSlope||s===preferredSlope&&q.i<preferred){preferred=q.i;preferredSlope=s;}
   }
   if(preferred>=0)best=preferred;
  }
  receiver[i]=best;provisionalOutlet[i]=provisionalOutlet[best];
 }
 // Adopt an explicit parent channel only after its ground is downhill. A
 // prescribed confluence must remain acyclic; it cannot invent a hidden sink.
 if(!Array.isArray(prescribedReceivers)||prescribedReceivers.length>n)throw new RangeError('Invalid prescribed channels');
 if(prescribedReceivers.length){
  const fixed=new Set();
  for(const e of prescribedReceivers){
   if(!e||!Number.isSafeInteger(e.from)||!Number.isSafeInteger(e.to)||e.from<0||e.from>=n||e.to<0||e.to>=n||!mask[e.from]||!mask[e.to]||seed.has(e.from)||fixed.has(e.from)||!neighbors(e.from).some(q=>q.i===e.to)||elevation[e.to]>elevation[e.from]+1e-8||head[e.to]>head[e.from]+1e-8)throw new RangeError('Prescribed channel must be unique, adjacent and downhill');
   receiver[e.from]=e.to;fixed.add(e.from);
  }
  const degree=new Uint32Array(n),upstream=[];
  for(let i=0;i<n;i++)if(mask[i]&&receiver[i]>=0)degree[receiver[i]]++;
  for(let i=0;i<n;i++)if(mask[i]&&!degree[i])upstream.push(i);
  for(let k=0;k<upstream.length;k++){const j=receiver[upstream[k]];if(j>=0&&!--degree[j])upstream.push(j);}
  if(upstream.length!==activeCount)throw new RangeError('Prescribed channels create a cycle');
  order.length=0;for(let k=upstream.length-1;k>=0;k--)order.push(upstream[k]);
 }
 // Downstream-first order also covers the explicitly prescribed channel graph.
 const routed=Float64Array.from(input),outletAt=new Int32Array(n).fill(-1);
 for(const i of order)outletAt[i]=seed.has(i)?i:outletAt[receiver[i]];
 for(let k=order.length-1;k>=0;k--){const i=order[k],j=receiver[i];if(j>=0)routed[j]+=routed[i];}
 const receiving=outlets.map(o=>({...o,supplyM3PerYear:routed[o.cell]})),totalInput=Array.from(input).reduce((s,v)=>s+v,0),totalOutput=receiving.reduce((s,v)=>s+v.supplyM3PerYear,0);
 return{schema:'explicit-regional-drainage@1',...((retainSupplyOwnership||inflows.length>0)?{supplyOwnership:{localSupplyM3PerYear:[...localSupplyM3PerYear],inflows:inflows.map(p=>({...p}))}}:{}),grid:{columns,rows,cellSizeM,cellSizeYM},receiver:Array.from(receiver),routingHeadM:Array.from(head),routingFillM:elevation.map((z,i)=>mask[i]?Math.max(0,head[i]-z):0),routedSupplyM3PerYear:Array.from(routed),outletCell:Array.from(outletAt),outlets:receiving,
  diagnostics:{activeCells:activeCount,totalInputM3PerYear:totalInput,totalOutputM3PerYear:totalOutput,relativeBudgetResidual:Math.abs(totalInput-totalOutput)/Math.max(1,totalInput),depressionCells,maxRoutingFillM},
  status:outlets.some(o=>o.kind==='open-boundary')?'partial-survey-routing-only':depressionCells?'routing-only-depressions-need-water-model':'routing-only',limits:['No water surface or channel width generated','Flood head is not terrain elevation','No automatic outlet at a rectangle edge','Annual potential supply, not seasonal hydraulic discharge']};
}

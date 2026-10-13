/** A bounded local drainage analysis, not yet an automatic water surface.
 * Open survey edges are not oceans/lakes. Only complete interior catchments
 * reaching an explicitly supplied receiving water can be stream candidates. */
export function analyzeLocalDrainage({columns,rows,cellSizeM,elevation,outlets=[],minChannelAreaM2=100000,maxUnmodeledFillM=.05}) {
 const n=columns*rows;
 if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<3||rows<3||n>65536||elevation.length!==n||!elevation.every(Number.isFinite)||!Number.isFinite(cellSizeM)||cellSizeM<=0||!Number.isFinite(minChannelAreaM2)||minChannelAreaM2<=0||!Number.isFinite(maxUnmodeledFillM)||maxUnmodeledFillM<0)throw new RangeError('Invalid bounded drainage survey');
 const boundary=i=>i%columns===0||i%columns===columns-1||i<columns||i>=n-columns;
 const nearBoundary=i=>i%columns<=1||i%columns>=columns-2||i<2*columns||i>=n-2*columns;
 const neighbors=i=>{const x=i%columns,y=Math.floor(i/columns),out=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<columns&&y+dy>=0&&y+dy<rows)out.push((y+dy)*columns+x+dx);return out;};
 const seeds=new Map();for(let i=0;i<n;i++)if(boundary(i))seeds.set(i,{id:`open-boundary:${i}`,kind:'open-boundary',cell:i,levelM:elevation[i]});
 const seenOutlets=new Set();for(const o of outlets){if(!Number.isSafeInteger(o.cell)||o.cell<0||o.cell>=n||typeof o.id!=='string'||!o.id||seenOutlets.has(o.cell)||!['river','lake','sea'].includes(o.kind)||!Number.isFinite(o.levelM)||o.levelM<elevation[o.cell])throw new RangeError('Receiving water must be explicit and above its bed');seenOutlets.add(o.cell);seeds.set(o.cell,{...o});}
 const heap=[],before=(a,b)=>a.level<b.level||(a.level===b.level&&a.i<b.i);
 const push=v=>{heap.push(v);let k=heap.length-1;while(k){const p=(k-1)>>1;if(!before(v,heap[p]))break;heap[k]=heap[p];k=p;}heap[k]=v;};
 const pop=()=>{const out=heap[0],v=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let q=k*2+1;if(q+1<heap.length&&before(heap[q+1],heap[q]))q++;if(!before(heap[q],v))break;heap[k]=heap[q];k=q;}heap[k]=v;}return out;};
 const seen=new Uint8Array(n),filled=Float64Array.from(elevation),receiver=new Int32Array(n).fill(-1),root=new Int32Array(n).fill(-1),order=[];
 for(const [i,s] of seeds){seen[i]=1;filled[i]=s.levelM;root[i]=i;push({i,level:s.levelM});}
 while(heap.length){const {i,level}=pop();order.push(i);for(const q of neighbors(i))if(!seen[q]){seen[q]=1;filled[q]=Math.max(elevation[q],level);receiver[q]=i;root[q]=root[i];push({i:q,level:filled[q]});}}
 const area=new Float64Array(n).fill(cellSizeM**2),basins=new Map();
 for(const [i,s] of seeds)basins.set(i,{outlet:{...s},areaM2:0,landCells:0,touchesSurveyEdge:s.kind==='open-boundary',maxUnmodeledFillM:0,candidateCells:[]});
 for(let i=0;i<n;i++){const b=basins.get(root[i]);b.areaM2+=cellSizeM**2;if(!seeds.has(i)){b.landCells++;b.touchesSurveyEdge||=nearBoundary(i);b.maxUnmodeledFillM=Math.max(b.maxUnmodeledFillM,filled[i]-elevation[i]);}}
 for(let k=order.length-1;k>=0;k--){const i=order[k],q=receiver[i];if(q>=0)area[q]+=area[i];}
 const candidateMask=new Uint8Array(n);
 for(const b of basins.values())b.status=b.outlet.kind==='open-boundary'||b.touchesSurveyEdge?'boundary-truncated':b.maxUnmodeledFillM>maxUnmodeledFillM?'needs-depression-water-model':'connected-interior-catchment';
 for(let i=0;i<n;i++)if(receiver[i]>=0&&area[i]>=minChannelAreaM2&&basins.get(root[i]).status==='connected-interior-catchment'){candidateMask[i]=1;basins.get(root[i]).candidateCells.push(i);}
 return{schema:'bounded-local-drainage@1',columns,rows,cellSizeM,receiver:Array.from(receiver),filledElevationM:Array.from(filled),potentialContributingAreaM2:Array.from(area),outletCell:Array.from(root),candidateMask:Array.from(candidateMask),basins:[...basins.values()].filter(b=>b.landCells),diagnostics:{cells:n,receivingWaterSeeds:outlets.length,candidateCells:candidateMask.reduce((a,b)=>a+b,0),boundaryTruncatedBasins:[...basins.values()].filter(b=>b.landCells&&b.status==='boundary-truncated').length,depressionDependentBasins:[...basins.values()].filter(b=>b.landCells&&b.status==='needs-depression-water-model').length},limitations:['Discrete static flood routing; no rainfall/discharge or automatic water surface','Boundary-adjacent contributing land is conservatively incomplete','Unmodeled depressions block candidate publication','Actual channel profiles and receiving-water geometry still require validation']};
}

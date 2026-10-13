/** Static priority-flood drainage on the canonical global grid. This is a
 * bounded catchment model, not a time-dependent hydraulic solver. */
export function derivePlanetHydrology({ elevation, columns, rows, seaLevelM = 0, lakeFillFraction = 1, routingMode = 'flood-tree' }) {
  if(!['flood-tree','steepest-filled'].includes(routingMode))throw new RangeError('Unknown routing mode');
  const n=columns*rows;
  if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<3||rows<2||!Number.isSafeInteger(n)||n<8||n>131072||elevation.length!==n||!elevation.every(Number.isFinite)||!Number.isFinite(seaLevelM)||!Number.isFinite(lakeFillFraction)||lakeFillFraction<0||lakeFillFraction>1)throw new RangeError('Invalid hydrology input');
  const neighbors=i=>{const x=i%columns,y=Math.floor(i/columns),out=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if((!dx&&!dy)||y+dy<0||y+dy>=rows)continue;out.push((y+dy)*columns+(x+dx+columns)%columns);}return [...new Set(out)];};
  // The largest connected sub-sea component is the explicit ocean reservoir.
  const seen=new Uint8Array(n),components=[];
  for(let i=0;i<n;i++){if(seen[i]||elevation[i]>seaLevelM)continue;const cells=[i];seen[i]=1;let area=0;
    for(let k=0;k<cells.length;k++){const j=cells[k];area+=Math.sin((Math.floor(j/columns)+.5)*Math.PI/rows);for(const q of neighbors(j))if(!seen[q]&&elevation[q]<=seaLevelM){seen[q]=1;cells.push(q);}}
    components.push({cells,area});}
  components.sort((a,b)=>b.area-a.area||a.cells[0]-b.cells[0]);
  if(!components.length)throw new RangeError('No ocean outlet for this hydrology model');
  const ocean=new Uint8Array(n);components[0].cells.forEach(i=>ocean[i]=1);
  const heap=[],before=(a,b)=>a.level<b.level||(a.level===b.level&&a.i<b.i);
  const push=v=>{heap.push(v);let i=heap.length-1;while(i){const p=(i-1)>>1;if(!before(v,heap[p]))break;heap[i]=heap[p];i=p;}heap[i]=v;};
  const pop=()=>{const out=heap[0],v=heap.pop();if(heap.length){let i=0;while(i*2+1<heap.length){let k=i*2+1;if(k+1<heap.length&&before(heap[k+1],heap[k]))k++;if(!before(heap[k],v))break;heap[i]=heap[k];i=k;}heap[i]=v;}return out;};
  seen.fill(0);const filled=[...elevation],downstream=Array(n).fill(-1),order=[];
  for(let i=0;i<n;i++)if(ocean[i]){seen[i]=1;filled[i]=seaLevelM;push({i,level:seaLevelM});}
  while(heap.length){const {i,level}=pop();order.push(i);for(const q of neighbors(i))if(!seen[q]){seen[q]=1;filled[q]=Math.max(elevation[q],level);downstream[q]=i;push({i:q,level:filled[q]});}}
  // Experimental routing alternative. Flooding decides depression spill heads;
  // discovery order is not a steepest-descent calculation. On non-flat filled
  // ground, choose the steepest spherical neighbour. Keep the existing flood
  // tree on flats, so every receiver either lowers the head or precedes its
  // donor in flood order. This remains an eight-neighbour model, NOT D-infinity.
  if(routingMode==='steepest-filled'){
    const radians=Math.PI/180;
    const distance=(i,j)=>{
      const a=(90-(Math.floor(i/columns)+.5)*180/rows)*radians;
      const b=(90-(Math.floor(j/columns)+.5)*180/rows)*radians;
      let dx=Math.abs(i%columns-j%columns);dx=Math.min(dx,columns-dx);
      const dl=dx*2*Math.PI/columns;
      const v=Math.sin((a-b)/2)**2+Math.cos(a)*Math.cos(b)*Math.sin(dl/2)**2;
      return 2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,v))));
    };
    for(let i=0;i<n;i++)if(!ocean[i]){
      let best=-1,bestSlope=0;
      for(const j of neighbors(i)){
        const drop=filled[i]-filled[j];if(drop<=1e-9)continue;
        const slope=drop/distance(i,j);
        if(slope>bestSlope||(slope===bestSlope&&j<best)){best=j;bestSlope=slope;}
      }
      if(best>=0)downstream[i]=best;
    }
  }
  const lakeSeen=new Uint8Array(n),lakes=[];let redirectedDryLakeCells=0;
  for(let i=0;i<n;i++){if(ocean[i]||lakeSeen[i]||filled[i]-elevation[i]<1e-7)continue;
    const cells=[i];lakeSeen[i]=1;const spillLevelM=filled[i];
    for(let k=0;k<cells.length;k++)for(const q of neighbors(cells[k]))if(!ocean[q]&&!lakeSeen[q]&&filled[q]-elevation[q]>1e-7&&Math.abs(filled[q]-spillLevelM)<1e-7){lakeSeen[q]=1;cells.push(q);}
    const bottom=cells.reduce((v,j)=>Math.min(v,elevation[j]),Infinity),levelElevationM=Math.min(spillLevelM,bottom+(spillLevelM-bottom)*lakeFillFraction);
    const membership=new Set(cells),exits=cells.filter(j=>!membership.has(downstream[j]));
    // A low-fill scenario retains an explicit terminal lake instead of inventing an outlet flow.
    const terminalSinkCellIndices=[];
    if(lakeFillFraction<1){
      // The exposed lake bed drains INTO the remaining water, not along the
      // obsolete full-lake overflow path. Use the same bounded heap, seeded
      // at wet cells (the lowest cells also seed the completely dry case).
      const visited=new Set();
      for(const j of cells)if(elevation[j]<=levelElevationM+1e-9){visited.add(j);terminalSinkCellIndices.push(j);downstream[j]=-1;push({i:j,level:levelElevationM});}
      while(heap.length){const {i:j,level}=pop();for(const q of neighbors(j))if(membership.has(q)&&!visited.has(q)){
        visited.add(q);downstream[q]=j;redirectedDryLakeCells++;push({i:q,level:Math.max(level,elevation[q])});
      }}
    }
    lakes.push({membershipMethod:'interpolation-support@1',basinWaterPolicy:'explicit-dry-basin@1',id:`lake:${cells.reduce((v,j)=>Math.min(v,j),Infinity)}`,kind:lakeFillFraction<1?'terminal-lake':'overflow-lake',cells:cells.sort((a,b)=>a-b),
      levelElevationM,spillLevelM,fillFraction:lakeFillFraction,outletCellIndices:lakeFillFraction<1?[]:exits,...(lakeFillFraction<1?{terminalSinkCellIndices:terminalSinkCellIndices.sort((a,b)=>a-b)}:{}),waterBudget:'prescribed static fill fraction; not rainfall balance'});
  }
  if(lakeFillFraction<1||routingMode==='steepest-filled'){
    const incoming=new Uint32Array(n),forward=[];for(const j of downstream)if(j>=0)incoming[j]++;
    for(let i=0;i<n;i++)if(!incoming[i])forward.push(i);
    for(let k=0;k<forward.length;k++){const j=downstream[forward[k]];if(j>=0&&!--incoming[j])forward.push(j);}
    if(forward.length!==n)throw new Error('Terminal drainage introduced a cycle');
    order.length=0;for(let k=forward.length-1;k>=0;k--)order.push(forward[k]);
  }
  const runoff=Array(n).fill(1);
  for(let k=order.length-1;k>=0;k--){const i=order[k],q=downstream[i];if(q>=0)runoff[q]+=runoff[i];}
  const lakeLevels=new Map(lakes.flatMap(lake=>lake.cells.map(i=>[i,lake.levelElevationM])));
  return {schema:'planet-grid-hydrology@1',columns,rows,seaLevelM,oceanCells:Array.from(ocean),downstream,
    lakeFillDepthM:elevation.map((z,i)=>Math.max(0,(lakeLevels.get(i)??filled[i])-z)),runoffIndex:runoff,lakes,
    diagnostics:{redirectedDryLakeCells,oceanCells:components[0].cells.length,lakes:lakes.length,terminalLakes:lakes.filter(b=>b.kind==='terminal-lake').length,
      resolution:'canonical source grid, not rendering LOD',flowModel:routingMode==='flood-tree'?'priority-flood acyclic receivers; static lakes':'experimental steepest filled-head neighbours; flood-tree flats; static lakes'}};
}

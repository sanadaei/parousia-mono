import {hashJson} from './json-contract.mjs';

/** L0 schematic geography. Retain the complete drainage graph independently
 * of which detailed river meshes fit a display budget. Cell-centre segments
 * are direction/corridor evidence, NOT final river centrelines or valley beds.
 */
export function createPlanetLandscapeSketch(snapshot,climate){
 const {columns:w,rows:h}=snapshot.grid,n=w*h;
 const {groundElevationM:z,landMask:land,downstream:down}=snapshot.fields;
 const q=climate.catchmentWater?.meanPotentialFlowM3PerSecond;
 if(climate.sourceWorldId!==snapshot.worldId||!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<3||h<2||!Number.isSafeInteger(n)||n<1||n>32768||[z,land,down,q,climate.cellAreaM2].some(a=>!Array.isArray(a)||a.length!==n)||!z.every(Number.isFinite)||!q.every(v=>Number.isFinite(v)&&v>=0)||!land.every(v=>v===0||v===1)||!climate.cellAreaM2.every(v=>Number.isFinite(v)&&v>0)||!Number.isFinite(snapshot.references?.sea?.levelElevationM))throw Error('Matching bounded L0 fields required');
 const point=i=>({latDeg:90-(Math.floor(i/w)+.5)*180/h,lonDeg:(i%w+.5)*360/w});
 const lakeAt=new Map();for(const lake of snapshot.references.lakes??[])for(const cell of lake.cells){if(!Number.isSafeInteger(cell)||cell<0||cell>=n||lakeAt.has(cell))throw Error('Invalid or overlapping lake membership');lakeAt.set(cell,lake.id);}
 const nodes=[],edges=[],incoming=new Int32Array(n),order=[],destination=Array(n).fill(null);
 for(let i=0;i<n;i++)if(land[i]){
  const j=down[i];if(!Number.isSafeInteger(j)||j< -1||j>=n||j===i)throw Error('Invalid sketch receiver');
  if(j>=0){const dx=Math.abs(i%w-j%w),dy=Math.abs(Math.floor(i/w)-Math.floor(j/w));if(Math.min(dx,w-dx)>1||dy>1)throw Error('Non-adjacent sketch receiver');}
  if(j>=0&&land[j])incoming[j]++;
  const x=i%w,y=Math.floor(i/w),neighbours=[y*w+(x+w-1)%w,y*w+(x+1)%w,...(y?[i-w]:[]),...(y<h-1?[i+w]:[])];
  const landNeighbours=neighbours.filter(k=>land[k]),min=Math.min(z[i],...landNeighbours.map(k=>z[k])),max=Math.max(z[i],...landNeighbours.map(k=>z[k]));
  const zone=lakeAt.has(i)?'lake-support':z[i]<snapshot.references.sea.levelElevationM?'enclosed-depression':max-min>1000?'mountain-province':z[i]>1000?'highland-province':max-min<300?'low-relief-province':'mixed-relief-province';
  nodes.push({id:`sketch-cell:${i}`,cell:i,...point(i),coarseElevationM:z[i],zone,coarseNeighbourReliefM:max-min,areaM2:climate.cellAreaM2[i],potentialFlowM3PerSecond:q[i]});
  if(j>=0)edges.push({id:`sketch-flow:${i}:${j}`,from:i,to:j,start:point(i),end:point(j),potentialFlowM3PerSecond:q[i],geometryStatus:'coarse corridor, exact path unresolved',levelStatus:z[i]>=z[j]?'coarse sampled descent':'requires lake/spill or terrain refinement; not a downhill channel certificate'});
 }
 for(const node of nodes)if(!incoming[node.cell])order.push(node.cell);
 for(let k=0;k<order.length;k++){const j=down[order[k]];if(j>=0&&land[j]&&!--incoming[j])order.push(j);}
 if(order.length!==nodes.length)throw Error('Cyclic L0 sketch drainage');
 for(let k=order.length-1;k>=0;k--){const i=order[k],j=down[i];destination[i]=j>=0?(land[j]?destination[j]:`sea-cell:${j}`):(lakeAt.get(i)??`unresolved-closed-basin:${i}`);}
 for(const node of nodes)node.destination=destination[node.cell];
 for(const edge of edges)edge.destination=destination[edge.from];
 const detailed=snapshot.references.rivers?.profiles??[],existing=new Set(detailed.map(p=>p.id)),matching=edges.filter(e=>existing.has(`river:${e.from}:${e.to}`)).length;
 const result={schema:'planet-landscape-sketch@1',sourceWorldId:snapshot.worldId,climateId:climate.id,grid:{columns:w,rows:h},nodes,edges,diagnostics:{landCells:nodes.length,drainageLinks:edges.length,detailedProfiles:detailed.length,linksWithDetailedProfile:matching,uphillCoarseLinks:edges.filter(e=>!e.levelStatus.startsWith('coarse sampled')).length},scope:'Whole-planet schematic, not a new global terrain or completed regional solution',refinementRequirements:['Choose and commit receiving-water/valley corridors before local detail','Preserve graph connectivity and distinguish sea/lake/closed destinations','Allow subcell branching and boundary refinement within parent corridors','Do not fit every river directly onto cell-centre segments','Do not interpret missing detailed profiles as absence of rivers']};
 return {...result,id:hashJson(result)};
}

export function inspectSketchSupport(sketch,snapshot,{cell,localWidthM,localHeightM}){
 if(sketch.sourceWorldId!==snapshot.worldId||!Number.isFinite(snapshot.frame?.radiusM)||snapshot.frame.radiusM<=0||sketch.grid.columns!==snapshot.grid.columns||sketch.grid.rows!==snapshot.grid.rows||!Number.isSafeInteger(cell)||cell<0||cell>=sketch.grid.columns*sketch.grid.rows||![localWidthM,localHeightM].every(v=>Number.isFinite(v)&&v>0))throw Error('Valid same-world local support required');
 const {columns:w,rows:h}=sketch.grid,lat=90-(Math.floor(cell/w)+.5)*180/h,R=snapshot.frame.radiusM,sourceWidthM=2*Math.PI*R/w*Math.cos(lat*Math.PI/180),sourceHeightM=Math.PI*R/h;
 const node=sketch.nodes.find(v=>v.cell===cell);
 return {cell,sourceWidthM,sourceHeightM,localWidthM,localHeightM,parentToLocalWidthRatio:sourceWidthM/localWidthM,parentToLocalHeightRatio:sourceHeightM/localHeightM,destination:node?.destination??'sea',outgoing:sketch.edges.filter(e=>e.from===cell),incoming:sketch.edges.filter(e=>e.to===cell),readyForIndependentLocalCommit:false,reason:'Schematic connectivity exists, but subcell receiver locations, valley bed levels and shared divides are not committed'};
}

import {createL1WaterNetwork,clipL1WaterNetwork} from '../../src/core/l1-water-network.mjs';
import {solveRegionalDrainage} from '../../src/core/regional-drainage.mjs';
import {placeRegionalCandidate} from './place-regional-candidate.mjs';
import {conditionDrainageTerrain} from './condition-drainage-terrain.mjs';
import {classifyEnvironment} from '../../src/core/environment-cover.mjs';
import {CommittedMaterializer} from '../../src/core/committed-materialization.mjs';
import {createFileMaterializationStorage} from '../materialization-file-store.mjs';
import {hashJson,copyJson} from '../../src/core/json-contract.mjs';

/** Constrain a not-yet-committed L2 candidate to the adopted parent's channels.
 * Endpoints stay fixed. Interior routing prefers low ground in the corridor.
 * This is geometric valley construction, not geological erosion simulation. */
export function connectL2Water(parent,settings,{network=createL1WaterNetwork(parent),minFlowM3PerSecond=20,maxEarthworkM=150,boundaryAnchors=[]}={}) {
  if(network.sourceLayerId!==parent.snapshot.layerId||network.climateId!==parent.climate.id)throw Error('Water network must match L1 terrain and climate');
  if(!Number.isFinite(maxEarthworkM)||maxEarthworkM<=0||maxEarthworkM>500)throw Error('Bounded earthwork limit required');
  const r=placeRegionalCandidate(parent,settings),{columns:w,rows:h,cellSizeM:cell}=r.grid,n=w*h;
  const window=clipL1WaterNetwork(network,{...settings,columns:w,rows:h,cellSizeM:cell,minFlowM3PerSecond:0});
  window.reviewMinimumFlowM3PerSecond=minFlowM3PerSecond;
  // The review threshold selects a window, never discards its smaller inflows.
  if(!window.reaches.some(e=>e.meanPotentialFlowM3PerSecond>=minFlowM3PerSecond)||!window.crossings.some(p=>p.direction==='out'))throw Error('A resolved parent through-channel and receiving outlet are required');
  const entries=window.crossings.filter(p=>p.direction==='in');
  for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++){
    const a=entries[i].fromCell,b=entries[j].fromCell;
    if(network.tin[a]>=network.tin[b]&&network.tin[a]<network.tout[b]||network.tin[b]>=network.tin[a]&&network.tin[b]<network.tout[a])throw Error('Parent river exits and re-enters window; enlarge joint domain instead of importing twice');
  }
  if(window.reaches.some(e=>e.bedStatus!=='downhill-coarse-corridor'||e.start.elevationM<=e.end.elevationM))throw Error('Parent channel bed requires a lake or valley decision');
  // Coarse cell-centre heights bound an unresolved reach; linear interpolation
  // is NOT a surveyed riverbed. On first materialisation choose a lower valley
  // profile within the endpoint envelope and retain the resulting anchors.
  // Neighbours provide previously committed anchors, which are never moved.
  const known=new Map();
  for(const a of boundaryAnchors){if(!a||typeof a.id!=='string'||known.has(a.id)||!Number.isFinite(a.elevationM))throw Error('Unique finite committed water anchors required');known.set(a.id,a);}
  const low=Math.min(...r.elevation);
  for(const e of window.reaches){
    const a=window.crossings.find(p=>p.edgeId===e.id&&p.direction==='in'),b=window.crossings.find(p=>p.edgeId===e.id&&p.direction==='out');
    const originalDrop=e.start.elevationM-e.end.elevationM;
    let end=b?Math.max(e.to.elevationM,Math.min(e.end.elevationM,low)):e.end.elevationM;
    if(b&&known.has(b.id))end=known.get(b.id).elevationM;
    let start=a?Math.min(e.from.elevationM,end+originalDrop):e.start.elevationM;
    if(a&&known.has(a.id))start=known.get(a.id).elevationM;
    if(start<=end||start>e.from.elevationM+1e-8||end<e.to.elevationM-1e-8)throw Error('Committed water anchors conflict with parent downstream envelope');
    for(const [point,value,crossing] of [[e.start,start,a],[e.end,end,b]]){point.coarseLinearElevationM=point.elevationM;point.elevationM=value;if(crossing){crossing.coarseLinearElevationM=crossing.elevationM;crossing.elevationM=value;crossing.anchorStatus=known.has(crossing.id)?'adopted-committed':'new-proposed';}}
  }
  const neighbors=i=>{const a=[],x=i%w,y=Math.floor(i/w);for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if((dx||dy)&&x+dx>=0&&x+dx<w&&y+dy>=0&&y+dy<h)a.push(i+dy*w+dx);return a;};
  const paths=[],forced=new Map(),anchors=new Map();
  const terrain=[...r.elevation];
  for(const reach of window.reaches){
    const start=reach.start.cell,end=reach.end.cell;
    if(start===end)throw Error('Parent channel crossing is below this grid resolution');
    const sx=start%w,sy=Math.floor(start/w),ex=end%w,ey=Math.floor(end/w),dx=ex-sx,dy=ey-sy,length2=dx*dx+dy*dy;
    const t=i=>Math.max(0,Math.min(1,((i%w-sx)*dx+(Math.floor(i/w)-sy)*dy)/length2));
    const bed=i=>reach.start.elevationM+(reach.end.elevationM-reach.start.elevationM)*t(i);
    const lateral=i=>Math.abs((i%w-sx)*dy-(Math.floor(i/w)-sy)*dx)/Math.sqrt(length2);
    const corridor=Math.max(3,Math.sqrt(length2)*.18),dist=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),heap=[];
    const push=(i,d)=>{const v={i,d};heap.push(v);let k=heap.length-1;while(k){const p=(k-1)>>1;if(heap[p].d<=d)break;heap[k]=heap[p];k=p;}heap[k]=v;};
    const pop=()=>{const a=heap[0],v=heap.pop();if(heap.length){let k=0;while(2*k+1<heap.length){let j=2*k+1;if(j+1<heap.length&&heap[j+1].d<heap[j].d)j++;if(heap[j].d>=v.d)break;heap[k]=heap[j];k=j;}heap[k]=v;}return a;};
    dist[start]=0;push(start,0);
    while(heap.length){const {i,d}=pop();if(d!==dist[i])continue;if(i===end)break;for(const j of neighbors(i)){
      if(lateral(j)>corridor||t(j)<t(i)-1e-9)continue;
      const onEdge=j<w||j>=w*(h-1)||j%w===0||j%w===w-1;
      if(onEdge&&j!==start&&j!==end)continue;
      const dz=terrain[j]-bed(j),step=Math.hypot(j%w-i%w,Math.floor(j/w)-Math.floor(i/w));
      const cost=step*(1+(dz/60)**2+(lateral(j)/corridor)**2*3),nd=d+cost;
      if(nd<dist[j]){dist[j]=nd;prev[j]=i;push(j,nd);}
    }}
    if(!Number.isFinite(dist[end]))throw Error('No bounded interior parent-channel path');
    const cells=[];for(let i=end;i>=0;i=prev[i]){cells.push(i);if(i===start)break;}cells.reverse();
    const lengths=[0];for(let k=1;k<cells.length;k++)lengths.push(lengths[k-1]+Math.hypot(cells[k]%w-cells[k-1]%w,Math.floor(cells[k]/w)-Math.floor(cells[k-1]/w))*cell);
    const beds=lengths.map(d=>reach.start.elevationM+(reach.end.elevationM-reach.start.elevationM)*d/lengths.at(-1));
    for(let k=0;k<cells.length;k++){
      const i=cells[k];if(anchors.has(i)&&Math.abs(anchors.get(i)-beds[k])>1e-6)throw Error('Refined channels intersect inconsistently; enlarge joint domain');anchors.set(i,beds[k]);
      if(k<cells.length-1){const j=cells[k+1];if(forced.has(i)&&forced.get(i)!==j)throw Error('Conflicting parent-channel branches');forced.set(i,j);}
    }
    paths.push({edgeId:reach.id,cells,bedElevationM:beds,annualSupplyM3:reach.annualSupplyM3,widthPriorM:Math.max(cell,4*Math.sqrt(reach.meanPotentialFlowM3PerSecond)),valleyRadiusM:Math.max(cell*4,30*Math.sqrt(reach.meanPotentialFlowM3PerSecond)),destination:reach.destination});
  }
  // Smooth transverse valley, rather than a one-cell trench. Outside the
  // corridor the original proposed terrain is untouched by this operation.
  for(const p of paths){const radius=Math.min(Math.min(w,h)*cell*.22,p.valleyRadiusM),steps=Math.ceil(radius/cell);
    for(let k=0;k<p.cells.length;k++){const i=p.cells[k],x=i%w,y=Math.floor(i/w),bed=p.bedElevationM[k];
      for(let dy=-steps;dy<=steps;dy++)for(let dx=-steps;dx<=steps;dx++){
        if(x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;const d=Math.hypot(dx,dy)*cell;if(d>=radius)continue;
        const j=i+dy*w+dx,profile=bed+.025*d+d*d/(8*radius),weight=(1-d/radius)**2;
        if(terrain[j]>profile)terrain[j]=Math.min(terrain[j],r.elevation[j]*(1-weight)+profile*weight);
      }
    }
  }
  for(const [i,z] of anchors)terrain[i]=z;

  const supply=r.yieldMm.map(mm=>mm/1000*cell**2),sourceByCell=[];
  const s=parent.snapshot,pw=s.grid.columns,ph=s.grid.rows;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const lat=settings.latDeg+((h-1)/2-y)*r.geography.latStepDeg,lon=settings.lonDeg+(x-(w-1)/2)*r.geography.lonStepDeg;
    sourceByCell.push(Math.min(ph-1,Math.max(0,Math.floor((90-lat)/180*ph)))*pw+Math.floor(((lon%360+360)%360)/360*pw));
  }
  const localBasins=new Set(sourceByCell.map(i=>network.basinCell[i]));
  if(localBasins.size!==1||window.reaches.some(e=>!localBasins.has(e.basinCell)))throw Error('Window crosses unresolved parent watershed divide; use a masked or larger joint domain');
  const debits=[];
  const inflows=window.crossings.filter(p=>p.direction==='in').map(p=>{
    // The coarse upstream total already owns this window's rainfall where its
    // parent cell belongs to that catchment. Debit it before adding fine local
    // supply; otherwise imported flow plus local rainfall double counts it.
    let debit=0;for(let i=0;i<n;i++){const q=sourceByCell[i];if(network.tin[q]>=network.tin[p.fromCell]&&network.tin[q]<network.tout[p.fromCell])debit+=supply[i];}
    if(debit>p.annualSupplyM3+1e-6)throw Error('Fine local yield exceeds parent inflow budget');
    debits.push({portId:p.id,parentAnnualSupplyM3:p.annualSupplyM3,localYieldDebitM3:debit});
    return{id:p.id,cell:p.cell,supplyM3PerYear:Math.max(0,p.annualSupplyM3-debit)};
  });
  const outlets=window.crossings.filter(p=>p.direction==='out').map(p=>({id:p.id,cell:p.cell,kind:'river',levelM:terrain[p.cell]}));
  const prescribedReceivers=[...forced].map(([from,to])=>({from,to}));
  const initial=solveRegionalDrainage({...r.grid,elevation:terrain,localSupplyM3PerYear:supply,outlets,inflows,prescribedReceivers});
  const channelGrade=Math.min(...prescribedReceivers.map(({from,to})=>(terrain[from]-terrain[to])/(Math.hypot(from%w-to%w,Math.floor(from/w)-Math.floor(to/w))*cell)));
  const conditioned=conditionDrainageTerrain({elevation:terrain,receiver:initial.receiver,columns:w,cellSizeM:cell,minGrade:Math.min(.0001,channelGrade*.1),fixed:[...anchors].map(([cell,elevationM])=>({cell,elevationM}))});
  for(let i=0;i<n;i++)terrain[i]=conditioned.elevation[i];
  let maxCutM=0,maxRaiseM=0;for(let i=0;i<n;i++){maxCutM=Math.max(maxCutM,r.elevation[i]-terrain[i]);maxRaiseM=Math.max(maxRaiseM,terrain[i]-r.elevation[i]);}
  if(Math.max(maxCutM,maxRaiseM)>maxEarthworkM)throw Error(`Parent valley exceeds earthwork limit: cut ${maxCutM.toFixed(1)} m, raise ${maxRaiseM.toFixed(1)} m`);
  const drainage=solveRegionalDrainage({...r.grid,elevation:terrain,localSupplyM3PerYear:supply,outlets,inflows,prescribedReceivers});
  // Every imported branch must reach a declared receiver; no independent
  // rectangle-edge escape is allowed. Diagnose retained local depressions.
  const routes=inflows.map(p=>{let i=p.cell,steps=0;while(drainage.receiver[i]>=0){i=drainage.receiver[i];if(++steps>n)throw Error('Water route cycle');}return{inletId:p.id,outletId:outlets.find(o=>o.cell===i)?.id,steps};});
  if(routes.some(p=>!p.outletId))throw Error('Imported water has no declared downstream receiver');
  const temperatureC=r.temperatureC.map((t,i)=>t-.0065*(terrain[i]-r.elevation[i]));
  const cover=terrain.map((z,i)=>{
    const x=i%w,y=Math.floor(i/w),dx=(terrain[y*w+Math.min(w-1,x+1)]-terrain[y*w+Math.max(0,x-1)])/(cell*(x===0||x===w-1?1:2)),dy=(terrain[Math.min(h-1,y+1)*w+x]-terrain[Math.max(0,y-1)*w+x])/(cell*(y===0||y===h-1?1:2));
    let nearest=-1,distance=Infinity;for(const p of paths)for(const j of p.cells){const d=Math.hypot(x-j%w,y-Math.floor(j/w))*cell;if(d<distance){distance=d;nearest=j;}}
    return classifyEnvironment({biome:parent.climate.biome[sourceByCell[i]],temperatureC:temperatureC[i],annualRainMm:r.rainMm[i],soilMoisture:r.soilMoisture[i],slopeMPerM:Math.hypot(dx,dy),riverDistanceM:distance,heightAboveRiverM:z-terrain[nearest]});
  });
  return{...r,temperatureC,cover,schema:'l2-parent-water-trial@4',id:hashJson({sourceLayerId:s.layerId,climateId:parent.climate.id,settings:copyJson(settings),minFlowM3PerSecond,maxEarthworkM,boundaryAnchors:copyJson(boundaryAnchors),method:'constrained-water@4'}),elevation:terrain,drainage,conditioning:conditioned.diagnostics,diagnostics:{...drainage.diagnostics,importedSupplyM3PerYear:inflows.reduce((sum,p)=>sum+p.supplyM3PerYear,0),localSupplyM3PerYear:supply.reduce((a,b)=>a+b,0),maxCutM,maxRaiseM},parentWater:{networkId:network.id,window,paths,inflows,boundaryAnchors:window.crossings.map(p=>({id:p.id,edgeId:p.edgeId,t:p.t,elevationM:p.elevationM,latDeg:p.latDeg,lonDeg:p.lonDeg})),localYieldDebits:debits,routes},valleyConstruction:{maxCutM,maxRaiseM,method:'parent-bounded first-use bed anchors; corridor paths, transverse valley and tributary conditioning',tributaryConditioning:conditioned.diagnostics},limits:['Parent water topology and exact geographic crossings retained; raster endpoints are snapped','Throughflow uses annual potential yield with local-yield debit, not seasonal hydraulics','Channel width and valley shape are explicit uncalibrated priors','Depression routing heads are not automatically physical lakes','All land in this bounded trial drains to its adopted river exits; unresolved neighbouring divides may require a larger joint domain','Previous L0 refinement topology and new coastline climate remain unresolved','No settlement placement or physical water-surface simulation']};
}

export async function saveConnectedL2Water(parent,settings,directory,{entityId='L2-water-region',...options}={}) {
  const store=new CommittedMaterializer(createFileMaterializationStorage(directory));
  const {network,...conditions}=options;
  if(network&&(network.sourceLayerId!==parent.snapshot.layerId||network.climateId!==parent.climate.id))throw Error('Water network must match saved parent');
  return store.resolve({worldId:parent.snapshot.worldId,entityId,conditions:{sourceLayerId:parent.snapshot.layerId,climateId:parent.climate.id,settings,waterOptions:conditions},generator:'l2-parent-water-trial@4',generate:()=>connectL2Water(parent,settings,options)});
}

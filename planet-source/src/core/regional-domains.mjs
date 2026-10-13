import {hashJson} from './json-contract.mjs';
import {describeL0Region} from './planet-macro.mjs';

/** Hydrologic WORK domains on the saved L0 support, not final local terrain.
 * Merge upstream subtrees while an area/relief budget permits. Cuts share one
 * directed port. The cell footprint is coarse evidence, not a surveyed divide.
 * No camera parameter, random draws, or regeneration of the parent world.
 */
export function planRegionalDomains(snapshot, climate, {maxAreaKm2=750000,maxReliefM=1800,mergeCoastal=true}={}) {
 const {columns:w,rows:h}=snapshot.grid,n=w*h;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<3||h<2||n>32768||
    !Number.isFinite(maxAreaKm2)||maxAreaKm2<=0||!Number.isFinite(maxReliefM)||maxReliefM<=0||typeof mergeCoastal!=='boolean')
  throw new RangeError('Bounded regional planning inputs required');
 describeL0Region(snapshot,climate,[0]);
 const z=snapshot.fields.groundElevationM,land=snapshot.fields.landMask,down=snapshot.fields.downstream,
   area=climate.cellAreaM2,yieldMm=climate.catchmentWater?.annualLocalYieldMm;
 for(const a of [z,land,down,area,yieldMm])if(!Array.isArray(a)||a.length!==n)throw new RangeError('Matching source fields required');
 if(!z.every(Number.isFinite)||!area.every(v=>Number.isFinite(v)&&v>0)||!yieldMm.every(v=>Number.isFinite(v)&&v>=0)||
    !land.every(v=>v===0||v===1)||!down.every((v,i)=>Number.isSafeInteger(v)&&v>=-1&&v<n&&v!==i))throw new RangeError('Invalid source fields');
 const incoming=Array.from({length:n},()=>[]),degree=new Uint32Array(n),order=[];
 for(let i=0;i<n;i++)if(land[i]&&down[i]>=0&&land[down[i]]){
  const j=down[i],dx=Math.abs(i%w-j%w),dy=Math.abs(Math.floor(i/w)-Math.floor(j/w));
  if(dy>1||Math.min(dx,w-dx)>1)throw new RangeError('Non-neighbour source receiver');
  incoming[j].push(i);degree[j]++;
 }
 for(let i=0;i<n;i++)if(land[i]&&!degree[i])order.push(i);
 for(let k=0;k<order.length;k++){const q=down[order[k]];if(q>=0&&land[q]&&!--degree[q])order.push(q);}
 const landCount=land.reduce((s,v)=>s+v,0);
 if(order.length!==landCount)throw new RangeError('Cyclic source drainage');
 const lakeAt=new Map();for(const lake of snapshot.references.lakes??[])for(const i of lake.cells)lakeAt.set(i,lake.id);
 const destination=Array(n).fill(null);
 for(let k=order.length-1;k>=0;k--){const i=order[k],q=down[i];destination[i]=q>=0&&land[q]?destination[q]:q>=0?`sea:${q}`:lakeAt.has(i)?lakeAt.get(i):`closed:${i}`;}
 const groups=new Map(),parent=Int32Array.from({length:n},(_,i)=>i),groupAt=new Int32Array(n).fill(-1),upstreamVolume=Array(n).fill(0);
 const root=i=>{let r=i;while(parent[r]!==r)r=parent[r];while(parent[i]!==i){const next=parent[i];parent[i]=r;i=next;}return r;};
 const maxAreaM2=maxAreaKm2*1e6;
 for(const i of order){
  const own=area[i]*yieldMm[i]/1000;
  upstreamVolume[i]=own+incoming[i].reduce((s,j)=>s+upstreamVolume[j],0);
  const group={outletCell:i,cells:[],areaM2:area[i],minM:z[i],maxM:z[i],cuts:[]};
  // Larger upstream pieces get priority; ties are stable, unrelated to view order.
  const candidates=incoming[i].map(j=>groups.get(j)).sort((a,b)=>b.areaM2-a.areaM2||a.outletCell-b.outletCell);
  for(const child of candidates){
   const min=Math.min(group.minM,child.minM),max=Math.max(group.maxM,child.maxM);
   if(group.areaM2+child.areaM2<=maxAreaM2&&max-min<=maxReliefM){
    parent[child.outletCell]=i;group.areaM2+=child.areaM2;group.minM=min;group.maxM=max;
    groups.delete(child.outletCell);
   }else group.cuts.push(child.outletCell);
  }
  groups.set(i,group);
 }
 for(const i of order){groupAt[i]=root(i);groups.get(groupAt[i]).cells.push(i);}
 // Small independent coastal catchments may share a work domain without
 // becoming one river basin. Preserve every original sea exit. Never merge
 // terminal lakes with marine catchments, or manufacture a drainage connection.
 if(mergeCoastal){
  const eligible=g=>g.cells.every(i=>destination[i]?.startsWith('sea:'));
  const adjacent=[];for(let i=0;i<n;i++)if(land[i])for(const j of [Math.floor(i/w)*w+(i%w+1)%w,...(i+w<n?[i+w]:[])])if(land[j]&&groupAt[i]!==groupAt[j])adjacent.push([i,j]);
  for(const [i,j] of adjacent){const a=root(i),b=root(j);if(a===b)continue;const A=groups.get(a),B=groups.get(b);if(!eligible(A)||!eligible(B)||A.areaM2+B.areaM2>maxAreaM2||Math.max(A.maxM,B.maxM)-Math.min(A.minM,B.minM)>maxReliefM)continue;
   // Only complete coastal pieces: no external downstream region would be
   // swallowed into a group with a second upstream/downstream route.
   if([A,B].some(g=>g.cells.some(k=>down[k]>=0&&land[down[k]]&&root(down[k])!==root(k))))continue;
   const keep=Math.min(a,b),drop=Math.max(a,b),K=groups.get(keep),D=groups.get(drop);parent[drop]=keep;K.cells.push(...D.cells);K.areaM2+=D.areaM2;K.minM=Math.min(K.minM,D.minM);K.maxM=Math.max(K.maxM,D.maxM);groups.delete(drop);
  }
  for(const i of order)groupAt[i]=root(i);
 }
 const geometryId=hashJson({worldId:snapshot.worldId,method:'drainage-work-domains@1',maxAreaKm2,maxReliefM,mergeCoastal});
 const prefix=`region:${geometryId.slice(7,19)}:`,regions=[...groups.values()].sort((a,b)=>a.outletCell-b.outletCell).map(g=>{
  g.cells.sort((a,b)=>a-b);
  return{id:prefix+g.outletCell,outletCell:g.outletCell,receivers:[...new Set(g.cells.map(i=>destination[i]))].sort(),
   cellIndices:g.cells,areaM2:g.areaM2,reliefM:g.maxM-g.minM,
   exceedsAreaBudget:g.areaM2>maxAreaM2,conditions:describeL0Region(snapshot,climate,g.cells),
   localPotentialYieldM3PerYear:g.cells.reduce((s,i)=>s+area[i]*yieldMm[i]/1000,0),
   incomingPortIds:[],outgoingPortIds:[]};
 });
 const byId=new Map(regions.map(r=>[r.id,r])),ports=[];
 for(const i of order){const j=down[i];if(j>=0&&land[j]&&groupAt[i]===groupAt[j])continue;
  const from=prefix+groupAt[i],to=j>=0&&land[j]?prefix+groupAt[j]:null,id=`flow:${geometryId.slice(7,19)}:${i}:${j}`;
  const point=cell=>({latDeg:90-(Math.floor(cell/w)+.5)*180/h,lonDeg:(cell%w+.5)*360/w});
  const p={id,fromRegionId:from,toRegionId:to,fromCell:i,toCell:j,
   receiver:destination[i],potentialYieldM3PerYear:upstreamVolume[i],
   corridor:{from:point(i),to:j>=0?point(j):null,status:'coarse cell-to-cell corridor; exact crossing unresolved'},
   waterLevelM:null,waterLevelStatus:'unresolved; do not infer from raw ground height'};
  ports.push(p);byId.get(from).outgoingPortIds.push(id);if(to)byId.get(to).incomingPortIds.push(id);
 }
 const portById=new Map(ports.map(p=>[p.id,p]));let maxRelativeBudgetResidual=0;
 for(const r of regions){const input=r.localPotentialYieldM3PerYear+r.incomingPortIds.reduce((s,id)=>s+portById.get(id).potentialYieldM3PerYear,0),out=r.outgoingPortIds.reduce((s,id)=>s+portById.get(id).potentialYieldM3PerYear,0);r.potentialYieldResidualM3PerYear=input-out;maxRelativeBudgetResidual=Math.max(maxRelativeBudgetResidual,Math.abs(input-out)/Math.max(1,input));}
 // Neighbour contact IDs are owned by the pair, never by the region generated first.
 const contacts=new Map();
 for(let i=0;i<n;i++)if(land[i])for(const j of [(Math.floor(i/w))*w+(i%w+1)%w,...(i+w<n?[i+w]:[])])if(land[j]&&groupAt[i]!==groupAt[j]){
  const pair=[groupAt[i],groupAt[j]].sort((a,b)=>a-b),key=pair.join(':'),c=contacts.get(key)??{id:`boundary:${geometryId.slice(7,19)}:${key}`,regions:pair.map(x=>prefix+x),cellFacePairs:[],status:'coarse contact; fine boundary not yet committed'};c.cellFacePairs.push([i,j]);contacts.set(key,c);
 }
 const indexByOutlet=new Map(regions.map((r,i)=>[r.outletCell,i]));
 return{schema:'regional-domain-plan@1',id:hashJson({geometryId,climateId:climate.id}),geometryId,sourceWorldId:snapshot.worldId,climateId:climate.id,grid:{columns:w,rows:h},settings:{maxAreaKm2,maxReliefM,mergeCoastal},
  regionIndexByCell:Array.from(groupAt,i=>i<0?-1:indexByOutlet.get(i)),regions,ports,contacts:[...contacts.values()],
  diagnostics:{landCells:landCount,assignedCells:regions.reduce((s,r)=>s+r.cellIndices.length,0),regionCount:regions.length,portCount:ports.length,maxRelativeBudgetResidual,
   oversizedSourceCells:regions.filter(r=>r.exceedsAreaBudget).length},
  limits:['L0 source support only: no finer terrain generated','area and relief limits are work budgets, not fixed kilometre layers','potential water supply is not observed river flow','terminal lakes retain their saved static water scenario','neighbour geometry and exact river crossings must be committed before local generation','work domains are not rendering tiles, political territories, or settlement zones']};
}

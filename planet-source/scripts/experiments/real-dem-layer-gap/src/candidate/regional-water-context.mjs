import {copyJson,hashJson} from './json-contract.mjs';

/** One resolved intermediate neighbourhood, shared by all finer views.
 * Window boundaries never become drainage outlets or new generation seeds.
 * This is inheritance of existing geometry, not new fine-scale hydrology. */
export function createRegionalWaterContext(record){
 const {grid:g,elevation:z,drainage:d}=record??{};
 const n=g?.columns*g?.rows,dy=g?.cellSizeYM??g?.cellSizeM;
 if(!Number.isSafeInteger(g?.columns)||!Number.isSafeInteger(g?.rows)||!Number.isSafeInteger(n)||n>65536||g.columns<3||g.rows<3||!Number.isFinite(g.cellSizeM)||g.cellSizeM<=0||!Number.isFinite(dy)||dy<=0||z?.length!==n||!z.every(Number.isFinite)||d?.receiver?.length!==n||d.routedSupplyM3PerYear?.length!==n||!d.routedSupplyM3PerYear.every(v=>Number.isFinite(v)&&v>=0))throw Error('Bounded resolved intermediate terrain and drainage required');
 const degree=new Uint32Array(n),queue=[];
 for(let i=0;i<n;i++){const j=d.receiver[i];if(!Number.isSafeInteger(j)||j< -1||j>=n||j===i||j>=0&&(Math.abs(i%g.columns-j%g.columns)>1||Math.abs(Math.floor(i/g.columns)-Math.floor(j/g.columns))>1))throw Error('Adjacent intermediate drainage required');if(j>=0)degree[j]++;}
 for(let i=0;i<n;i++)if(!degree[i])queue.push(i);
 for(let k=0;k<queue.length;k++){const j=d.receiver[queue[k]];if(j>=0&&!--degree[j])queue.push(j);}
 if(queue.length!==n)throw Error('Cyclic intermediate drainage');
 if(!Array.isArray(d.outlets)||!d.outlets.length)throw Error('Declared drainage roots required');
 const outletIds=new Set(),outletCells=new Set();
 for(const o of d.outlets){
  if(!o||typeof o.id!=='string'||!o.id||outletIds.has(o.id)||!Number.isSafeInteger(o.cell)||o.cell<0||o.cell>=n||outletCells.has(o.cell)||d.receiver[o.cell]!==-1||!Number.isFinite(o.levelM)||o.levelM<z[o.cell]||!['sea','lake','river','terminal','open-boundary'].includes(o.kind))throw Error('Valid unique root outlets required');
  if(o.supplyM3PerYear!==undefined&&(!Number.isFinite(o.supplyM3PerYear)||Math.abs(o.supplyM3PerYear-d.routedSupplyM3PerYear[o.cell])>1e-9*Math.max(1,d.routedSupplyM3PerYear[o.cell])))throw Error('Outlet supply disagrees with routed flow');
  outletIds.add(o.id);outletCells.add(o.cell);
 }
 for(let i=0;i<n;i++)if(d.receiver[i]===-1&&!outletCells.has(i))throw Error('Every root requires a declared outlet');
 const ownership=record.supplyOwnership??d.supplyOwnership;
 if(ownership){
  if(!Array.isArray(ownership.localSupplyM3PerYear)||ownership.localSupplyM3PerYear.length!==n||!ownership.localSupplyM3PerYear.every(v=>Number.isFinite(v)&&v>=0)||!Array.isArray(ownership.inflows))throw Error('Invalid explicit supply ownership');
  const expected=[...ownership.localSupplyM3PerYear],ids=new Set();
  for(const p of ownership.inflows){if(!p||typeof p.id!=='string'||!p.id||ids.has(p.id)||!Number.isSafeInteger(p.cell)||p.cell<0||p.cell>=n||!Number.isFinite(p.supplyM3PerYear)||p.supplyM3PerYear<0)throw Error('Invalid inherited inlet');ids.add(p.id);expected[p.cell]+=p.supplyM3PerYear;}
  const recovered=[...d.routedSupplyM3PerYear];for(let i=0;i<n;i++)if(d.receiver[i]>=0)recovered[d.receiver[i]]-=d.routedSupplyM3PerYear[i];
  for(let i=0;i<n;i++)if(Math.abs(recovered[i]-expected[i])>1e-7*Math.max(1,d.routedSupplyM3PerYear[i]))throw Error('Supply ownership does not match routed budget');
 }
 const content=copyJson({...(ownership?{supplyOwnership:ownership}:{}),sourceWorldId:record.sourceWorldId??null,sourceLayerId:record.sourceLayerId??null,geography:record.geography??null,grid:{columns:g.columns,rows:g.rows,cellSizeM:g.cellSizeM,cellSizeYM:dy},elevation:z,receiver:d.receiver,annualFlowM3:d.routedSupplyM3PerYear,outlets:d.outlets??[],status:d.status??'routing-only'});
 return{schema:'regional-water-context@1',id:hashJson(content),...content};
}
const rounded=v=>Math.round(v*1e6)/1e6;
function clip(a,b,box){
 let lo=0,hi=1;const dx=b.xM-a.xM,dy=b.yM-a.yM;
 for(const [p,q] of [[-dx,a.xM-box.x0M],[dx,box.x0M+box.widthM-a.xM],[-dy,a.yM-box.y0M],[dy,box.y0M+box.heightM-a.yM]]){
  if(p===0){if(q<0)return null;continue;}const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);if(lo>hi)return null;
 }
 return hi-lo>1e-12?[lo,hi]:null;
}

/** Arbitrary physical windows of the SAME context; samples can be finer than
 * the source, but interpolation is explicitly recorded. River flow is inherited
 * from the whole context, not recomputed on a cropped rectangle. */
export function regionalWaterWindow(context,settings){
 if(context?.schema!=='regional-water-context@1')throw Error('Intermediate water context required');
 const {schema,id,...content}=context;if(hashJson(copyJson(content))!==id)throw Error('Intermediate context content changed');
 const {x0M,y0M,widthM,heightM,cellSizeM}=settings??{},g=context.grid;
 const maxX=(g.columns-1)*g.cellSizeM,maxY=(g.rows-1)*g.cellSizeYM;
 if(![x0M,y0M,widthM,heightM,cellSizeM].every(Number.isFinite)||x0M<0||y0M<0||widthM<=0||heightM<=0||cellSizeM<=0||x0M+widthM>maxX||y0M+heightM>maxY)throw Error('Window must lie inside shared intermediate context');
 const w=Math.ceil(widthM/cellSizeM)+1,h=Math.ceil(heightM/cellSizeM)+1;
 if(w*h>65536)throw Error('Window exceeds sample budget');
 const dx=widthM/(w-1),dy=heightM/(h-1);
 const sample=(x,y)=>{const gx=x/g.cellSizeM,gy=y/g.cellSizeYM,ix=Math.min(g.columns-2,Math.floor(gx)),iy=Math.min(g.rows-2,Math.floor(gy)),u=gx-ix,v=gy-iy,i=iy*g.columns+ix,z=context.elevation;return z[i]*(1-u)*(1-v)+z[i+1]*u*(1-v)+z[i+g.columns]*(1-u)*v+z[i+g.columns+1]*u*v;};
 const elevation=[];for(let y=0;y<h;y++)for(let x=0;x<w;x++)elevation.push(sample(x0M+x*dx,y0M+y*dy));
 const point=i=>({xM:i%g.columns*g.cellSizeM,yM:Math.floor(i/g.columns)*g.cellSizeYM,elevationM:context.elevation[i]});
 const reaches=[],ports=[];
 for(let i=0;i<context.receiver.length;i++){
  const j=context.receiver[i];if(j<0)continue;const a=point(i),b=point(j),interval=clip(a,b,settings);if(!interval)continue;
  const edgeId=`${context.id}/edge/${i}/${j}`;
  const at=t=>({xM:rounded(a.xM+(b.xM-a.xM)*t),yM:rounded(a.yM+(b.yM-a.yM)*t),parentProfileElevationM:a.elevationM+(b.elevationM-a.elevationM)*t});
  const [lo,hi]=interval,start=at(lo),end=at(hi),flow=context.annualFlowM3[i];
  if(lo===0)start.nodeId=`${context.id}/node/${i}`;if(hi===1)end.nodeId=`${context.id}/node/${j}`;
  reaches.push({id:edgeId,fromCell:i,toCell:j,start,end,annualFlowM3:flow});
  for(const [t,p,direction] of [[lo,start,'in'],[hi,end,'out']])if(t>1e-12&&t<1-1e-12){const boundarySides=[];if(b.xM!==a.xM){if(Math.abs(p.xM-x0M)<1e-5)boundarySides.push('west');if(Math.abs(p.xM-x0M-widthM)<1e-5)boundarySides.push('east');}if(b.yM!==a.yM){if(Math.abs(p.yM-y0M)<1e-5)boundarySides.push('north');if(Math.abs(p.yM-y0M-heightM)<1e-5)boundarySides.push('south');}ports.push({id:`${edgeId}/at/${p.xM}/${p.yM}`,edgeId,...p,direction,boundarySides,annualFlowM3:flow});}
 }
 const body={contextId:context.id,settings:copyJson(settings),grid:{columns:w,rows:h,cellSizeM:dx,cellSizeYM:dy},elevation,reaches,ports,sourceSpacingM:{x:g.cellSizeM,y:g.cellSizeYM},interpolated:dx<g.cellSizeM||dy<g.cellSizeYM,upstreamStatus:context.status};
 return{schema:'regional-water-window@1',id:hashJson(body),...body,limits:['Finer samples interpolate the shared source; no invented subcell relief','Water graph and annual flow are inherited from the whole context','Parent profile elevation is a routing reference, not an excavated fine riverbed','No local rerouting, bank width, hydraulic water surface or new tributaries','Outer unresolved context outlets remain unresolved; internal window cuts are not outlets','Boundary ports describe edge-interior crossings; vertices on a boundary remain shared graph nodes']};
}

/** Uses the existing atomic persistent store. Revisiting cannot regenerate a
 * window under different parent conditions; that requires an explicit migration. */
export async function saveRegionalWaterWindow(store,context,settings,entityId){
 if(!context.sourceWorldId)throw Error('Persistent window requires world identity');
 return store.resolve({worldId:context.sourceWorldId,entityId,conditions:{contextId:context.id,settings:copyJson(settings)},generator:'regional-water-window@1',generate:()=>regionalWaterWindow(context,settings)});
}

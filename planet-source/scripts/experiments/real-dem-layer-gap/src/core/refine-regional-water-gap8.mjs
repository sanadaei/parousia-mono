import{createRegionalWaterContext,regionalWaterWindow}from'./regional-water-context.mjs';
import{solveRegionalDrainage}from'./regional-drainage.mjs';
import{hashJson}from'./json-contract.mjs';

/** Refine a jointly solved intermediate domain without inventing new exits.
 * Parent drainage destinations and annual budgets are hard conditions. Interior
 * fine receivers are recomputed, not obtained by subdividing the old lines.
 * Catchment membership currently uses nearest parent samples: an explicit
 * conservative first implementation, not a physically refined watershed divide. */
export function refineRegionalWater(parent,{factor=2,elevation=null}={}){
 const g=parent?.grid;
 if(!g||!Number.isSafeInteger(factor)||factor<2||factor>8)throw Error('Refinement factor must be 2 to 8');
 const w=(g.columns-1)*factor+1,h=(g.rows-1)*factor+1,n=w*h,pn=g.columns*g.rows;
 if(n>65536)throw Error('Refinement exceeds bounded joint-domain budget');
 // Validates parent identity and obtains the default shared interpolation.
 regionalWaterWindow(parent,{x0M:0,y0M:0,widthM:(g.columns-1)*g.cellSizeM,heightM:(g.rows-1)*g.cellSizeYM,cellSizeM:Math.max(g.cellSizeM,g.cellSizeYM)});
 // Rectangular metric samples need not have the same x/y spacing.
 const sample=(x,y)=>{const px=x/factor,py=y/factor,ix=Math.min(g.columns-2,Math.floor(px)),iy=Math.min(g.rows-2,Math.floor(py)),u=px-ix,v=py-iy,i=iy*g.columns+ix,z=parent.elevation;return z[i]*(1-u)*(1-v)+z[i+1]*u*(1-v)+z[i+g.columns]*(1-u)*v+z[i+g.columns+1]*u*v;};
 const z=elevation??Array.from({length:n},(_,i)=>sample(i%w,Math.floor(i/w)));
 if(!Array.isArray(z)||z.length!==n||!z.every(v=>Number.isFinite(v)&&Math.abs(v)<1e7))throw Error('Finite bounded fine terrain required');
 for(let i=0;i<pn;i++)if(Math.abs(z[Math.floor(i/g.columns)*factor*w+(i%g.columns)*factor]-parent.elevation[i])>1e-7)throw Error('Fine terrain moved an adopted parent sample');
 const root=new Int32Array(pn).fill(-1),local=[...parent.annualFlowM3];
 for(let i=0;i<pn;i++){const j=parent.receiver[i];if(j>=0)local[j]-=parent.annualFlowM3[i];}
 for(let i=0;i<pn;i++){if(local[i]< -1e-7*Math.max(1,parent.annualFlowM3[i]))throw Error('Parent annual water budget is inconsistent');local[i]=Math.max(0,local[i]);let j=i,path=[];while(root[j]<0&&parent.receiver[j]>=0){path.push(j);j=parent.receiver[j];}const end=root[j]>=0?root[j]:j;root[j]=end;for(const k of path)root[k]=end;}
 const owner=new Int32Array(n),weights=new Float64Array(n),sumWeight=new Float64Array(pn),groups=new Map();
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x,p=Math.round(y/factor)*g.columns+Math.round(x/factor),r=root[p];owner[i]=p;weights[i]=(x===0||x===w-1?.5:1)*(y===0||y===h-1?.5:1);sumWeight[p]+=weights[i];if(!groups.has(r))groups.set(r,[]);groups.get(r).push(i);}
 const receiver=Array(n).fill(-1),flow=Array(n).fill(0),head=[...z],fill=Array(n).fill(0),outletCell=Array(n).fill(-1),outlets=[],budgets=[];
 let depressionCells=0,maxRoutingFillM=0,totalInput=0,totalOutput=0;
 const padded=(lo,hi,max)=>{while(hi-lo+1<3){if(lo>0)lo--;else hi++;}return[lo,Math.min(max-1,hi)];};
 for(const [r,cells] of groups){
  let x0=w,x1=0,y0=h,y1=0;for(const i of cells){x0=Math.min(x0,i%w);x1=Math.max(x1,i%w);y0=Math.min(y0,Math.floor(i/w));y1=Math.max(y1,Math.floor(i/w));}
  [x0,x1]=padded(x0,x1,w);[y0,y1]=padded(y0,y1,h);const cw=x1-x0+1,ch=y1-y0+1,cn=cw*ch,mask=Array(cn).fill(0),terrain=Array(cn).fill(0),supply=Array(cn).fill(0),global=i=>(Math.floor(i/cw)+y0)*w+i%cw+x0,at=i=>(Math.floor(i/w)-y0)*cw+i%w-x0;
  for(let i=0;i<cn;i++)terrain[i]=z[global(i)];
  for(const i of cells){const j=at(i);mask[j]=1;supply[j]=local[owner[i]]*weights[i]/sumWeight[owner[i]];}
  const endpoint=Math.floor(r/g.columns)*factor*w+(r%g.columns)*factor,old=parent.outlets.find(o=>o.cell===r);
  if(!old)throw Error('Parent receiver has no declared destination');
  const outlet={id:old.id,cell:at(endpoint),kind:old.kind,levelM:Math.max(z[endpoint],old.levelM)};
  const solved=solveRegionalDrainage({columns:cw,rows:ch,cellSizeM:g.cellSizeM/factor,cellSizeYM:g.cellSizeYM/factor,elevation:terrain,activeMask:mask,localSupplyM3PerYear:supply,outlets:[outlet]});
  for(const i of cells){const j=at(i);receiver[i]=solved.receiver[j]<0?-1:global(solved.receiver[j]);flow[i]=solved.routedSupplyM3PerYear[j];head[i]=solved.routingHeadM[j];fill[i]=solved.routingFillM[j];outletCell[i]=endpoint;}
  const amount=solved.outlets[0].supplyM3PerYear,expected=parent.annualFlowM3[r],residual=Math.abs(amount-expected)/Math.max(1,expected);
  if(residual>1e-9)throw Error('Refinement changed an inherited outlet budget');
  outlets.push({...old,cell:endpoint,levelM:outlet.levelM,supplyM3PerYear:amount});budgets.push({id:old.id,parentCell:r,fineCell:endpoint,parentAnnualM3:expected,fineAnnualM3:amount,relativeResidual:residual});
  depressionCells+=solved.diagnostics.depressionCells;maxRoutingFillM=Math.max(maxRoutingFillM,solved.diagnostics.maxRoutingFillM);totalInput+=solved.diagnostics.totalInputM3PerYear;totalOutput+=amount;
 }
 const drainage={receiver,routedSupplyM3PerYear:flow,routingHeadM:head,routingFillM:fill,outletCell,outlets,status:parent.status==='partial-survey-routing-only'?'partial-survey-routing-only':depressionCells?'routing-only-depressions-need-water-model':'routing-only',diagnostics:{totalInputM3PerYear:totalInput,totalOutputM3PerYear:totalOutput,relativeBudgetResidual:Math.abs(totalInput-totalOutput)/Math.max(1,totalInput),depressionCells,maxRoutingFillM}};
 const context=createRegionalWaterContext({sourceWorldId:parent.sourceWorldId,sourceLayerId:parent.sourceLayerId,geography:parent.geography,grid:{columns:w,rows:h,cellSizeM:g.cellSizeM/factor,cellSizeYM:g.cellSizeYM/factor},elevation:z,drainage});
 return{schema:'inherited-water-refinement@1',id:hashJson({parentId:parent.id,contextId:context.id,factor}),parentId:parent.id,context,drainage,budgets,factor,terrainMode:elevation?'supplied-parent-anchored-surface':'parent-interpolation',limits:['Parent outlet identity and annual budgets are preserved','Fine drainage is recomputed inside inherited catchments','Catchment divides are nearest-parent membership and remain provisional at subcell scale','Combined parent source budget is redistributed; this does not invent fine rainfall data','Routing fill is not ground or a physical lake','The outer context remains unresolved if the parent was unresolved','No new terrain is added when using interpolation; independently generated adjacent contexts are not certified']};
}

export async function saveRegionalWaterRefinement(store,parent,options,entityId){
 if(!parent.sourceWorldId)throw Error('Persistent refinement requires world identity');
 return store.resolve({worldId:parent.sourceWorldId,entityId,conditions:{parentId:parent.id,options:options??{}},generator:'inherited-water-refinement@1',generate:()=>refineRegionalWater(parent,options)});
}

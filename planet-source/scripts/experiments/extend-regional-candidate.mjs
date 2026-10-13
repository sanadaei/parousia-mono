import {placeRegionalCandidate} from './place-regional-candidate.mjs';
import {solveRegionalDrainage} from '../../src/core/regional-drainage.mjs';
import {conditionDrainageTerrain} from './condition-drainage-terrain.mjs';

/** NOT APPROVED FOR WORLD ADOPTION: tested outputs show boundary-hugging streams.
 * Kept as a reproducible negative experiment, not a production extension API.
 * Experimental eastward extension of a committed inland trial.
 * Existing ground and interior flow directions are immutable. Only explicitly
 * unresolved outlets on the shared edge may receive a downstream continuation.
 * Reject cycles or incompatible anchors rather than rewriting the old region.
 */
export function extendRegionalCandidate(parent,old,{seed,columns=96,maxAdjustmentM=40}={}) {
 const ow=old.grid.columns,h=old.grid.rows,cell=old.grid.cellSizeM,w=ow+columns-1,n=w*h;
 if(old.sourceWorldId!==parent.snapshot.worldId||old.climateId!==parent.climate.id||!Number.isSafeInteger(columns)||columns<24||n>65536||!Number.isFinite(maxAdjustmentM)||maxAdjustmentM<=0)throw Error('Bounded matching extension required');
 const settings={...old.settings,seed,columns,rows:h,lonDeg:old.geography.lonDeg+(ow+columns-2)/2*old.geography.lonStepDeg};
 const candidate=placeRegionalCandidate(parent,settings);
 const elevation=[],supply=[],fixed=[];let maxBoundaryBlendM=0;
 // Blend ONLY the proposed side to the immutable shared height profile.
 // Interior candidate structure remains untouched beyond this narrow band.
 const band=Math.min(columns-1,Math.max(4,Math.round(columns*.4)));
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x;
  if(x<ow){const j=y*ow+x;elevation.push(old.elevation[j]);supply.push(old.yieldMm[j]/1000*cell**2);fixed.push({cell:i,elevationM:old.elevation[j]});}
  else {const xx=x-ow+1,j=y*columns+xx,t=Math.min(1,xx/band),weight=1-3*t*t+2*t*t*t,delta=old.elevation[y*ow+ow-1]-candidate.elevation[y*columns];maxBoundaryBlendM=Math.max(maxBoundaryBlendM,Math.abs(delta*weight));elevation.push(candidate.elevation[j]+delta*weight);supply.push(candidate.yieldMm[j]/1000*cell**2);}
 }
 const mapOld=i=>Math.floor(i/ow)*w+i%ow;
 // Solve the proposed side separately. An old boundary may receive new water
 // only if its existing path already ends outside this unresolved shared edge.
 // This prevents A -> B -> A cycles without moving any old channel.
 const nw=columns-1,newElevation=[],newSupply=[],newOutlets=[],returnToOld=new Map(),continueOld=new Map();
 for(let y=0;y<h;y++)for(let x=0;x<nw;x++){
  const i=y*nw+x,global=y*w+ow+x,z=elevation[global];newElevation.push(z);newSupply.push(supply[global]);
  if(y===0||y===h-1||x===nw-1)newOutlets.push({id:`external:${i}`,cell:i,kind:'open-boundary',levelM:z});
 }
 for(let y=1;y<h-1;y++){
  const oldCell=y*ow+ow-1,i=y*nw,root=old.drainage.outletCell[oldCell],rootY=Math.floor(root/ow),rootX=root%ow;
  if(old.drainage.receiver[oldCell]<0){
   newElevation[i]=Math.min(newElevation[i],old.elevation[oldCell]-.001*cell);continueOld.set(oldCell,i);
  } else if(rootX!==ow-1||rootY===0||rootY===h-1){
   newElevation[i]=Math.max(newElevation[i],old.elevation[oldCell]+.001*cell);
   newOutlets.push({id:`existing-receiver:${oldCell}`,cell:i,kind:'river',levelM:newElevation[i]});returnToOld.set(i,oldCell);
  }
 }
 const next=solveRegionalDrainage({columns:nw,rows:h,cellSizeM:cell,elevation:newElevation,localSupplyM3PerYear:newSupply,outlets:newOutlets});
 const mapNew=i=>Math.floor(i/nw)*w+ow+i%nw,receiver=Array(n).fill(-1);
 for(let j=0;j<old.elevation.length;j++){const q=old.drainage.receiver[j];receiver[mapOld(j)]=q>=0?mapOld(q):continueOld.has(j)?mapNew(continueOld.get(j)):-1;}
 for(let j=0;j<newElevation.length;j++){
  elevation[mapNew(j)]=newElevation[j];const q=next.receiver[j];
  receiver[mapNew(j)]=returnToOld.has(j)?mapOld(returnToOld.get(j)):q>=0?mapNew(q):-1;
 }
 const outlets=elevation.flatMap((z,i)=>receiver[i]<0?[{id:`unresolved-edge:${i}`,cell:i,kind:'open-boundary',levelM:z}]:[]);
 let conditioned;
 try {conditioned=conditionDrainageTerrain({elevation,receiver,columns:w,cellSizeM:cell,fixed});}
 catch(error){return {status:'rejected',reason:error.message,candidateSettings:settings};}
 if(Math.max(conditioned.diagnostics.maxCutM,conditioned.diagnostics.maxRaiseM)>maxAdjustmentM)return {status:'rejected',reason:'Proposed extension requires excessive terrain correction',conditioning:conditioned.diagnostics,candidateSettings:settings};
 const incoming=new Int32Array(n),order=[],flow=[...supply];for(const q of receiver)if(q>=0)incoming[q]++;
 for(let i=0;i<n;i++)if(!incoming[i])order.push(i);
 for(let k=0;k<order.length;k++){const i=order[k],q=receiver[i];if(q>=0){flow[q]+=flow[i];if(--incoming[q]===0)order.push(q);}}
 if(order.length!==n)throw Error('Cycle passed constraint validation');
 const roots=Array(n).fill(-1);for(let k=order.length-1;k>=0;k--){const i=order[k];roots[i]=receiver[i]<0?i:roots[receiver[i]];}
 const exits=outlets.filter(o=>receiver[o.cell]<0).map(o=>({...o,levelM:conditioned.elevation[o.cell]}));
 const totalInputM3PerYear=supply.reduce((a,b)=>a+b,0),totalOutputM3PerYear=exits.reduce((sum,o)=>sum+flow[o.cell],0);
 const crossings=[];for(let i=0;i<n;i++){const q=receiver[i];if(q>=0&&(i%w<ow)!==(q%w<ow))crossings.push({from:i,to:q,supplyM3PerYear:flow[i]});}
 return {status:'constraints-pass-visual-unapproved',schema:'extended-regional-trial@1',sourceWorldId:old.sourceWorldId,climateId:old.climateId,grid:{columns:w,rows:h,cellSizeM:cell},elevation:conditioned.elevation,drainage:{receiver,routedSupplyM3PerYear:flow,outletCell:roots,outlets:exits},conditioning:conditioned.diagnostics,diagnostics:{totalInputM3PerYear,totalOutputM3PerYear,relativeBudgetResidual:Math.abs(totalInputM3PerYear-totalOutputM3PerYear)/Math.max(1,totalInputM3PerYear),maxBoundaryBlendM,oldHeightChanges:old.elevation.filter((z,i)=>z!==conditioned.elevation[mapOld(i)]).length,oldInteriorReceiverChanges:old.drainage.receiver.filter((q,i)=>q>=0&&receiver[mapOld(i)]!==mapOld(q)).length,crossingCount:crossings.length},crossings,sharedColumn:ow-1,candidateSettings:settings,limits:['Eastward inland extension trial only','Outer water destinations and external inflow remain unresolved','Flow totals may grow when newly resolved upstream terrain feeds old channels; old geometry does not move','Boundary blending is geometric, not a geological simulation','No physical channel widths or lake shoreline solution']};
}

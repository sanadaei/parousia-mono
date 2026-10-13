/** Shared coarse drainage domains for regional relief research.
 * A planning decomposition, not generated relief, river water, or geological types.
 * Regions follow the saved receiver graph; border portals are canonical cell edges.
 * No saved-world mutation or camera-dependent decisions.
 */
import {hashJson} from '../../src/core/json-contract.mjs';
export function partitionReliefDomains(snapshot,{maxCells=64}={}){
 const {columns,rows}=snapshot?.grid??{},down=snapshot?.fields?.downstream,elevation=snapshot?.fields?.groundElevationM;
 if(!Number.isSafeInteger(columns)||!Number.isSafeInteger(rows)||columns<3||rows<2||columns*rows>131072||!Array.isArray(down)||down.length!==columns*rows||!Array.isArray(elevation)||elevation.length!==down.length||!elevation.every(Number.isFinite))throw new TypeError('Bounded saved drainage grid required');
 if(!Number.isSafeInteger(maxCells)||maxCells<1||maxCells>1024)throw new RangeError('maxCells must be 1..1024');
 const N=down.length,landMask=snapshot.fields.landMask??null,fill=snapshot.fields.lakeFillDepthM??null;
 if(landMask&&(!Array.isArray(landMask)||landMask.length!==N||landMask.some(v=>v!==0&&v!==1)))throw new TypeError('Invalid land mask');
 if(fill&&(!Array.isArray(fill)||fill.length!==N||fill.some(v=>!Number.isFinite(v)||v<0)))throw new TypeError('Invalid source fill depths');
 const lakeCells=new Uint8Array(N),lakes=snapshot.references?.lakes??[];let lakeEntries=0;
 if(!Array.isArray(lakes)||lakes.length>N)throw new RangeError('Lake reference budget exceeded');
 for(const lake of lakes){if(!Number.isFinite(lake.levelElevationM)||!Array.isArray(lake.cells))throw new TypeError('Invalid lake reference');if((lakeEntries+=lake.cells.length)>N)throw new RangeError('Lake cell budget exceeded');for(const i of lake.cells){if(!Number.isSafeInteger(i)||i<0||i>=N)throw new RangeError('Invalid lake cell');if(elevation[i]<lake.levelElevationM)lakeCells[i]=1;}}
 const dry=i=>landMask?.[i]===1&&!lakeCells[i];
 const routingLevel=i=>elevation[i]+(fill?.[i]??0);
 const routingTolerance=(i,j)=>64*Number.EPSILON*Math.max(1,Math.abs(elevation[i]),Math.abs(elevation[j]),fill?.[i]??0,fill?.[j]??0);
 const children=Array.from({length:N},()=>[]),roots=[];
 for(let i=0;i<N;i++){const q=down[i];if(!Number.isSafeInteger(q)||q< -1||q>=N||q===i)throw new RangeError('Invalid receiver');if(q<0)roots.push(i);else children[q].push(i);}
 // Downstream-first traversal also validates that every cell reaches a terminal.
 const order=roots.slice();for(let k=0;k<order.length;k++)for(const child of children[order[k]])order.push(child);
 if(order.length!==N)throw new RangeError('Receiver graph contains a cycle');
 const assignment=new Int32Array(N).fill(-1),domains=[];
 for(const start of order){if(assignment[start]>=0)continue;
  const index=domains.length,queue=[start],cells=[];assignment[start]=index;
  for(let k=0;k<queue.length;k++){const i=queue[k];cells.push(i);for(const child of children[i])if(queue.length<maxCells){assignment[child]=index;queue.push(child);}}
  domains.push({drySurfaceCellCount:landMask?cells.filter(dry).length:null,lakeCellCount:cells.filter(i=>lakeCells[i]).length,requiresReliefWork:landMask?cells.some(dry):null,id:`relief-domain:${start}`,outletCell:start,cells,downstreamDomain:null,inletPortalIds:[],outletPortalId:null});
 }
 const portals=[];
 for(let i=0;i<N;i++){const q=down[i];if(q<0||assignment[i]===assignment[q])continue;
  const id=`relief-portal:${i}:${q}`,from=domains[assignment[i]],to=domains[assignment[q]];
  // Exactly one coarse outlet per connected tree-domain; any violation is a bug.
  if(from.outletPortalId!==null)throw new Error('Domain has multiple graph outlets');
  from.outletPortalId=id;from.downstreamDomain=to.id;to.inletPortalIds.push(id);
  portals.push({id,fromDomain:from.id,toDomain:to.id,fromCell:i,toCell:q,sourceElevationM:elevation[i],receiverElevationM:elevation[q],sourceRoutingLevelM:routingLevel(i),receiverRoutingLevelM:routingLevel(q),routingRoundoffToleranceM:routingTolerance(i,q),heightStatus:elevation[i]>=elevation[q]?'coarse-ground-downhill':routingLevel(i)+routingTolerance(i,q)>=routingLevel(q)?'source-fill-routed-not-ground-downhill':'requires-level-reconciliation'});
 }
 const state={method:'saved-drainage-domain-partition@1',sourceWorldId:snapshot.worldId??null,grid:{columns,rows},maxCells,domains,portals};
 return {...state,id:hashJson(state),cellDomain:Array.from(assignment),status:'planning-only; no regional height field generated',limitations:['Grid-adjacent region borders are not yet shared ridge geometry','Portals retain source heights; they do not invent water levels or guarantee detailed hydraulic continuity','A fixed cell budget is not a fixed physical area, particularly near poles','All source cells are retained; explicit ocean-only or lake-only domains require no dry-land relief work','Source lake-fill routing heights are not replacement ground or inferred current water surfaces']};
}

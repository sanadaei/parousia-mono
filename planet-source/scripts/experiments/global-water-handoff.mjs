import {hashJson as rawHashJson,copyJson} from '../../src/core/json-contract.mjs';
import {solveRegionalDrainage} from '../../src/core/regional-drainage.mjs';
import {createRegionalWaterContext} from '../../src/core/regional-water-context.mjs';
import {reconcileWaterCandidate} from '../../src/core/refine-water-candidates.mjs';
import {generateLandformCandidate} from './conditional-landform-candidate.mjs';
import {fixedDetailSource,anchoredGeneratedSurface} from './anchored-regional-surface.mjs';
const hashJson=value=>rawHashJson(copyJson(value));
const sum=a=>a.reduce((s,v)=>s+v,0),close=(a,b)=>Math.abs(a-b)<=1e-8*Math.max(1,Math.abs(a),Math.abs(b));
export function assertNoReentry(down,cells){const inside=new Set(cells);for(const i of cells){let j=down[i];if(j<0||inside.has(j))continue;const seen=new Set();while(j>=0){if(inside.has(j))throw Error('Exit then re-entry: widen uncommitted domain before importing global totals');if(seen.has(j))throw Error('Cyclic exterior graph');seen.add(j);j=down[j];}}}
export function createGlobalWaterParent(l1,{column=225,row=65}={}){
 const s=l1?.snapshot,c=l1?.climate,w=s?.grid?.columns,h=s?.grid?.rows,n=w*h;
 if(l1?.schema!=='l1-broad-region@1'||l1.sourceWorldId!==s?.worldId||!Number.isFinite(s?.frame?.radiusM)||s.frame.radiusM<=0||!Number.isInteger(column)||!Number.isInteger(row)||column<1||column+2>=w||row<1||row+2>=h)throw Error('Bounded interior complete-cell domain required');
 for(const a of [s.fields.groundElevationM,s.fields.downstream,c.cellAreaM2,c.catchmentWater.annualLocalYieldMm,c.catchmentWater.annualRoutedYieldM3])if(!Array.isArray(a)||a.length!==n||!a.every(Number.isFinite))throw Error('Complete global water evidence required');
 const cells=[row*w+column,row*w+column+1,(row+1)*w+column,(row+1)*w+column+1],inside=new Set(cells),down=s.fields.downstream;
 if(!down.every((j,i)=>Number.isSafeInteger(j)&&j>=-1&&j<n&&j!==i))throw Error('Invalid global receiver graph');
 if(!down.every((j,i)=>j<0||(Math.abs(Math.floor(i/w)-Math.floor(j/w))<=1&&Math.min(Math.abs(i%w-j%w),w-Math.abs(i%w-j%w))<=1)))throw Error('Global receiver graph must use adjacent D8 cells, including periodic longitude seam');
 if(cells.some(i=>down[i]<0))throw Error('Terminal selected cell needs an explicit terminal-water contract');
 const degree=new Uint32Array(n),order=[],expected=c.cellAreaM2.map((a,i)=>{if(!(a>0)||c.catchmentWater.annualLocalYieldMm[i]<0)throw Error('Invalid spherical source area or yield');const yy=Math.floor(i/w),exact=s.frame.radiusM**2*2*Math.PI/w*(Math.sin((90-yy*180/h)*Math.PI/180)-Math.sin((90-(yy+1)*180/h)*Math.PI/180));if(!close(a,exact))throw Error('Source area differs from complete spherical L1 cell');return a*c.catchmentWater.annualLocalYieldMm[i]/1000;});
 for(const j of down)if(j>=0)degree[j]++;for(let i=0;i<n;i++)if(!degree[i])order.push(i);for(let k=0;k<order.length;k++){const i=order[k],j=down[i];if(j>=0){expected[j]+=expected[i];if(!--degree[j])order.push(j);}}
 if(order.length!==n||expected.some((v,i)=>!close(v,c.catchmentWater.annualRoutedYieldM3[i])))throw Error('L1 declared accumulated budgets disagree with global source graph');
 assertNoReentry(down,cells);
 const latDeg=90-(row+1)*180/h,lonDeg=(column+1)*360/w;
 if(Math.abs(latDeg)>55)throw Error('Tangent metric limited to latitude 55 degrees');
 const dy=s.frame.radiusM*Math.PI/h/2,dx=s.frame.radiusM*2*Math.PI/w*Math.cos(latDeg*Math.PI/180)/2;
 const sample=(x,y)=>{const xx=column+(x-1)/2,yy=row+(y-1)/2,ix=Math.floor(xx),iy=Math.floor(yy),u=xx-ix,v=yy-iy,z=s.fields.groundElevationM;return z[iy*w+ix]*(1-u)*(1-v)+z[iy*w+ix+1]*u*(1-v)+z[(iy+1)*w+ix]*(1-u)*v+z[(iy+1)*w+ix+1]*u*v;};
 const elevation=Array.from({length:25},(_,i)=>sample(i%5,Math.floor(i/5))),crossings=[];
 for(let i=0;i<n;i++){const j=down[i];if(j<0||inside.has(i)===inside.has(j))continue;
  const ax=2*(i%w-column)+1,ay=2*(Math.floor(i/w)-row)+1,bx=2*(j%w-column)+1,by=2*(Math.floor(j/w)-row)+1;
  if(Math.abs(ax-bx)>2||Math.abs(ay-by)>2)throw Error('Nonadjacent coarse crossing needs a segment clipping contract');
  const x=(ax+bx)/2,y=(ay+by)/2;
  if(x<0||x>4||y<0||y>4||![x,y].some(v=>v===0||v===4))throw Error('Coarse crossing misses exact domain edge');
  crossings.push({id:`${l1.id}/edge/${i}/${j}`,fromCell:i,toCell:j,direction:inside.has(j)?'in':'out',cell:y*5+x,x,y,annualM3:c.catchmentWater.annualRoutedYieldM3[i]});
 }
 const outgoing=crossings.filter(e=>e.direction==='out'),incoming=crossings.filter(e=>e.direction==='in');
 if(outgoing.some(e=>(e.x===0||e.x===4)&&(e.y===0||e.y===4)))throw Error('Corner exit needs an explicit side corridor contract');
 if(!outgoing.length||new Set(outgoing.map(e=>e.cell)).size!==outgoing.length)throw Error('Ambiguous coincident outlet corridors require wider domain');
 const localSourceLedger=cells.map((cell,k)=>({parentCell:cell,areaM2:c.cellAreaM2[cell],yieldMm:c.catchmentWater.annualLocalYieldMm[cell],annualM3:c.cellAreaM2[cell]*c.catchmentWater.annualLocalYieldMm[cell]/1000,sourceNode:(1+2*Math.floor(k/2))*5+1+2*(k%2)}));
 if(localSourceLedger.some(q=>q.areaM2<=0||q.yieldMm<0)||crossings.some(q=>q.annualM3<0))throw Error('Nonnegative parent supply required');
 const local=Array(25).fill(0);for(const q of localSourceLedger){const cx=q.sourceNode%5,cy=Math.floor(q.sourceNode/5),weights=[.25,.5,.25];q.nodeContributions=[];for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++){const cell=(cy+y)*5+cx+x,annualM3=q.annualM3*weights[x+1]*weights[y+1];q.nodeContributions.push({cell,annualM3});local[cell]+=annualM3;}}
 const imported=sum(incoming.map(e=>e.annualM3)),localTotal=sum(local),parentExport=sum(outgoing.map(e=>e.annualM3));
 if(!close(imported+localTotal,parentExport))throw Error('Parent crossing budget does not close over selected full cells');
 const outlets=outgoing.map(e=>({id:e.id,cell:e.cell,kind:'open-boundary',levelM:elevation[e.cell]})),inflows=incoming.map(e=>({id:e.id,cell:e.cell,supplyM3PerYear:e.annualM3}));
 const grid={columns:5,rows:5,cellSizeM:dx,cellSizeYM:dy};
 const drainage=solveRegionalDrainage({...grid,elevation,localSupplyM3PerYear:local,outlets,inflows,retainSupplyOwnership:true});
 const context=createRegionalWaterContext({sourceWorldId:l1.sourceWorldId,sourceLayerId:l1.id,grid,elevation,drainage,geography:{latDeg,lonDeg,parentCells:cells,sourceGrid:{columns:w,rows:h},fullCellBounds:{column,row,columns:2,rows:2},projection:'tangent metric; exact spherical source areas',externalWaterStatus:'exact-L1-imports; provisional-outlet-ledger'}});
 return {context,crossings,localSourceLedger,sourceEvidenceHash:hashJson({snapshot:s,climate:c}),totals:{imported,local:localTotal,parentExport},sourceDistribution:'Exact finite-volume cell source distributed over its 3x3 half-cell lattice by tensor [1/4,1/2,1/4] quadrature. Shared-node contributions sum; nested ownership preserves each full-cell total. Coarse rainfall, not newly simulated rainfall.'};
}
export function refineOwnedSource(values,w,h){const fw=(w-1)*2+1,fh=(h-1)*2+1,owners=[],weights=[],totals=Array(w*h).fill(0);for(let y=0;y<fh;y++)for(let x=0;x<fw;x++){const p=Math.round(y/2)*w+Math.round(x/2),a=(x===0||x===fw-1?.5:1)*(y===0||y===fh-1?.5:1);owners.push(p);weights.push(a);totals[p]+=a;}return owners.map((p,i)=>values[p]*weights[i]/totals[p]);}
export function downstreamDeltaLedger(l1,parent,outletLedger){
 const down=l1.snapshot.fields.downstream,old=l1.climate.catchmentWater.annualRoutedYieldM3,inside=new Set(parent.context.geography.parentCells),delta=Array(down.length).fill(0);
 const outgoing=parent.crossings.filter(e=>e.direction==='out');
 if(!Array.isArray(outletLedger)||outletLedger.length!==outgoing.length||new Set(outletLedger.map(q=>q.parentEdgeId)).size!==outgoing.length||outletLedger.some(q=>!outgoing.some(e=>e.id===q.parentEdgeId&&e.fromCell===q.fromCell&&e.toCell===q.toCell&&e.annualM3===q.previousAnnualM3)||!Number.isFinite(q.revisedAnnualM3)||q.revisedAnnualM3<0))throw Error('Missing or invalid exact outgoing ledger');
 for(const e of outgoing){const q=outletLedger.find(q=>q.parentEdgeId===e.id);if(!q)throw Error('Missing outgoing ledger');let j=e.toCell;const seen=new Set();while(j>=0){if(inside.has(j)||seen.has(j))throw Error('Invalid downstream reconciliation domain');seen.add(j);delta[j]+=q.revisedAnnualM3-e.annualM3;j=down[j];}}
 const updates=[];for(let i=0;i<delta.length;i++)if(delta[i]!==0){const revised=old[i]+delta[i];if(revised< -1e-6)throw Error('Downstream budget would become negative');updates.push({cell:i,downstreamCell:down[i],previousAnnualM3:old[i],deltaAnnualM3:delta[i],revisedAnnualM3:revised});}
 const incoming=Array(down.length).fill(0),byFrom=new Map(outletLedger.map(q=>[q.fromCell,q]));
 for(let i=0;i<down.length;i++){const j=down[i];if(j<0||inside.has(j))continue;incoming[j]+=inside.has(i)?byFrom.get(i).revisedAnnualM3:old[i]+delta[i];}
 let maxExteriorRelativeResidual=0;
 for(let i=0;i<down.length;i++)if(!inside.has(i)){const local=l1.climate.cellAreaM2[i]*l1.climate.catchmentWater.annualLocalYieldMm[i]/1000,output=old[i]+delta[i],residual=Math.abs(output-incoming[i]-local)/Math.max(1,output);maxExteriorRelativeResidual=Math.max(maxExteriorRelativeResidual,residual);if(residual>1e-8)throw Error('Exterior node budget does not reconcile');}
 const terminalDelta=sum(updates.filter(q=>q.downstreamCell<0).map(q=>q.deltaAnnualM3));
 if(!close(terminalDelta,0)&&Math.abs(terminalDelta)>1e-8*parent.totals.parentExport)throw Error('Global terminal delta does not conserve supply');
 return {schema:'unadopted-global-downstream-delta-ledger@1',sourceLayerId:l1.id,regionalContextId:parent.context.id,supersededParentCells:[...inside],updates,maxExteriorRelativeResidual,terminalDeltaAnnualM3:terminalDelta,status:'proposal-only; immutable L1 is unchanged',requiredAdoption:'Atomically adopt regional override, exact outgoing edges and all exterior downstream deltas as a new global-water revision. Never overwrite the existing L1.'};
}
export function buildGlobalWaterHandoff(l1,{column=225,row=65,seed='muna-atlas-001',stages=5,maxDetailReliefM=75}={}){
 if(!Number.isInteger(stages)||stages<1||stages>5)throw Error('Bounded 2x stages required');
 const parent=createGlobalWaterParent(l1,{column,row}),g=parent.context.grid,widthM=4*g.cellSizeM,heightM=4*g.cellSizeYM,nativeCellSizeM=Math.min(g.cellSizeM,g.cellSizeYM)/2**stages;
 const columns=Math.max(24,Math.ceil(widthM/nativeCellSizeM)+1),rows=Math.max(24,Math.ceil(heightM/nativeCellSizeM)+1);
 if(columns*rows>32768)throw Error('Native terrain source budget exceeded');
 const raw=generateLandformCandidate({seed,columns,rows,cellSizeM:nativeCellSizeM}),source=fixedDetailSource({grid:raw.grid,elevation:raw.elevation,widthM,heightM,provenance:{seed,sourceLayerId:l1.id,status:'shape-prior; not observed fine geology'}});
 let context=parent.context,roots=new Map(context.outlets.map(o=>[o.id,o.id]));const records=[];
 let sourceComponents=parent.localSourceLedger.map(q=>Array.from({length:25},(_,i)=>q.nodeContributions.find(p=>p.cell===i)?.annualM3??0));
 for(let k=0;k<stages;k++){
  const surface=anchoredGeneratedSurface(context,source,{factor:2,maxDetailReliefM,maxAddedSlopeMPerM:.14});
  const water=reconcileWaterCandidate(context,{factor:2,elevation:surface.elevation,method:'provisional-boundary',boundaryState:'provisional'},{downstreamBudgetsStatus:'provisional',adoptedOutletBudgets:[]});
  sourceComponents=sourceComponents.map(a=>refineOwnedSource(a,context.grid.columns,context.grid.rows));
  const next=water.context,newRoots=new Map();
  for(const o of next.outlets){const root=roots.get(o.inheritedOutletId);if(!root)throw Error('Lost coarse downstream corridor identity');newRoots.set(o.id,root);const edge=parent.crossings.find(e=>e.id===root),x=o.cell%next.grid.columns/(next.grid.columns-1)*4,y=Math.floor(o.cell/next.grid.columns)/(next.grid.rows-1)*4;if(edge.x===0||edge.x===4){if(x!==edge.x||Math.abs(y-edge.y)>1+1e-10)throw Error('Fine outlet left valid coarse edge corridor');}else if(y!==edge.y||Math.abs(x-edge.x)>1+1e-10)throw Error('Fine outlet left valid coarse edge corridor');}
  const mass=sourceComponents.map(sum);for(let i=0;i<mass.length;i++)if(!close(mass[i],parent.localSourceLedger[i].annualM3))throw Error('Parent-owned source mass drift');
  for(let i=0;i<next.elevation.length;i++)if(!close(sum(sourceComponents.map(a=>a[i])),next.supplyOwnership.localSupplyM3PerYear[i]))throw Error('Fine local supply lost ownership');
  for(const original of parent.context.supplyOwnership.inflows){const actual=next.supplyOwnership.inflows.find(q=>q.id===original.id),factor=2**(k+1),expected=Math.floor(original.cell/5)*factor*next.grid.columns+(original.cell%5)*factor;if(!actual||actual.cell!==expected||actual.supplyM3PerYear!==original.supplyM3PerYear)throw Error('Imported crossing moved or duplicated');}
  records.push({surface,water,parentOwnedLocalMassM3:mass});context=next;roots=newRoots;
 }
 const outletLedger=parent.crossings.filter(e=>e.direction==='out').map(e=>({parentEdgeId:e.id,fromCell:e.fromCell,toCell:e.toCell,previousAnnualM3:e.annualM3,revisedAnnualM3:sum(context.outlets.filter(o=>roots.get(o.id)===e.id).map(o=>o.supplyM3PerYear)),status:'provisional-global-corridor-budget'}));
 const local=sum(context.supplyOwnership.localSupplyM3PerYear),imported=sum(context.supplyOwnership.inflows.map(q=>q.supplyM3PerYear)),output=sum(outletLedger.map(q=>q.revisedAnnualM3));
 if(!close(local+imported,output))throw Error('Final local plus imported supply does not close');
 const globalLedger=downstreamDeltaLedger(l1,parent,outletLedger);globalLedger.regionalContextId=context.id;
 const body={schema:'complete-cell-global-water-handoff@1',sourceWorldId:l1.sourceWorldId,sourceLayerId:l1.id,parent,source,stages:records,context,outletLedger,globalLedger,diagnostics:{localAnnualM3:local,importedAnnualM3:imported,outputAnnualM3:output,relativeBudgetResidual:Math.abs(output-local-imported)/Math.max(1,output),parentOwnedLocalMassM3:sourceComponents.map(sum),physicalWidthM:widthM,physicalHeightM:heightM},status:'global-imports-connected; downstream-global-ledger-awaits-atomic-revision',limits:['Exact full-cell potential-water mass, not calibrated hydraulic discharge','Fine exits stay within explicit outgoing coarse-edge corridors; actual subcell port location remains provisional','Existing L1 fields are immutable and not silently changed; downstream delta ledger is a proposal','No exit/re-entry domains accepted; widen jointly before using such domains','Local source quadrature and inherited coarse climate are not newly simulated rainfall','Added fine terrain is bounded shape-prior detail, not observed geology']};return {...body,id:hashJson(body)};
}

/** New provisional generation can adopt a separate, immutable regional/global
 * overlay. Existing L1 records and readers remain untouched. */
export function acceptGlobalWaterOverlay(l1,handoff,{downstreamBudgetsStatus='provisional',adoptedOutletBudgets=[]}={}){
 if(downstreamBudgetsStatus!=='provisional'||!Array.isArray(adoptedOutletBudgets)||adoptedOutletBudgets.length)throw Error('Adopted external constraints require joint-domain reconciliation; cannot accept overlay');
 const {id,...body}=handoff??{};if(!id||hashJson(body)!==id||handoff.sourceLayerId!==l1.id)throw Error('Exact handoff identity and L1 required');
 const bounds=handoff.parent.context.geography.fullCellBounds,parent=createGlobalWaterParent(l1,bounds);
 if(parent.sourceEvidenceHash!==handoff.parent.sourceEvidenceHash||parent.context.id!==handoff.parent.context.id)throw Error('Handoff parent source changed');
 const context=handoff.context;
 const checked=createRegionalWaterContext({sourceWorldId:context.sourceWorldId,sourceLayerId:context.sourceLayerId,geography:context.geography,grid:context.grid,elevation:context.elevation,supplyOwnership:context.supplyOwnership,drainage:{receiver:context.receiver,routedSupplyM3PerYear:context.annualFlowM3,outlets:context.outlets,status:context.status}});
 if(checked.id!==context.id)throw Error('Regional context identity changed');
 let roots=new Map(parent.context.outlets.map(o=>[o.id,o.id]));
 for(const stage of handoff.stages){const next=new Map();for(const o of stage.water.context.outlets){const root=roots.get(o.inheritedOutletId);if(!root)throw Error('Invalid coarse outlet lineage');next.set(o.id,root);}roots=next;}
 if(handoff.stages.at(-1)?.water.context.id!==context.id)throw Error('Final context is not the accepted stage');
 for(const e of handoff.outletLedger){const amount=sum(context.outlets.filter(o=>roots.get(o.id)===e.parentEdgeId).map(o=>o.supplyM3PerYear));if(!close(amount,e.revisedAnnualM3))throw Error('Outlet ledger differs from final regional graph');}
 const grid=context.grid,factor=(grid.columns-1)/4;
 const local=sum(context.supplyOwnership.localSupplyM3PerYear),inflows=context.supplyOwnership.inflows;
 if(!close(local,parent.totals.local)||inflows.length!==parent.context.supplyOwnership.inflows.length)throw Error('Source ownership changed');
 for(const inlet of parent.context.supplyOwnership.inflows){const actual=inflows.find(q=>q.id===inlet.id);if(!actual||actual.supplyM3PerYear!==inlet.supplyM3PerYear||actual.cell!==Math.floor(inlet.cell/5)*factor*grid.columns+(inlet.cell%5)*factor)throw Error('Imported source identity or mass changed');}
 const ledger=downstreamDeltaLedger(l1,parent,handoff.outletLedger);ledger.regionalContextId=context.id;
 if(hashJson(ledger)!==hashJson(handoff.globalLedger))throw Error('Downstream proposal differs from exact recomputation');
 const content={schema:'accepted-provisional-global-water-overlay@1',sourceWorldId:l1.sourceWorldId,sourceLayerId:l1.id,sourceEvidenceHash:parent.sourceEvidenceHash,proposalId:id,regionalContext:context,outletLedger:handoff.outletLedger,downstreamLedger:ledger,status:'accepted-in-this-overlay; base-L1-unchanged',limits:['Overlay-aware readers must be used for downstream flow','Selected coarse cells are superseded, never queried as old scalar flows','Existing adopted external constraints are unsupported','Sequential overlapping regional overlays require a composite-graph transaction']};const overlay={...content,id:hashJson(content)};createOverlayFlowAccessor(l1,overlay);return overlay;
}
/** Validate once, then use this accessor for future downstream region inputs.
 * Superseded coarse cells reject instead of leaking obsolete accumulated flow. */
export function createOverlayFlowAccessor(l1,overlay){
 const {id,...content}=overlay??{};
 if(overlay?.schema!=='accepted-provisional-global-water-overlay@1'||hashJson(content)!==id||overlay.sourceLayerId!==l1.id||overlay.sourceEvidenceHash!==hashJson({snapshot:l1.snapshot,climate:l1.climate}))throw Error('Exact overlay and unchanged L1 evidence required');
 const bounds=overlay.regionalContext.geography.fullCellBounds,parent=createGlobalWaterParent(l1,bounds),context=overlay.regionalContext;
 const verified=createRegionalWaterContext({sourceWorldId:context.sourceWorldId,sourceLayerId:context.sourceLayerId,geography:context.geography,grid:context.grid,elevation:context.elevation,supplyOwnership:context.supplyOwnership,drainage:{receiver:context.receiver,routedSupplyM3PerYear:context.annualFlowM3,outlets:context.outlets,status:context.status}});if(verified.id!==context.id)throw Error('Overlay regional context changed');
 const exact=downstreamDeltaLedger(l1,parent,overlay.outletLedger);exact.regionalContextId=context.id;if(hashJson(exact)!==hashJson(overlay.downstreamLedger))throw Error('Overlay downstream deltas fail exact recomputation');
 const scale=(context.grid.columns-1)/4;if(!Number.isInteger(Math.log2(scale))||scale<2||scale>32||context.grid.rows!==context.grid.columns)throw Error('Invalid overlay refinement lattice');
 if(context.sourceWorldId!==l1.sourceWorldId||context.sourceLayerId!==l1.id||hashJson(context.geography)!==hashJson(parent.context.geography)||context.status!==parent.context.status||context.grid.cellSizeM!==parent.context.grid.cellSizeM/scale||context.grid.cellSizeYM!==parent.context.grid.cellSizeYM/scale)throw Error('Overlay provenance or physical parent footprint changed');
 for(let i=0;i<25;i++)if(context.elevation[Math.floor(i/5)*scale*context.grid.columns+(i%5)*scale]!==parent.context.elevation[i])throw Error('Overlay moved an adopted L1 anchor');
 let expectedLocal=parent.context.supplyOwnership.localSupplyM3PerYear,w=5;for(let f=1;f<scale;f*=2){expectedLocal=refineOwnedSource(expectedLocal,w,w);w=(w-1)*2+1;}
 if(context.supplyOwnership.localSupplyM3PerYear.some((v,i)=>!close(v,expectedLocal[i])))throw Error('Overlay local sources differ from exact parent quadrature');
 if(context.supplyOwnership.inflows.length!==parent.context.supplyOwnership.inflows.length)throw Error('Overlay imported source count changed');
 for(const inlet of parent.context.supplyOwnership.inflows){const actual=context.supplyOwnership.inflows.find(q=>q.id===inlet.id);if(!actual||actual.supplyM3PerYear!==inlet.supplyM3PerYear||actual.cell!==Math.floor(inlet.cell/5)*scale*w+(inlet.cell%5)*scale)throw Error('Overlay imported source changed');}
 for(const e of overlay.outletLedger){const outlets=context.outlets.filter(o=>o.id===e.parentEdgeId||o.id.startsWith(e.parentEdgeId+'/boundary/'));if(!close(sum(outlets.map(o=>o.supplyM3PerYear)),e.revisedAnnualM3))throw Error('Overlay outlet ledger differs from regional graph');const edge=parent.crossings.find(q=>q.id===e.parentEdgeId);for(const o of outlets){const x=o.cell%w/scale,y=Math.floor(o.cell/w)/scale;if(edge.x===0||edge.x===4){if(x!==edge.x||Math.abs(y-edge.y)>1+1e-10)throw Error('Overlay outlet left coarse corridor');}else if(y!==edge.y||Math.abs(x-edge.x)>1+1e-10)throw Error('Overlay outlet left coarse corridor');}}
 const inside=new Set(overlay.downstreamLedger.supersededParentCells),changed=new Map(),old=[...l1.climate.catchmentWater.annualRoutedYieldM3];
 for(const q of overlay.downstreamLedger.updates){if(changed.has(q.cell)||inside.has(q.cell)||q.previousAnnualM3!==old[q.cell]||q.downstreamCell!==l1.snapshot.fields.downstream[q.cell]||!Number.isFinite(q.revisedAnnualM3)||q.revisedAnnualM3<0||!close(q.previousAnnualM3+q.deltaAnnualM3,q.revisedAnnualM3))throw Error('Invalid exterior flow update');changed.set(q.cell,q.revisedAnnualM3);}
 return Object.freeze(Object.assign(cell=>{if(!Number.isSafeInteger(cell)||cell<0||cell>=old.length)throw Error('Invalid global cell');if(inside.has(cell))throw Error('Cell replaced by regional context; use its explicit graph');return changed.get(cell)??old[cell];},{overlayId:id,sourceLayerId:l1.id,supersededCells:Object.freeze([...inside])}));
}
/** Storage resolve writes the context and full delta ledger as ONE immutable
 * object; old L1 is never mutated and an identity conflict is never overwritten. */
export async function saveGlobalWaterOverlay(store,l1,handoff,options={},entityId='global-water-overlay'){
 const overlay=acceptGlobalWaterOverlay(l1,handoff,options);
 return store.resolve({worldId:l1.sourceWorldId,entityId,conditions:{sourceLayerId:l1.id,sourceEvidenceHash:overlay.sourceEvidenceHash,proposalId:handoff.id,regionalContextId:handoff.context.id},generator:'accepted-provisional-global-water-overlay@1',generate:()=>overlay});
}

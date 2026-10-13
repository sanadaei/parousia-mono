/** Pure provisional post-shape annotation, shared by experiments and runtime. */
import {createHash} from './sha256.mjs';
const YEAR_SECONDS = 365.25 * 86400;
const hash = x => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const check = (ok, text) => { if (!ok) throw new Error(text); };
const nonnegative = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
function distance2(p, a, b) {
  const dx=b[0]-a[0], dy=b[1]-a[1], len=dx*dx+dy*dy;
  const t=len ? Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len)) : 0;
  return (p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dy)**2;
}
export function fitRiverWater(candidate, terrain, scenario) {
  check(scenario?.kind === 'synthetic-demonstration' && typeof scenario.name === 'string' && scenario.name.trim(), 'Explicit named synthetic-demonstration scenario required');
  check(nonnegative(scenario.runoffMmPerYear), 'runoffMmPerYear must be finite and nonnegative');
  const before={ height:hash(candidate.elevation), rivers:hash(candidate.rivers), terrain:hash(terrain) };
  const g=candidate.grid, tg=terrain.grid;
  check(g && Number.isInteger(g.columns) && g.columns>=2 && Number.isInteger(g.rows) && g.rows>=2 && g.cellSizeM>0 && Number.isFinite(g.cellSizeM) && g.cellSizeYM>0 && Number.isFinite(g.cellSizeYM), 'Invalid candidate grid');
  check(g.row0==='north' && g.yDirection==='south' && tg?.rowOrder==='south_to_north', 'Unrecognized coordinate orientation');
  const width=(g.columns-1)*g.cellSizeM, height=(g.rows-1)*g.cellSizeYM;
  check(tg.columns===g.columns && tg.rows===g.rows && Math.abs(tg.widthM-width)<1e-6 && Math.abs(tg.heightM-height)<1e-6, 'Grid metadata mismatch');
  check(candidate.elevation.length===g.rows*g.columns && candidate.elevation.every(Number.isFinite), 'Invalid elevations');
  check(Array.isArray(terrain.elevationM) && terrain.elevationM.length===g.rows && terrain.elevationM.every(row=>Array.isArray(row)&&row.length===g.columns), 'Invalid native elevations');
  check(candidate.elevation.every((v,i)=>v===terrain.elevationM[g.rows-1-Math.floor(i/g.columns)][i%g.columns]), 'Candidate/native height mismatch');
  check(Array.isArray(terrain.rivers) && terrain.rivers.length>0 && candidate.rivers.length===terrain.rivers.length, 'River metadata required');
  const rivers=terrain.rivers, byId=new Map(), segments=[];
  for (const [ri,r] of rivers.entries()) {
    check(typeof r.id==='string' && r.id.trim() && !byId.has(r.id), 'Bad or duplicate river ID');
    check(r.direction==='downstream_to_upstream', 'River orientation must be downstream_to_upstream');
    check(Array.isArray(r.pointsM) && r.pointsM.length>=2 && r.pointsM.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)), 'Invalid river geometry');
    check(candidate.rivers[ri].length===r.pointsM.length && r.pointsM.every((p,i)=>Math.abs(p[0]-candidate.rivers[ri][i].xM)<0.002 && Math.abs(height-p[1]-candidate.rivers[ri][i].yM)<0.002), 'Candidate/native river mismatch');
    const n=r.pointsM.length-1;
    byId.set(r.id,{ r, ri, local:Array(n).fill(0), incoming:Array(n).fill(0), flow:Array(n).fill(0), cellCount:0, children:[], external:0 });
    for(let si=0;si<n;si++) segments.push({ri,si,a:r.pointsM[si],b:r.pointsM[si+1]});
  }
  for(const n of byId.values()) {
    check(n.r.parent===null || (typeof n.r.parent==='string' && byId.has(n.r.parent)), 'Unknown parent river ID');
    if(n.r.parent!==null) byId.get(n.r.parent).children.push(n);
  }
  const state=new Map();
  function acyclic(n) { check(state.get(n)!==1,'Cycle in river parent graph'); if(state.get(n)===2)return;state.set(n,1);for(const child of n.children)acyclic(child);state.set(n,2); }
  for(const n of byId.values()) acyclic(n);
  const externalInputs=scenario.externalInputs??[];
  check(Array.isArray(externalInputs),'externalInputs must be an array');
  const names=new Set();
  for(const e of externalInputs) {
    check(typeof e.name==='string' && e.name.trim() && !names.has(e.name), 'External input requires unique name');names.add(e.name);
    check(byId.has(e.riverId),'Unknown external-input river ID');
    check(nonnegative(e.m3PerSecond),'External input must be finite and nonnegative');
    const n=byId.get(e.riverId);n.external+=e.m3PerSecond;n.incoming[n.incoming.length-1]+=e.m3PerSecond;
  }
  // Each rectangular cell contributes once; nearest segment in metric native XY.
  const cellArea=g.cellSizeM*g.cellSizeYM, perCell=cellArea*scenario.runoffMmPerYear/1000/YEAR_SECONDS;
  const assignment=[];
  for(let row=0;row<g.rows-1;row++)for(let col=0;col<g.columns-1;col++) {
    const p=[(col+0.5)*g.cellSizeM,height-(row+0.5)*g.cellSizeYM];
    let best=segments[0],bestD=Infinity;
    for(const s of segments) { const d=distance2(p,s.a,s.b);if(d<bestD){best=s;bestD=d;} }
    const n=byId.get(rivers[best.ri].id);n.local[best.si]+=perCell;n.cellCount++;
    assignment.push(best.ri);
  }
  const confluences=[];
  function accumulate(n) {
    for(const child of n.children) {
      accumulate(child);
      let si=0,d=Infinity;
      for(let i=0;i<n.flow.length;i++){const q=distance2(child.r.pointsM[0],n.r.pointsM[i],n.r.pointsM[i+1]);if(q<d){d=q;si=i;}}
      check(Math.sqrt(d)<=0.01,`Disconnected confluence: ${child.r.id}`);
      n.incoming[si]+=child.flow[0];
      confluences.push({childId:child.r.id,parentId:n.r.id,parentSegment:si,gapM:Math.sqrt(d),inflowM3PerSecond:child.flow[0]});
    }
    let q=0;for(let i=n.flow.length-1;i>=0;i--){q+=n.local[i]+n.incoming[i];n.flow[i]=q;}
  }
  const roots=[...byId.values()].filter(n=>n.r.parent===null);for(const n of roots)accumulate(n);
  const localTotal=assignment.length*perCell, externalTotal=externalInputs.reduce((s,e)=>s+e.m3PerSecond,0), outletTotal=roots.reduce((s,n)=>s+n.flow[0],0);
  const residual=outletTotal-localTotal-externalTotal;
  check(Number.isFinite(outletTotal) && Number.isFinite(localTotal) && Number.isFinite(externalTotal), 'Flow overflow');
  check(Math.abs(residual)<=1e-10*Math.max(1,outletTotal),'Mass closure failure');
  const after={height:hash(candidate.elevation),rivers:hash(candidate.rivers),terrain:hash(terrain)};
  check(JSON.stringify(before)===JSON.stringify(after),'Input mutation detected');
  const maxFlow=Math.max(...roots.map(n=>n.flow[0]));
  return {
    schema:'shape-first-water-annotation@1',status:'PROVISIONAL SYNTHETIC DEMONSTRATION; NOT A VALIDATED WATERSHED',scenario:structuredClone(scenario),
    method:{assignment:'Nearest designed polyline segment in metres; equal-distance ties use river input order then segment order',area:'(columns-1)*(rows-1) nonoverlapping cells; one centre sample per cell',flow:'Paths run downstream-to-upstream; child outlet enters parent at nearest confluence segment; accumulate in reverse segment order',externalInputPlacement:'Uppermost segment of the named existing river',lineWeight:'0.6 + 5.4*sqrt(segment conceptual flow / largest outlet flow); display pixels only',yearSeconds:YEAR_SECONDS},
    limitations:['Assignment ignores terrain slopes, divides, depressions and groundwater; NOT a topographically validated watershed.','Synthetic runoff is already net supply, not rainfall; no regional weather claim or calibration to an old ledger.','Steady annual-mean bookkeeping only; no storage, losses, seasons, flood peaks, hydraulic capacity or channel-width inference.','Confluences and cell inputs are quantized to existing segments; no new barriers or geometry edits.'],
    preservation:{before,after,unchanged:true},
    accounting:{areaM2:width*height,assignedCellCount:assignment.length,runoffM3PerSecond:localTotal,externalM3PerSecond:externalTotal,outletM3PerSecond:outletTotal,residualM3PerSecond:residual,closed:true},
    assignment:{columns:g.columns-1,rows:g.rows-1,row0:'north',riverIds:rivers.map(r=>r.id),riverIndexByCell:assignment},confluences,
    rivers:[...byId.values()].map(n=>({id:n.r.id,parent:n.r.parent,assignedAreaM2:n.cellCount*cellArea,localRunoffM3PerSecond:n.local.reduce((s,x)=>s+x,0),externalM3PerSecond:n.external,outletM3PerSecond:n.flow[0],segmentFlowM3PerSecond:n.flow,segmentLineWeightPx:n.flow.map(q=>maxFlow ? 0.6+5.4*Math.sqrt(q/maxFlow):0.6)}))
  };
}

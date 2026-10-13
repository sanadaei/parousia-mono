import { createGlobalTerrain, GLOBAL_TERRAIN_SCHEMA } from './global-terrain.mjs';
import { createPeriodicHermiteField } from './periodic-field.mjs';
import { geographicPoint, offsetGeographic, sphereBasis, finiteNumber } from './spherical.mjs';
import { cloneJson, copyJson, hashJson } from './json-contract.mjs';

export const GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA = 'minimal-world-post-detail-drainage@1';
const MAX_CELLS = 262144;
const smooth = t => t*t*(3-2*t);

/** Fill a fixed refined D8 grid, then choose the steepest receiver within the
 * original basin. The guarantee is discrete drainage, not subcell fluid flow.
 * Anchored bands vanish at source centers, so refinement is necessary to see
 * their depressions. Source fields and outlet identities remain untouched. */
export function adaptPostDetailDrainage(globalTerrain, options = {}) {
  if (globalTerrain?.schema !== GLOBAL_TERRAIN_SCHEMA) throw new TypeError('Post-detail drainage requires a base global terrain');
  if (Object.keys(options).some(k=>!['subdivisions','minDropM'].includes(k))) throw new TypeError('Unknown post-detail drainage option');
  const subdivisions = options.subdivisions ?? 3, minDropM = finiteNumber(options.minDropM ?? .001, 'minDropM');
  if (!Number.isSafeInteger(subdivisions) || subdivisions<1 || subdivisions>15 || subdivisions%2!==1) throw new RangeError('Drainage subdivisions must be an odd integer from 1..15');
  if (minDropM<=0 || minDropM>1000) throw new RangeError('Drainage minDropM must be positive and at most 1000m');
  const saved = globalTerrain.toSnapshot(), base = createGlobalTerrain(saved);
  const { columns: sw, rows: sh } = base.grid, w=sw*subdivisions, h=sh*subdivisions, count=w*h;
  if (count>MAX_CELLS) throw new RangeError('Refined drainage grid exceeds 262144 cells');
  const fields=saved.fields, half=(subdivisions-1)/2, wrap=x=>(x%w+w)%w;
  const point = i => ({ latDeg:90-(Math.floor(i/w)+.5)*180/h, lonDeg:(i%w+.5)*360/w });
  const parent = i => Math.floor(Math.floor(i/w)/subdivisions)*sw+Math.floor((i%w)/subdivisions);
  const anchor = i => (Math.floor(i/sw)*subdivisions+half)*w+(i%sw)*subdivisions+half;
  const receivers = new Int32Array(count), terminal = new Int32Array(sw*sh); terminal.fill(-1);
  // Resolve land terminals too; the public source contract intentionally uses
  // null outlet identities for these unresolved basins.
  for (let i=0;i<terminal.length;i++) {
    if (terminal[i]>=0) continue;
    let cell=i; const path=[];
    while (terminal[cell]<0 && fields.downstream[cell]>=0) { path.push(cell); cell=fields.downstream[cell]; }
    const end=terminal[cell]>=0 ? terminal[cell]:cell; terminal[cell]=end;
    for (const p of path) terminal[p]=end;
  }
  const stepToward = (a,b) => {
    const ax=a%w, ay=Math.floor(a/w), bx=b%w, by=Math.floor(b/w);
    let dx=bx-ax; if (dx>w/2) dx-=w; if (dx< -w/2) dx+=w;
    return (ay+Math.sign(by-ay))*w+wrap(ax+Math.sign(dx));
  };
  // First route every subcell to its source-center anchor, then splice the
  // canonical source D8 backbone through those anchors. Odd subdivision keeps
  // diagonal links in their two source cells and preserves exact source centers.
  for (let i=0;i<count;i++) receivers[i]=i===anchor(parent(i)) ? -1:stepToward(i,anchor(parent(i)));
  for (let i=0;i<sw*sh;i++) if (fields.downstream[i]>=0) {
    let a=anchor(i), b=anchor(fields.downstream[i]);
    while (a!==b) { const next=stepToward(a,b); receivers[a]=next; a=next; }
  }
  const sourceElevation=Array.from({length:count},(_,i)=>{const p=point(i);return base.groundElevationAt(p.latDeg,p.lonDeg);});
  const elevation=[...sourceElevation], status=new Uint8Array(count), order=[];
  for (let start=0;start<count;start++) {
    if (status[start]===2) continue;
    const path=[]; let i=start;
    while (i>=0 && !status[i]) { status[i]=1;path.push(i);i=receivers[i]; }
    if (i>=0 && status[i]===1) throw new RangeError('Refined drainage backbone is cyclic');
    for (let j=path.length-1;j>=0;j--) { const cell=path[j];status[cell]=2;order.push(cell); }
  }
  const neighbors = i => {
    const x=i%w,y=Math.floor(i/w), result=new Set();
    for (let dy=-1;dy<=1;dy++) for (let dx=-1;dx<=1;dx++) if ((dx||dy) && y+dy>=0 && y+dy<h) {
      const next=(y+dy)*w+wrap(x+dx);
      if (next!==i && terminal[parent(next)]===terminal[parent(i)]) result.add(next);
    }
    return [...result];
  };
  let depressionCount=0;
  for (let i=0;i<count;i++) if (receivers[i]>=0 && !neighbors(i).some(n=>sourceElevation[n]<sourceElevation[i])) depressionCount++;
  for (const i of order) if (receivers[i]>=0) {
    const target=elevation[receivers[i]]+minDropM;
    if (!(target>elevation[receivers[i]]) || !Number.isFinite(target)) throw new RangeError('Drainage minimum drop is not representable');
    elevation[i]=Math.max(elevation[i],target);
  }
  const unit=Array.from({length:count},(_,i)=>sphereBasis(geographicPoint(point(i).latDeg,point(i).lonDeg)).up);
  // A lower neighbor cannot lead to a cycle. The filled backbone supplies at
  // least one lower neighbor for every nonterminal, so rerouting cannot make
  // new sinks or cross original basin boundaries.
  for (let i=0;i<count;i++) if (receivers[i]>=0) {
    let best=receivers[i], grade=-Infinity;
    for (const next of neighbors(i)) if (elevation[i]-elevation[next]>=minDropM*(1-1e-9)) {
      const chord=Math.hypot(...unit[i].map((v,k)=>v-unit[next][k]));
      const distance=2*base.frame.radiusM*Math.asin(Math.min(1,chord/2));
      const slope=(elevation[i]-elevation[next])/distance;
      if (slope>grade || slope===grade && next<best) {grade=slope;best=next;}
    }
    receivers[i]=best;
  }
  const correctedCells=elevation.flatMap((z,i)=>z>sourceElevation[i] ? [{cellIndex:i,sourceCellIndex:parent(i),originalElevationM:sourceElevation[i],groundElevationM:z,correctionM:z-sourceElevation[i]}]:[]);
  const direction = i => {
    const next=receivers[i];if (next<0) return 0;
    let dx=next%w-i%w;if (dx>w/2) dx-=w;if (dx< -w/2) dx+=w;
    const dy=Math.floor(next/w)-Math.floor(i/w);
    return ({'1,0':1,'1,1':2,'0,1':4,'-1,1':8,'-1,0':16,'-1,-1':32,'0,-1':64,'1,-1':128})[`${dx},${dy}`];
  };
  const correction=elevation.map((z,i)=>z-sourceElevation[i]), evaluate=createPeriodicHermiteField(correction,w,h);
  const north=correction.slice(0,w).reduce((s,z)=>s+z/w,0), south=correction.slice(-w).reduce((s,z)=>s+z/w,0);
  const grid={columns:w,rows:h,sampleLocation:'cell-center',longitudeOriginDeg:0,northToSouth:true};
  const state={schema:GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA,base:base.toSnapshot(),
    options:{subdivisions,minDropM},drainage:{grid,groundElevationM:elevation,downstream:Array.from(receivers),flowDirectionD8:Array.from({length:count},(_,i)=>direction(i)),depressionCount,correctedCells}};
  const worldId=hashJson(state);
  function deltaAt(p) {
    const x=(p.lonDeg<0 ? p.lonDeg+360:p.lonDeg)/360*w,y=(90-p.latDeg)/180*h;
    if (y<.5) {const t=smooth(2*y);return north*(1-t)+evaluate(x,.5)*t;}
    if (y>h-.5) {const t=smooth(2*(h-y));return south*(1-t)+evaluate(x,h-.5)*t;}
    return evaluate(x,y);
  }
  function groundElevationAt(latDeg,lonDeg) {const p=geographicPoint(latDeg,lonDeg);return base.groundElevationAt(p.latDeg,p.lonDeg)+deltaAt(p);}
  function sampleDrainageAt(latDeg,lonDeg) {
    const p=geographicPoint(latDeg,lonDeg);
    if (Math.abs(p.latDeg)===90) return {...p,worldId,cellIndex:null,sourceCellIndex:null,downstreamCellIndex:null,flowDirectionD8:null,outletCellIndex:null,basinId:null,status:'undefined-at-pole'};
    const x=Math.min(w-1,Math.floor((p.lonDeg<0?p.lonDeg+360:p.lonDeg)/360*w)),y=Math.min(h-1,Math.floor((90-p.latDeg)/180*h)),i=y*w+x,source=parent(i);
    const outlet=fields.basinOutletCellIndex[source];
    return {...p,worldId,cellIndex:i,sourceCellIndex:source,groundElevationM:elevation[i],originalElevationM:sourceElevation[i],
      correctionM:correction[i],downstreamCellIndex:receivers[i],flowDirectionD8:direction(i),outletCellIndex:outlet<0?null:outlet,
      drainageOutletCellIndex:anchor(terminal[source]),basinId:outlet<0?null:`${base.sourceWorldId}/outlet:${outlet}`,
      status:outlet<0?'adapted-unresolved-terminal':'adapted-source-basin'};
  }
  function sampleAt(latDeg,lonDeg) {
    const p=geographicPoint(latDeg,lonDeg),source=base.sampleAt(p.latDeg,p.lonDeg),ground=groundElevationAt(p.latDeg,p.lonDeg),d=base.derivativeStepM;
    const at=(east,north)=>{const q=offsetGeographic(p,east,north,base.frame.radiusM);return groundElevationAt(q.latDeg,q.lonDeg);};
    const east=(at(d,0)-at(-d,0))/(2*d),north=(at(0,d)-at(0,-d))/(2*d);
    return {...source,worldId,baseWorldId:base.worldId,groundElevationM:ground,drainageGroundDeltaM:ground-source.groundElevationM,
      gradientEastNorth:{east:east||0,north:north||0},slopeMPerM:Math.hypot(east,north),drainage:sampleDrainageAt(p.latDeg,p.lonDeg)};
  }
  const adaptedTerrain=Object.freeze({schema:GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA,worldId,sourceWorldId:base.sourceWorldId,baseWorldId:base.worldId,
    frame:base.frame,grid:base.grid,drainageGrid:Object.freeze(grid),derivativeStepM:base.derivativeStepM,hydrologyStatus:base.hydrologyStatus,
    groundElevationAt,sampleAt,sampleDrainageAt,toSnapshot:()=>({...cloneJson(state),worldId})});
  return {adaptedTerrain,depressionCount,correctedCells:cloneJson(correctedCells),sampleDrainageAt};
}

export function restorePostDetailDrainage(input) {
  const saved=typeof input==='string'?JSON.parse(input):input;
  if (saved?.schema!==GLOBAL_POST_DETAIL_DRAINAGE_SCHEMA || typeof saved.worldId!=='string') throw new TypeError('Unsupported post-detail drainage snapshot');
  const terrain=adaptPostDetailDrainage(createGlobalTerrain(saved.base),saved.options).adaptedTerrain;
  if (saved.worldId!==terrain.worldId || hashJson(copyJson(saved))!==hashJson(copyJson(terrain.toSnapshot()))) throw new Error('Post-detail drainage snapshot worldId/content mismatch');
  return terrain;
}

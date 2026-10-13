/** Browser-safe presentation contract. No hydrology or terrain generation. */
const requireValue = (ok, message) => { if (!ok) throw new TypeError(`Shape-first: ${message}`); };
const finitePositive = n => Number.isFinite(n) && n > 0;
const same = (a, b) => Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
export async function sha256Text(text, cryptoAPI = globalThis.crypto) {
  requireValue(cryptoAPI?.subtle, 'SHA-256 verification is unavailable');
  return [...new Uint8Array(await cryptoAPI.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function prepareShapeFirstModel({ candidateText, pyramid, water }) {
  const candidate = JSON.parse(candidateText), g = candidate.grid;
  requireValue(candidate.schema === 'shape-first-candidate@1', 'unsupported candidate');
  requireValue(pyramid?.schema === 'shape-first-region-pyramid@1', 'unsupported pyramid');
  requireValue(water?.schema === 'shape-first-water-annotation@1', 'unsupported water annotation');
  requireValue(g?.row0 === 'north' && g.yDirection === 'south' && Number.isSafeInteger(g.columns) && Number.isSafeInteger(g.rows) && g.columns >= 2 && g.rows >= 2 && g.columns*g.rows <= 2_000_000 && finitePositive(g.cellSizeM) && finitePositive(g.cellSizeYM), 'invalid source grid');
  requireValue(candidate.elevation?.length === g.columns*g.rows && candidate.elevation.every(Number.isFinite), 'invalid source heights');
  requireValue(pyramid.provenance?.sourceSha256 === await sha256Text(candidateText), 'pyramid source hash mismatch');
  for (const [field, value] of [['height', candidate.elevation], ['rivers', candidate.rivers]]) {
    const digest = await sha256Text(JSON.stringify(value));
    requireValue(water.preservation?.before?.[field] === digest && water.preservation?.after?.[field] === digest, `water ${field} source hash mismatch`);
  }
  const extent = { widthM: (g.columns-1)*g.cellSizeM, heightM: (g.rows-1)*g.cellSizeYM };
  requireValue(same(extent.widthM, pyramid.extent?.widthM) && same(extent.heightM, pyramid.extent?.heightM), 'extent mismatch');
  requireValue(Array.isArray(pyramid.levels) && pyramid.levels.length > 0 && pyramid.levels.length <= 12, 'missing pyramid levels');
  pyramid.levels.forEach((level, i) => {
    const grid = level.grid, stride = 2 ** (pyramid.levels.length-i-1);
    requireValue(level.sourceStride === stride && grid?.columns === (g.columns-1)/stride+1 && grid.rows === (g.rows-1)/stride+1 && grid.row0 === 'north' && grid.yDirection === 'south' && same(grid.cellSizeM, g.cellSizeM*stride) && same(grid.cellSizeYM, g.cellSizeYM*stride), 'invalid level grid');
    requireValue(level.elevation?.length === grid.columns*grid.rows && level.elevation.every((h, n) => h === candidate.elevation[Math.floor(n/grid.columns)*stride*g.columns+n%grid.columns*stride]), 'level does not preserve source nodes');
    requireValue(Number.isFinite(level.designFidelity?.rmsErrorM) && Number.isFinite(level.designFidelity?.maxAbsoluteErrorM), 'missing fidelity metadata');
  });
  requireValue(Array.isArray(candidate.rivers) && candidate.rivers.length > 0 && pyramid.riverConcept?.rivers?.length === candidate.rivers.length && water.rivers?.length === candidate.rivers.length, 'river count mismatch');
  const ids = new Set();
  const rivers = candidate.rivers.map((points, index) => {
    const annotation = water.rivers[index], shown = pyramid.riverConcept.rivers[index];
    requireValue(typeof annotation.id === 'string' && annotation.id.length > 0 && !ids.has(annotation.id), 'invalid river ID'); ids.add(annotation.id);
    requireValue(Array.isArray(points) && points.length >= 2 && shown?.length === points.length, 'invalid river geometry');
    points.forEach((p, n) => {
      const q = shown[n];
      requireValue(Number.isFinite(p.xM) && Number.isFinite(p.yM) && Number.isFinite(q.xM) && Number.isFinite(q.yM) && q.xM >= 0 && q.xM <= extent.widthM && q.yM >= 0 && q.yM <= extent.heightM && Math.hypot(p.xM-q.xM,p.yM-q.yM) <= .001, 'river geometry mismatch');
    });
    requireValue(annotation.segmentFlowM3PerSecond?.length === points.length-1 && annotation.segmentFlowM3PerSecond.every(n => Number.isFinite(n) && n >= 0), 'invalid segment flow');
    requireValue(annotation.segmentLineWeightPx?.length === points.length-1 && annotation.segmentLineWeightPx.every(n => Number.isFinite(n) && n >= .6 && n <= 6.000001), 'invalid display weights');
    requireValue(Number.isFinite(annotation.outletM3PerSecond) && annotation.outletM3PerSecond >= 0 && Number.isFinite(annotation.assignedAreaM2) && annotation.assignedAreaM2 >= 0, 'invalid river totals');
    return { ...annotation, points: shown, index };
  });
  requireValue(rivers.every(r => r.parent === null || ids.has(r.parent)), 'unknown river parent');
  const byId=new Map(rivers.map(r=>[r.id,r])),visited=new Set();
  for(const river of rivers){const chain=new Set();let cursor=river;while(cursor&&!visited.has(cursor.id)){requireValue(!chain.has(cursor.id),'cycle in river parent graph');chain.add(cursor.id);cursor=cursor.parent===null?null:byId.get(cursor.parent);}for(const id of chain)visited.add(id);}

  requireValue(water.scenario?.kind === 'synthetic-demonstration' && Number.isFinite(water.scenario.runoffMmPerYear) && water.scenario.runoffMmPerYear >= 0, 'explicit synthetic scenario required');
  const a = water.accounting;
  requireValue(a && ['areaM2','runoffM3PerSecond','externalM3PerSecond','outletM3PerSecond','residualM3PerSecond'].every(k => Number.isFinite(a[k])) && same(a.areaM2, extent.widthM*extent.heightM), 'invalid accounting');

  const close=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=1e-10*Math.max(1,Math.abs(x),Math.abs(y));
  const runoffFactor=water.scenario.runoffMmPerYear/1000/(365.25*86400);
  requireValue(close(a.runoffM3PerSecond,a.areaM2*runoffFactor),'runoff accounting mismatch');
  const external=water.scenario.externalInputs??[];
  requireValue(Array.isArray(external)&&external.every(e=>ids.has(e.riverId)&&Number.isFinite(e.m3PerSecond)&&e.m3PerSecond>=0),'invalid external input');
  requireValue(close(a.externalM3PerSecond,external.reduce((s,e)=>s+e.m3PerSecond,0)),'external accounting mismatch');
  for(const r of rivers){
    requireValue(close(r.outletM3PerSecond,r.segmentFlowM3PerSecond[0]),'river outlet mismatch');
    requireValue(close(r.localRunoffM3PerSecond,r.assignedAreaM2*runoffFactor),'river runoff mismatch');
    requireValue(close(r.externalM3PerSecond,external.filter(e=>e.riverId===r.id).reduce((s,e)=>s+e.m3PerSecond,0)),'river external supply mismatch');
    const children=rivers.filter(child=>child.parent===r.id);
    requireValue(close(r.outletM3PerSecond,r.localRunoffM3PerSecond+r.externalM3PerSecond+children.reduce((s,child)=>s+child.outletM3PerSecond,0)),'river flow does not close');
    requireValue(r.segmentFlowM3PerSecond.every((q,i,list)=>i===0||q<=list[i-1]+1e-12),'segment flow decreases downstream');
  }
  requireValue(close(rivers.reduce((s,r)=>s+r.assignedAreaM2,0),a.areaM2),'assigned area mismatch');
  requireValue(close(a.outletM3PerSecond,rivers.filter(r=>r.parent===null).reduce((s,r)=>s+r.outletM3PerSecond,0))&&close(a.outletM3PerSecond,a.runoffM3PerSecond+a.externalM3PerSecond),'outlet accounting mismatch');
  requireValue(close(a.residualM3PerSecond,a.outletM3PerSecond-a.runoffM3PerSecond-a.externalM3PerSecond),'residual mismatch');
  const maximumOutlet=Math.max(...rivers.filter(r=>r.parent===null).map(r=>r.outletM3PerSecond));
  requireValue(rivers.every(r=>r.segmentLineWeightPx.every((w,i)=>close(w,maximumOutlet ? .6+5.4*Math.sqrt(r.segmentFlowM3PerSecond[i]/maximumOutlet):.6))),'display width does not match provisional flow');
  return { candidate, pyramid, water, extent, rivers, levels: pyramid.levels,
    minElevationM: candidate.elevation.reduce((a,b)=>Math.min(a,b),Infinity),
    maxElevationM: candidate.elevation.reduce((a,b)=>Math.max(a,b),-Infinity) };
}
export function sampleShapeHeight(level, xM, yM) {
  const g=level.grid, x=Math.max(0,Math.min(g.columns-1,xM/g.cellSizeM)), y=Math.max(0,Math.min(g.rows-1,yM/g.cellSizeYM));
  const col=Math.min(g.columns-2,Math.floor(x)),row=Math.min(g.rows-2,Math.floor(y)),tx=x-col,ty=y-row,h=level.elevation,k=row*g.columns+col;
  return (h[k]*(1-tx)+h[k+1]*tx)*(1-ty)+(h[k+g.columns]*(1-tx)+h[k+g.columns+1]*tx)*ty;
}
export function shapeLevelForScale(levels, pixelsPerM, targetCellPx=12) {
  if (!finitePositive(pixelsPerM)) return 0;
  const index=levels.findIndex(l=>Math.max(l.grid.cellSizeM,l.grid.cellSizeYM)*pixelsPerM<=targetCellPx);
  return index<0?levels.length-1:index;
}
export function shapeViewport(extent,width,height,zoom=1,center={xM:extent.widthM/2,yM:extent.heightM/2}) {
  const scale=Math.min(Math.max(1,width-40)/extent.widthM,Math.max(1,height-40)/extent.heightM)*zoom;
  return {scale, x:width/2-center.xM*scale, y:height/2-center.yM*scale};
}
export function shapePointAt(view,x,y) { return {xM:(x-view.x)/view.scale,yM:(y-view.y)/view.scale}; }
export function nearestShapeRiver(rivers,point,toleranceM) {
  let best=null,bestDistance=toleranceM;
  for(const river of rivers)for(let i=0;i<river.points.length-1;i++) {
    const a=river.points[i],b=river.points[i+1],dx=b.xM-a.xM,dy=b.yM-a.yM,length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((point.xM-a.xM)*dx+(point.yM-a.yM)*dy)/length)):0;
    const distance=Math.hypot(point.xM-a.xM-t*dx,point.yM-a.yM-t*dy);
    if(distance<bestDistance){bestDistance=distance;best={river,segment:i,distanceM:distance};}
  }
  return best;
}

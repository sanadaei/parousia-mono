import {terrainAppearance,DESIGNED_WATER_COLOR,RIVER_GUIDE_COLOR} from './terrain-appearance.mjs';
import {buildShapeFirstWaterStrips} from './shape-first-water-mesh.mjs';
import {buildShapeFirstRiverSymbols} from './shape-first-planet-overlay.mjs';
import {buildCommittedWaterStrips} from './narrow-water-mesh.mjs';
import {radialLift,meshHeightLifts} from './height-exaggeration.mjs';
import {straightBridgeGroundBreaklines,splitGroundTriangle,groundToRenderedEdgeBound,closedGroundReverseBound} from './ground-breaklines.mjs';
import {cooperativeYield,cooperativeYieldMethod} from './cooperative-yield.mjs';
import { vertexEdgeMask } from './lod-neighbors.mjs';
import { tileKey, tileDirection, parentTile, geographic, tileBound, dot, triangleInterpolate, normalize, cross } from './cube.mjs';
import { offsetGeographic, sphereBasis } from '../core/spherical.mjs';
import { unitNormalForGradient } from '../core/surface-derivatives.mjs';
import { cellHeightInterpolationError, groundIntervalError, tileGeometricError } from './lod.mjs';
export const GRID = 16;
export const VERTEX_STRIDE = 12;
export function displaySkirtCrossesWater(a,b,riverAt){
  return a.sample.waterDepthM>0||b.sample.waterDepthM>0||Boolean(riverAt?.intersects([a.direction,b.direction],{waterOnly:true}));
}
/** Collapse only bit-identical vertex records. Preserve the original-grid
 * prefix for Core witnesses and retain edge classification in the key. No
 * coordinate quantization, triangle reorder, normal averaging or simplification. */
export function deduplicateMeshVertices(vertex,index,{edgeMask=null,preservePrefix=0}={}){
  if(!(vertex instanceof Float32Array)||vertex.length%VERTEX_STRIDE||!(index instanceof Uint16Array))throw new TypeError('Typed mesh buffers required');
  const count=vertex.length/VERTEX_STRIDE;
  if(count>65535||!Number.isSafeInteger(preservePrefix)||preservePrefix<0||preservePrefix>count||edgeMask&&(!(edgeMask instanceof Uint8Array)||edgeMask.length!==count))throw new RangeError('Invalid compact mesh layout');
  const bits=new Uint32Array(vertex.buffer,vertex.byteOffset,vertex.length),map=new Map(),remap=new Uint16Array(count),kept=[];
  for(let i=0;i<count;i++){
    const start=i*VERTEX_STRIDE,key=`${edgeMask?.[i]??0}|${bits.subarray(start,start+VERTEX_STRIDE).join(',')}`,prior=map.get(key);
    if(i>=preservePrefix&&prior!==undefined){remap[i]=prior;continue;}
    remap[i]=kept.length;map.set(key,kept.length);kept.push(i);
  }
  for(const i of index)if(i>=count)throw new RangeError('Mesh index exceeds vertices');
  if(kept.length===count)return{vertex,index,edgeMask,inputVertices:count,outputVertices:count};
  const compact=new Float32Array(kept.length*VERTEX_STRIDE),compactBits=new Uint32Array(compact.buffer),edges=edgeMask?new Uint8Array(kept.length):null;
  kept.forEach((old,i)=>{compactBits.set(bits.subarray(old*VERTEX_STRIDE,(old+1)*VERTEX_STRIDE),i*VERTEX_STRIDE);if(edges)edges[i]=edgeMask[old];});
  return{vertex:compact,index:Uint16Array.from(index,i=>remap[i]),edgeMask:edges,inputVertices:count,outputVertices:kept.length,sourceIndices:kept};
}

/** Coarse ancestors stay resident during refinement. Spending a full local
 * water/earthwork mesh on every ancestor can exhaust the cache before the
 * actual fine tiles arrive. Keep their diagnostic limitation explicit. */
export function featureSubdivisionBudgets(level){
  if(!Number.isSafeInteger(level)||level<0||level>28)throw new RangeError('Invalid mesh LOD');
  return level<16?{water:1200,bank:300,minimumWaterPerTriangle:8,minimumBankPerTriangle:1}
    :{water:5000,bank:1000,minimumWaterPerTriangle:8,minimumBankPerTriangle:4};
}
/** Preserve the old 18-step bound on long edges, avoid sub-millimetre searches
 * on already tiny edges. The normalized-linear arc speed bounds displacement. */
export function boundaryBisectionCount(a,b,surfaceRadiusM){
  if(!Number.isFinite(surfaceRadiusM)||surfaceRadiusM<=0||![a,b].every(d=>Array.isArray(d)&&d.length===3&&d.every(Number.isFinite)&&Math.abs(Math.hypot(...d)-1)<1e-6))throw new RangeError('Boundary search requires unit directions and a positive surface radius');
  const chord=Math.hypot(...a.map((v,i)=>v-b[i])),halfSum=Math.hypot(...a.map((v,i)=>(v+b[i])/2));
  const bound=surfaceRadiusM*chord/Math.max(1e-12,halfSum);
  return Math.min(18,Math.max(1,Math.ceil(Math.log2(Math.max(.001,bound)/.001))));
}

export async function buildMesh(source,tile,signal){
  return source.withWaterWork?source.withWaterWork(()=>buildMeshWork(source,tile,signal)):buildMeshWork(source,tile,signal);
}
async function buildMeshWork(source, tile, signal) {
  const color=(z,sample)=>terrainAppearance(z,sample,source.shapeFirstRegion);
  const waterColor=source.shapeFirstRegion?DESIGNED_WATER_COLOR:[.08,.47,.63];
  const radius = source.manifest.base.frame.radiusM, bound = tileBound(tile, radius);
  const featureBound=tileBound(parentTile(tile)??tile,radius);
  if(tile.level>=10)await source.prepareSettlements?.(featureBound,signal);
  let physicalFeatureLoad={loaded:0,deferred:0};
  if(tile.level>=10&&source.prepareMeshFeatures)physicalFeatureLoad=await source.prepareMeshFeatures(featureBound,signal,{maxSurveyRadiusM:1000,roadWorkSteps:32,owner:tileKey(tile)});
  else for (const feature of source.descriptors()) if (!feature.visualOnly && tile.level >= 10 && Math.acos(Math.max(-1, Math.min(1, dot(featureBound.center, feature.center)))) <= featureBound.angular + feature.angularRadius) await source.enableFeatures(signal, feature);
  const heightRangeM = await source.ready(() => source.tileHeightBounds(bound), signal);
  const surfaceRadiusM=radius+Math.max(...heightRangeM.map(Math.abs),Math.abs(source.manifest.sea?.levelElevationM??0),...(source.manifest.lakes??[]).map(l=>Math.abs(l.levelElevationM)));
  const baseHeightRangeM = await source.ready(() => source.tileHeightBounds(bound, { includeFeatures: false }), signal);
  const centerPoint = geographic(bound.center);
  const centerHeight = await source.ready(() => source.sample(centerPoint.latDeg, centerPoint.lonDeg).groundElevationM, signal);
  const anchor = bound.center.map(v => v * (radius + centerHeight)), positions = [], records = [];
  const sampleCache=new Map(),normalCache=new Map(),edgeCache=new Map(),meshSampleLimit=16384;
  const samplingStats={cooperativeYield:cooperativeYieldMethod(),physicalFeatureLoad,surfaceQueries:0,surfaceCacheHits:0,edgeSearches:0,edgeCacheHits:0,edgeCachePeak:0,bisectionSamples:0,avoidedFixedBisectionSamples:0};
  const cacheKey=d=>`${d[0]},${d[1]},${d[2]}`;
  const retain=(cache,key,value)=>{if(cache.size>=meshSampleLimit)cache.delete(cache.keys().next().value);cache.set(key,value);};
  const sampleDirection = async direction => {
    const key=cacheKey(direction),cached=sampleCache.get(key);if(cached){samplingStats.surfaceCacheHits++;return {...cached};}
    const p = geographic(direction);
    // All charts intersecting a fine tile were enabled once above. Repeating
    // eight spherical chart tests at every bisection sample dominates latency.
    if(tile.level<10)await source.enableFeaturesAt(p, signal);
    samplingStats.surfaceQueries++;
    const sample = await source.ready(() => source.sample(p.latDeg, p.lonDeg), signal);
    const record={sample,ecef:direction.map(v=>v*(radius+sample.groundElevationM)),direction};retain(sampleCache,key,record);return {...record};
  };
  const parent = parentTile(tile), parentVertices = new Map();
  async function parentPosition(i, j) {
    const key = `${i}/${j}`;
    if (!parentVertices.has(key)) parentVertices.set(key, (await sampleDirection(tileDirection(parent, i / GRID, j / GRID))).ecef);
    return parentVertices.get(key);
  }
  const coarseLifts = [], data = [], overlays = [], overlayIndices = [], waterIndices = [];
  async function surfaceNormal(record) {
    if (tile.level < 12) return record.direction;
    // Reuse the normal's already measured grade for land classification.
    // No extra terrain queries, and no false zero slope on coarse tiles.
    const classify=normal=>{if(source.applySurfaceSlope){const up=Math.max(0,Math.min(1,normal.reduce((n,v,i)=>n+v*record.direction[i],0)));if(up>1e-12){const p=geographic(record.direction),slope=Math.sqrt(Math.max(0,1-up*up))/up;record.sample=source.applySurfaceSlope(p.latDeg,p.lonDeg,record.sample,slope);}}return normal;};
    const key=cacheKey(record.direction),cached=normalCache.get(key)??source.getMeshNormal?.(key);if(cached){retain(normalCache,key,cached);return classify(cached);}
    const p = geographic(record.direction), step = source.manifest.base.derivativeStepM;
    const z = async (east, north) => { const q = offsetGeographic(p, east, north, radius); return source.ready(() => source.groundElevationAt(q.latDeg, q.lonDeg), signal); };
    const gx = ((await z(step, 0)) - (await z(-step, 0))) / (2 * step), gy = ((await z(0, step)) - (await z(0, -step))) / (2 * step);
    const n = unitNormalForGradient({ x: gx, y: gy }), basis = sphereBasis(p);
    const normal=basis.up.map((v,k)=>v*n.z+basis.east[k]*n.x+basis.north[k]*n.y);retain(normalCache,key,normal);source.putMeshNormal?.(key,normal);return classify(normal);
  }
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const record = await sampleDirection(tileDirection(tile, i / GRID, j / GRID));
      const normal = await surfaceNormal(record);
      record.normal = normal;
      let coarse = record.ecef;
      if (parent) {
        const px = (tile.x % 2 * GRID + i) / 2, py = (tile.y % 2 * GRID + j) / 2;
        const x = Math.min(GRID - 1, Math.floor(px)), y = Math.min(GRID - 1, Math.floor(py));
        coarse = triangleInterpolate(await parentPosition(x, y), await parentPosition(x + 1, y), await parentPosition(x, y + 1), await parentPosition(x + 1, y + 1), px - x, py - y);
      }
      // Water geometry remains canonical during terrain morph. Do not lift its
      // bed back to a dry coarse-parent plane and visually dam the channel.
      if(record.sample.waterDepthM>0)coarse=record.ecef;
      record.coarseLift=radialLift(record.ecef,radius);
      if(parent&&record.sample.waterDepthM<=0){const px=(tile.x%2*GRID+i)/2,py=(tile.y%2*GRID+j)/2,x=Math.min(GRID-1,Math.floor(px)),y=Math.min(GRID-1,Math.floor(py));record.coarseLift=triangleInterpolate(radialLift(await parentPosition(x,y),radius),radialLift(await parentPosition(x+1,y),radius),radialLift(await parentPosition(x,y+1),radius),radialLift(await parentPosition(x+1,y+1),radius),px-x,py-y);}
      coarseLifts.push(...record.coarseLift);
      record.coarse = coarse; record.index = records.length;
      data.push(...record.ecef.map((v, k) => v - anchor[k]), ...coarse.map((v, k) => v - anchor[k]), ...color(record.sample.groundElevationM, record.sample), ...normal);
      positions.push(record.ecef); records.push(record);
    }
    if (j % 4 === 0) await cooperativeYield();
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  }
  async function clipOverlay(triangle, kind) {
    const inside = r => kind === 1 ? r.sample.waterDepthM > 0 : kind === 2 ? !!r.sample.roadSurface : r.sample.structureKind === 'building-pad';
    if (!triangle.some(inside)) return;
    const clipped = [];
    for (let k = 0; k < 3; k++) {
      const a = triangle[k], b = triangle[(k + 1) % 3], ia = inside(a), ib = inside(b);
      if (ia) clipped.push(a);
      if (ia !== ib) {
        // Adjacent triangles share a boundary search. Canonical endpoint
        // order also gives them exactly the same clipped edge vertex.
        const ka=cacheKey(a.direction),kb=cacheKey(b.direction),forward=ka<kb,
          first=forward?a:b,last=forward?b:a,key=`${kind}|${forward?ka:kb}|${forward?kb:ka}`;
        let wet=edgeCache.get(key);
        if(wet)samplingStats.edgeCacheHits++;
        else{
          samplingStats.edgeSearches++;let low=0,high=1;const firstInside=inside(first);wet=firstInside?first:last;
          const iterations=boundaryBisectionCount(first.direction,last.direction,surfaceRadiusM);
          samplingStats.avoidedFixedBisectionSamples+=18-iterations;
          for(let iteration=0;iteration<iterations;iteration++){
            samplingStats.bisectionSamples++;
            const t=(low+high)/2,direction=normalize(first.direction.map((v,i)=>v*(1-t)+last.direction[i]*t)),r=await sampleDirection(direction);
            if(inside(r))wet=r;if(inside(r)===firstInside)low=t;else high=t;
          }
          if(edgeCache.size>=2048)edgeCache.delete(edgeCache.keys().next().value);
          edgeCache.set(key,wet);samplingStats.edgeCachePeak=Math.max(samplingStats.edgeCachePeak,edgeCache.size);
        }
        clipped.push(wet);
      }
    }
    const start = overlays.length / VERTEX_STRIDE;
    for (const r of clipped) {
      const z = kind === 1 ? r.sample.waterLevelElevationM : kind === 2 ? r.sample.roadSurface.roadElevationM : r.sample.groundElevationM;
      const p = r.direction.map((v, k) => v * (radius + z + (kind === 1 ? .003 : .02)) - anchor[k]);
      overlays.push(...p, ...p, ...(kind === 1 ? waterColor : kind === 2 ? (r.sample.roadSurface.surfaceMaterial==='compacted-earth'?[.46,.40,.29]:[.35,.36,.39]) : [.80, .59, .26]), ...r.direction);
    }
    for (let k = 2; k < clipped.length; k++) (kind===1?waterIndices:overlayIndices).push(start, start + k - 1, start + k);
  }
  let taskLeaves=0,taskLeafBudget=6000,activeCell=-1;
  const cellVertexRanges=Array.from({length:GRID*GRID},(_,cell)=>{
    const x=cell%GRID,y=Math.floor(cell/GRID),a=y*(GRID+1)+x,
      heights=[a,a+1,a+GRID+1,a+GRID+2].map(i=>records[i].sample.groundElevationM);
    return [Math.min(...heights),Math.max(...heights)];
  });
  const cellWallEdges=Array.from({length:GRID*GRID},()=>[]);
  const indices = [];
  function appendGround(triangle, original = false, skirts = true) {
    taskLeaves++;
    if(activeCell>=0)for(const r of triangle){const range=cellVertexRanges[activeCell],z=r.sample.groundElevationM;range[0]=Math.min(range[0],z);range[1]=Math.max(range[1],z);}
    if (original) { indices.push(...triangle.map(r => r.index)); return; }
    const start = data.length / VERTEX_STRIDE;
    for (const r of triangle) {coarseLifts.push(...(r.coarseLift??radialLift(r.coarse,radius)));data.push(...r.ecef.map((v, k) => v - anchor[k]), ...r.coarse.map((v, k) => v - anchor[k]), ...color(r.sample.groundElevationM,r.sample), ...(r.normal ?? r.direction));}
    indices.push(start, start + 1, start + 2);
    if(!skirts)return;
    // Cover T junctions at an original triangle's boundary, where its neighbor
    // may retain a coarser edge. These walls join the fine edge to the original
    // edge plane and are display-only, like the tile's exterior skirts.
    for (let k = 0; k < 3; k++) {
      const a = triangle[k], b = triangle[(k + 1) % 3];
      if (!a.bary.some((v, i) => v === 0 && b.bary[i] === 0)) continue;
      // A display skirt up to the coarse plane must not become a dam through
      // the canonical water surface. Wet neighbouring triangles are refined
      // by the same water-domain test; their shared water covers the seam.
      if(displaySkirtCrossesWater(a,b,source.riverAt))continue;
      if (Math.max(...[a, b].map(r => Math.hypot(...r.ecef.map((v, i) => v - r.plane[i])))) < .001) continue;
      const wall = data.length / VERTEX_STRIDE;
      for (const [r, point] of [[a, a.ecef], [b, b.ecef], [a, a.plane], [b, b.plane]]) {coarseLifts.push(...(r.coarseLift??radialLift(r.coarse,radius)));data.push(...point.map((v, i) => v - anchor[i]), ...r.coarse.map((v, i) => v - anchor[i]), ...color(r.sample.groundElevationM,r.sample), ...r.normal);}
      indices.push(wall, wall + 2, wall + 1, wall + 1, wall + 2, wall + 3);
    }
  }
  const featureStepM=Math.max(.25,Math.min(4,...[...(source.features?.values()??[])].flatMap(e=>e.value.recipe.model.edges.flatMap(edge=>edge.points.map(p=>p.halfWidthM)))));
  let overlayTriangles = 0, featureRefinementLimited = physicalFeatureLoad.deferred>0;
  function mayIntersect(triangle, waterOnly = false, chartsOnly = false) {
    if(!chartsOnly&&tile.level>=10&&source.riverAt?.intersects(triangle.map(r=>r.direction),{waterOnly}))return true;
    for (const entry of source.features?.values() ?? []) {
      const chart = entry.value, local = triangle.map(r => { const p = geographic(r.direction); return chart.projection.toLocalIfWithin(p.latDeg, p.lonDeg); });
      if (local.some(p => !p)) continue;
      const span = Math.max(...triangle.flatMap((a, i) => triangle.slice(i + 1).map(b => Math.hypot(...a.ecef.map((v, k) => v - b.ecef[k])))));
      const rounding = .01 + 4 * span * span / radius;
      const minX = Math.min(...local.map(p => p.xM)) - rounding, maxX = Math.max(...local.map(p => p.xM)) + rounding;
      const minY = Math.min(...local.map(p => p.yM)) - rounding, maxY = Math.max(...local.map(p => p.yM)) + rounding;
      if ((waterOnly ? chart.waterDomains : chart.overlayDomains).some(b => b.maxXM >= minX && b.minXM <= maxX && b.maxYM >= minY && b.minYM <= maxY)) return true;
    }
    return false;
  }
  const groundBreaklines=[...(source.features?.values()??[])].flatMap(({value:chart})=>{
    const local=chart.projection.toLocalIfWithin(centerPoint.latDeg,centerPoint.lonDeg);
    if(!local)return [];
    const rho=Math.hypot(local.xM,local.yM)/radius+bound.angular,
      reach=rho>=Math.PI/2?Infinity:radius*bound.angular*(rho>1e-10?rho/Math.sin(rho):1)+128*Number.EPSILON*radius;
    return straightBridgeGroundBreaklines(chart.recipe.roadCenterlineProfiles??[])
      .filter(line=>Math.abs((local.xM-line.point.xM)*line.direction.xM+(local.yM-line.point.yM)*line.direction.yM)<=reach)
      .map(line=>({...line,chart}));
  });
  const breaklineEdges=new Map();
  samplingStats.groundBreaklines={available:groundBreaklines.length,splitTriangles:0,wallTriangles:0,maxHorizontalGapM:0};
  async function appendBreaklineGround(triangle){
    if(!groundBreaklines.length || tile.level<18)return false;
    const horizontalSpan=surfaceRadiusM*Math.max(...triangle.flatMap((a,i)=>triangle.slice(i+1).map(b=>Math.hypot(...a.direction.map((v,k)=>v-b.direction[k])))));
    if(horizontalSpan>1)return false;
    for(const line of groundBreaklines){
      const signed=r=>{const p=geographic(r.direction),q=line.chart.projection.toLocalIfWithin(p.latDeg,p.lonDeg);
        return q?(q.xM-line.point.xM)*line.direction.xM+(q.yM-line.point.yM)*line.direction.yM:NaN;};
      const split=await splitGroundTriangle(triangle,signed,async(a,b)=>{
        const ka=cacheKey(a.direction),kb=cacheKey(b.direction),forward=ka<kb,first=forward?a:b,last=forward?b:a,
          key=`${line.chart.recipe.id}/${line.id}|${forward?ka:kb}|${forward?kb:ka}`;
        let pair=breaklineEdges.get(key);
        if(!pair){
          let lo=0,hi=1;const firstNegative=signed(first)<0,edgeSpan=surfaceRadiusM*Math.hypot(...first.direction.map((v,k)=>v-last.direction[k]));
          const directionAt=t=>normalize(first.direction.map((v,k)=>v*(1-t)+last.direction[k]*t));
          // Bisection uses only geometry. Keep a 20 micrometre bracket so
          // spherical projection roundoff cannot put both samples on one side.
          for(let n=0;n<26 && (hi-lo)*edgeSpan>.00002;n++){
            const mid=(lo+hi)/2,negative=signed({direction:directionAt(mid)})<0;
            if(negative===firstNegative)lo=mid;else hi=mid;
          }
          const low=await sampleDirection(directionAt(lo)),high=await sampleDirection(directionAt(hi));
          if(!(signed(low)*signed(high)<0))return null;
          pair={negative:firstNegative?low:high,positive:firstNegative?high:low};
          pair.gapM=surfaceRadiusM*Math.hypot(...low.direction.map((v,k)=>v-high.direction[k]));
          if(breaklineEdges.size>=2048)breaklineEdges.delete(breaklineEdges.keys().next().value);
          breaklineEdges.set(key,pair);
        }
        // New cut vertices stay on their own canonical side during morph.
        return {...pair,negative:{...pair.negative,coarse:pair.negative.ecef,normal:pair.negative.direction},
          positive:{...pair.positive,coarse:pair.positive.ecef,normal:pair.positive.direction}};
      });
      if(!split)continue;
      // A transition may be hidden by another road/pad; don't create a wall
      // where the canonical ground has no measurable jump.
      if(Math.max(...split.pairs.map(p=>Math.abs(p.negative.sample.groundElevationM-p.positive.sample.groundElevationM)))<.001)continue;
      for(const tri of split.ground){
        const fixed=tri.map(r=>({...r,coarse:r.ecef,coarseLift:radialLift(r.ecef,radius)}));appendGround(fixed,false,false);
        await clipOverlay(fixed,1);await clipOverlay(fixed,2);await clipOverlay(fixed,3);
      }
      for(const tri of split.wall){
        const face=cross(tri[1].ecef.map((v,k)=>v-tri[0].ecef[k]),tri[2].ecef.map((v,k)=>v-tri[0].ecef[k]));
        if(Math.hypot(...face)<=1e-20)continue;
        const normal=normalize(face);appendGround(tri.map(r=>({...r,normal})),false,false);
        samplingStats.groundBreaklines.wallTriangles++;
        if(activeCell>=0)for(let k=0;k<3;k++)cellWallEdges[activeCell].push([tri[k].ecef,tri[(k+1)%3].ecef]);
      }
      samplingStats.groundBreaklines.splitTriangles++;
      samplingStats.groundBreaklines.maxHorizontalGapM=Math.max(samplingStats.groundBreaklines.maxHorizontalGapM,...split.pairs.map(p=>p.gapM));
      return true;
    }
    return false;
  }
  async function overlayTriangle(triangle, depth = 0) {
    if(await appendBreaklineGround(triangle))return;
    if (!mayIntersect(triangle)) { appendGround(triangle, depth === 0); if (source.manifest.sea) await clipOverlay(triangle, 1); return; }
    const span = Math.max(...triangle.flatMap((a, i) => triangle.slice(i + 1).map(b => Math.hypot(...a.ecef.map((v, k) => v - b.ecef[k])))));
    // Spend the finest subdivision budget on wet channels first. Broad valley
    // banks do not need the same 4 m grid as a narrow waterline.
    const waterIntersection=mayIntersect(triangle,true);
    const refineHere=tile.level>=14||(tile.level>=12&&waterIntersection);
    const chartIntersection=mayIntersect(triangle,false,true);
    const riverHalfWidth=waterIntersection?source.riverAt?.minimumIntersectingHalfWidth?.(triangle.map(r=>r.direction)):Infinity;
    const riverStep=Number.isFinite(riverHalfWidth)?Math.max(.5,Math.min(16,riverHalfWidth/4)):featureStepM;
    const targetStepM=chartIntersection?featureStepM:waterIntersection?riverStep:Math.max(featureStepM,32);
    if (refineHere && span > targetStepM && depth < 6 && taskLeaves+4<taskLeafBudget && overlayTriangles < 6000 && data.length / VERTEX_STRIDE < 50000) {
      const [a, b, c] = triangle;
      const middle = async (p, q) => {
        const r = await sampleDirection(normalize(p.direction.map((v, i) => v + q.direction[i])));
        r.coarseLift=r.sample.waterDepthM>0?radialLift(r.ecef,radius):(p.coarseLift??radialLift(p.coarse,radius)).map((v,i)=>(v+(q.coarseLift??radialLift(q.coarse,radius))[i])/2);r.normal = await surfaceNormal(r); r.coarse = r.sample.waterDepthM>0?r.ecef:p.coarse.map((v, i) => (v + q.coarse[i]) / 2);
        r.plane = p.plane.map((v, i) => (v + q.plane[i]) / 2); r.bary = p.bary.map((v, i) => (v + q.bary[i]) / 2); return r;
      };
      const ab = await middle(a, b), bc = await middle(b, c), ca = await middle(c, a);
      for (const tri of [[a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]]) await overlayTriangle(tri, depth + 1);
    } else {
      if(refineHere&&span>targetStepM)featureRefinementLimited=true;
      appendGround(triangle, depth === 0);
      overlayTriangles++;
      await clipOverlay(triangle, 1); await clipOverlay(triangle, 2); await clipOverlay(triangle, 3);
    }
  }
  const tasks=[];
  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) {
    const a = j * (GRID + 1) + i, b = a + 1, c = a + GRID + 1, d = c + 1;
    if (source.features || source.manifest.sea) for (const tri of [[a, c, b], [b, c, d]]) {
      const triangle=tri.map((v,i)=>({...records[v],plane:records[v].ecef,bary:[0,1,2].map(k=>k===i?1:0)}));
      tasks.push({triangle,cell:j*GRID+i,priority:mayIntersect(triangle,true)?0:mayIntersect(triangle)?1:2});
    } else indices.push(a, c, b, b, c, d);
  }
  tasks.sort((a,b)=>a.priority-b.priority);
  const waterTaskCount=tasks.filter(t=>t.priority===0).length,bankTaskCount=tasks.filter(t=>t.priority===1).length;
  const subdivision=featureSubdivisionBudgets(tile.level);
  const waterTaskBudget=Math.max(subdivision.minimumWaterPerTriangle,Math.floor(subdivision.water/Math.max(1,waterTaskCount))),bankTaskBudget=Math.max(subdivision.minimumBankPerTriangle,Math.floor(subdivision.bank/Math.max(1,bankTaskCount)));
  samplingStats.featureSubdivision={...subdivision,waterTaskCount,bankTaskCount,waterTaskBudget,bankTaskBudget};
  for(let i=0;i<tasks.length;i++){
    activeCell=tasks[i].cell;
    taskLeaves=0;taskLeafBudget=tasks[i].priority===0?waterTaskBudget:bankTaskBudget;
    await overlayTriangle(tasks[i].triangle);
    if(i%32===0)await cooperativeYield();
    if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  }
  // Exterior skirts conceal unequal-resolution edge gaps. They are display
  // geometry only, never queried as terrain. Parent triangle morph suppresses pops.
  const skirtM = Math.max(2, bound.radiusM / GRID * .4 + source.manifest.reliefBoundM / 2 ** tile.level);
  const edges = [Array.from({ length: GRID + 1 }, (_, i) => i), Array.from({ length: GRID + 1 }, (_, i) => i * (GRID + 1) + GRID),
    Array.from({ length: GRID + 1 }, (_, i) => GRID * (GRID + 1) + GRID - i), Array.from({ length: GRID + 1 }, (_, i) => (GRID - i) * (GRID + 1))];
  for (const edge of edges) {
    const base = data.length / VERTEX_STRIDE;
    for (const index of edge) {
      const record = records[index], original = data.slice(index * VERTEX_STRIDE, index * VERTEX_STRIDE + VERTEX_STRIDE);
      for (let k = 0; k < 3; k++) { original[k] -= record.direction[k] * skirtM; original[k + 3] -= record.direction[k] * skirtM; }
      coarseLifts.push(...record.coarseLift.map((v,k)=>v-record.direction[k]*skirtM));data.push(...original);
    }
    for (let i = 0; i < GRID; i++) {
      const a=records[edge[i]],b=records[edge[i+1]];
      // Original-grid skirt tops can bridge over a sub-grid water channel even
      // when both original endpoints are dry. Do not draw that artificial dam.
      if(displaySkirtCrossesWater(a,b,source.riverAt))continue;
      indices.push(edge[i], base + i, edge[i + 1], edge[i + 1], base + i, base + i + 1);
    }
  }
  const witnessIndex = (GRID / 2) * (GRID + 1) + GRID / 2, witness = records[witnessIndex], p = geographic(witness.direction);
  const strips=await buildCommittedWaterStrips(source,tile,signal,{maxVertices:Math.min(8192,Math.max(0,65535-overlays.length/VERTEX_STRIDE))});
  samplingStats.committedWaterStrips=strips.stats;if(strips.stats.limited)featureRefinementLimited=true;
  for(const triangle of strips.triangles){const start=overlays.length/VERTEX_STRIDE;for(const r of triangle){const p=r.direction.map((v,k)=>v*(radius+r.waterLevelElevationM+.005)-anchor[k]);overlays.push(...p,...p,...waterColor,...r.direction);}waterIndices.push(start,start+1,start+2);}
  const designedWater=await source.ready(()=>buildShapeFirstWaterStrips(source,tile,{maxVertices:Math.min(8192,Math.max(0,65535-overlays.length/VERTEX_STRIDE))}),signal);
  samplingStats.shapeFirstWater=designedWater.stats;if(designedWater.stats.limited)featureRefinementLimited=true;
  for(const triangle of designedWater.triangles){const start=overlays.length/VERTEX_STRIDE;for(const r of triangle){const p=r.direction.map((v,k)=>v*(radius+r.waterLevelElevationM+.005)-anchor[k]);overlays.push(...p,...p,...waterColor,...r.direction);}waterIndices.push(start,start+1,start+2);}
  const symbols=await source.ready(()=>buildShapeFirstRiverSymbols(source,tile,{maxVertices:Math.min(8192,Math.max(0,65535-overlays.length/VERTEX_STRIDE))}),signal);
  samplingStats.shapeFirstSymbols=symbols.stats;
  const symbolPosition=r=>{
    const [x,y,z]=r.direction,axes=[[x,y,z],[-x,-y,z],[y,-x,z],[-y,x,z],[z,x,y],[-z,x,-y]][tile.face],n=2**tile.level;
    const u=Math.max(0,Math.min(GRID,(axes[1]/axes[0]+1)*n/2*GRID-tile.x*GRID)),v=Math.max(0,Math.min(GRID,(axes[2]/axes[0]+1)*n/2*GRID-tile.y*GRID)),i=Math.min(GRID-1,Math.floor(u)),j=Math.min(GRID-1,Math.floor(v)),a=j*(GRID+1)+i;
    const drawn=triangleInterpolate(records[a].ecef,records[a+1].ecef,records[a+GRID+1].ecef,records[a+GRID+2].ecef,u-i,v-j);
    // A design line is draped over this LOD's drawn triangles, so coarse
    // interpolation does not bury it beneath the actual surface it describes.
    const height=Math.max(radius+r.elevationM,Math.hypot(...drawn))+2;
    return r.direction.map((value,k)=>value*height-anchor[k]);
  };
  for(const triangle of symbols.triangles){const start=overlays.length/VERTEX_STRIDE;for(const r of triangle){const p=symbolPosition(r);overlays.push(...p,...p,...RIVER_GUIDE_COLOR,...r.direction);}overlayIndices.push(start,start+1,start+2);}
  if (data.length / VERTEX_STRIDE > 65535 || overlays.length / VERTEX_STRIDE > 65535) throw new RangeError('Tile geometry exceeds Uint16 index capacity');
  const vertex = new Float32Array(data), edgeMask = Uint8Array.from({length:data.length/VERTEX_STRIDE},(_,i)=>vertexEdgeMask(tile,[0,1,2].map(k=>data[i*VERTEX_STRIDE+k]+anchor[k])));
  let maxVertexFloat32ErrorM = 0, morphErrorM = 0;
  const edgeMorphErrorM=[0,0,0,0];
  for (let i = 0; i < data.length; i += VERTEX_STRIDE) {
    maxVertexFloat32ErrorM = Math.max(maxVertexFloat32ErrorM, Math.hypot(data[i] - vertex[i], data[i + 1] - vertex[i + 1], data[i + 2] - vertex[i + 2]));
    const displacement=Math.hypot(data[i] - data[i + 3], data[i + 1] - data[i + 4], data[i + 2] - data[i + 5]);
    morphErrorM = Math.max(morphErrorM, displacement);
    for(let edge=0;edge<4;edge++)if(edgeMask[i/VERTEX_STRIDE]&(1<<edge))edgeMorphErrorM[edge]=Math.max(edgeMorphErrorM[edge],displacement);
  }
  const actualFeatures=[...source.descriptors().filter(f=>!f.visualOnly),...(source.manifest.riverDescriptors??[])].filter(f=>Math.acos(Math.max(-1,Math.min(1,dot(bound.center,f.center))))<=bound.angular+f.angularRadius+1e-8);
  const geometricError = tileGeometricError(source.manifest, tile, baseHeightRangeM, GRID,bound,actualFeatures);
  if(source.groundBoundsCertified?.(bound)){
    geometricError.intervalGroundErrorM=groundIntervalError(source.manifest,tile,heightRangeM,GRID);
    geometricError.geometricErrorM=geometricError.intervalGroundErrorM;
    geometricError.groundBoundMethod='canonical local height interval';
    if(tile.level>=14){
      // Local-cell bounds are needed before the planner spends its budget
      // descending every nearby tile to level18. This changes certificates,
      // not geometry, target error, or world data.
      // Every generated ground triangle remains inside one original grid
      // cell. Bound that whole spherical cell, not merely its vertex heights.
      let maximumSpanM=0,maximumHeightErrorM=0,maximumSurfaceDistanceM=0,edgeCertifiedCells=0,cellHullLow=Infinity,cellHullHigh=-Infinity;
      const drawnWallEdges=cellWallEdges.flat();
      for(let y=0;y<GRID;y++)for(let x=0;x<GRID;x++){
        if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
        const cell={face:tile.face,level:tile.level+4,x:tile.x*GRID+x,y:tile.y*GRID+y},cellBound=tileBound(cell,radius),
          range=await source.ready(()=>source.tileHeightBounds(cellBound),signal);
        cellHullLow=Math.min(cellHullLow,range[0]);cellHullHigh=Math.max(cellHullHigh,range[1]);
        maximumSpanM=Math.max(maximumSpanM,range[1]-range[0]);
        const heightError=cellHeightInterpolationError(range,cellVertexRanges[y*GRID+x]);
        maximumHeightErrorM=Math.max(maximumHeightErrorM,heightError);
        const height=Math.max(...range.map(Math.abs)),radial=groundIntervalError(source.manifest,cell,[height-heightError,height],1),
          edgeBound=drawnWallEdges.length && radial>.001?Math.min(...drawnWallEdges.map(edge=>groundToRenderedEdgeBound(cellBound,range,edge,radius))):Infinity;
        const surfaceBound=Math.max(edgeBound,closedGroundReverseBound(cellBound,range,radius));
        if(surfaceBound<radial)edgeCertifiedCells++;
        maximumSurfaceDistanceM=Math.max(maximumSurfaceDistanceM,Math.min(radial,surfaceBound));
      }
      // The 256 covering cells also bound the whole canonical surface. Retain
      // every rendered fine/coarse vertex (including skirts) so this tighter
      // hull remains safe during parent morphs and edge stitching. Projection
      // on one fixed unit direction bounds the norm of any convex triangle
      // combination from below; convexity bounds it from above by max norm.
      if(Number.isFinite(cellHullLow)&&Number.isFinite(cellHullHigh)&&cellHullLow<=cellHullHigh){
        let lo=Math.max(heightRangeM[0],cellHullLow),hi=Math.min(heightRangeM[1],cellHullHigh);
        for(let i=0;i<vertex.length;i+=VERTEX_STRIDE)for(const offset of [0,3]){
          const p=[0,1,2].map(k=>vertex[i+offset+k]+anchor[k]);
          lo=Math.min(lo,dot(p,bound.center)-radius);hi=Math.max(hi,Math.hypot(...p)-radius);
        }
        const margin=128*Number.EPSILON*(radius+Math.max(Math.abs(lo),Math.abs(hi)));
        geometricError.originalTileHeightRangeM=[...heightRangeM];
        heightRangeM[0]=lo-margin;heightRangeM[1]=hi+margin;
        geometricError.heightHullMethod='cell-union-and-rendered-vertices@1';
      }
      const height=Math.max(...heightRangeM.map(Math.abs));
      geometricError.cellGroundErrorM=groundIntervalError(source.manifest,tile,[height-maximumHeightErrorM,height],GRID);
      geometricError.maximumCellHeightSpanM=maximumSpanM;geometricError.maximumCellHeightErrorM=maximumHeightErrorM;geometricError.intervalCellCount=GRID*GRID;
      geometricError.geometricErrorM=Math.min(geometricError.geometricErrorM,geometricError.cellGroundErrorM);
      geometricError.groundBoundMethod='canonical grid-cell and rendered-vertex height intervals';
      if(edgeCertifiedCells){
        geometricError.cellSurfaceDistanceErrorM=maximumSurfaceDistanceM;
        geometricError.edgeCertifiedCells=edgeCertifiedCells;
        geometricError.errorMetric='symmetric positional distance to closed canonical ground surface';
        geometricError.geometricErrorM=Math.min(geometricError.geometricErrorM,maximumSurfaceDistanceM);
        geometricError.groundBoundMethod='cell height intervals or actually drawn bridge-end face edges';
      }
    }
  }
  geometricError.terrainErrorM += maxVertexFloat32ErrorM;
  geometricError.geometricErrorM += maxVertexFloat32ErrorM;
  // Preserve the first appended face too: existing Core audit probes address
  // its three original slots immediately after the regular grid.
  const ground=deduplicateMeshVertices(vertex,new Uint16Array(indices),{edgeMask,preservePrefix:Math.min(records.length+3,vertex.length/VERTEX_STRIDE)}),
    overlay=deduplicateMeshVertices(new Float32Array(overlays),new Uint16Array([...waterIndices,...overlayIndices]));
  const compactCoarse=ground.sourceIndices?ground.sourceIndices.flatMap(i=>coarseLifts.slice(i*3,i*3+3)):coarseLifts;
  const heightLifts=meshHeightLifts(ground.vertex,anchor,radius,compactCoarse),overlayHeightLifts=meshHeightLifts(overlay.vertex,anchor,radius);
  samplingStats.vertexCompaction={groundBefore:ground.inputVertices,groundAfter:ground.outputVertices,overlayBefore:overlay.inputVertices,overlayAfter:overlay.outputVertices,
    removedBytes:(ground.inputVertices-ground.outputVertices)*(VERTEX_STRIDE*4+1)+(overlay.inputVertices-overlay.outputVertices)*VERTEX_STRIDE*4};
  return { tile, pendingFeatures:physicalFeatureLoad.pending??0, anchor, heightLifts,overlayHeightLifts,heightRangeM, baseHeightRangeM, samplingStats, geometricError, featureRefinementLimited, morphErrorM, edgeMorphErrorM, vertex:ground.vertex, edgeMask:ground.edgeMask, index:ground.index, overlayVertex:overlay.vertex, waterIndexCount:waterIndices.length, overlayIndex:overlay.index,
    vertexCount: records.length, witness: { ...p, ...witness.sample, vertexGroundElevationM: witness.sample.groundElevationM,
      normalECEF: witness.normal, maxVertexFloat32ErrorM, float32PositionErrorM: Math.hypot(...witness.ecef.map((v, k) => v - anchor[k] - vertex[witnessIndex * VERTEX_STRIDE + k])) } };
}

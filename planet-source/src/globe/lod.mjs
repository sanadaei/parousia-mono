import { dot, tileBound } from './cube.mjs';

export const LOD_ERROR_METHOD = 'lipschitz-cube-triangles@1';
export const LOD_TARGET_PIXELS = 2;
const clampedAngle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

export function intersectingFeatures(manifest, bound) {
  return [...(manifest.featureCharts ?? (manifest.features ? [manifest.features] : [])),...(manifest.riverDescriptors??[])]
    .filter(f => clampedAngle(bound.center, f.center) <= bound.angular + f.angularRadius + 1e-8);
}

/** Rivers only excavate; treating their bound as an upward mountain makes
 * near-ground frusta refine imaginary terrain above the camera. */
export function featureDisplacementBounds(manifest,bound,features=intersectingFeatures(manifest,bound)){
 let riverMin=0,riverMax=0,chartMin=0,chartMax=0;
 for(const f of features){const lo=f.minimumOffsetM??-f.verticalAllowanceM,hi=f.maximumOffsetM??f.verticalAllowanceM;
 if(f.kind==='river'){riverMin=Math.min(riverMin,lo);riverMax=Math.max(riverMax,hi);}else{chartMin=Math.min(chartMin,lo);chartMax=Math.max(chartMax,hi);}}
 return[riverMin+chartMin,riverMax+chartMax];
}

/** Bounds the saved base sphere's gradient on the whole tile disk, including
 * latitude strips between samples and both polar caps. Missing metadata is
 * unknown, rather than evidence of a flat field. Units are meters per meter. */
export function terrainSlopeBound(manifest, bound) {
  const rows = manifest.base.grid.rows, alpha = Math.PI / (2 * rows);
  if (manifest.rowLipschitz?.length !== rows - 1 || manifest.poleLipschitz?.length !== 2) return Infinity;
  const lat = Math.asin(Math.max(-1, Math.min(1, bound.center[2])));
  const low = Math.max(-Math.PI / 2, lat - bound.angular), high = Math.min(Math.PI / 2, lat + bound.angular);
  const first = Math.max(0, Math.floor((Math.PI / 2 - high) / Math.PI * rows - .5));
  const last = Math.min(rows - 2, Math.floor((Math.PI / 2 - low) / Math.PI * rows - .5));
  let slope = 0;
  const include = value => { slope = !Number.isFinite(value) || value < 0 ? Infinity : Math.max(slope, value); };
  for (let i = first; i <= last; i++) include(manifest.rowLipschitz[i]);
  if (high >= Math.PI / 2 - alpha) include(manifest.poleLipschitz[0]);
  if (low <= -Math.PI / 2 + alpha) include(manifest.poleLipschitz[1]);
  const region=manifest.shapeFirstRegion;
  if(region&&clampedAngle(bound.center,region.center)<=bound.angular+region.angularRadius+1e-8)return Infinity; // Channel bank intervals, not the old base gradient, certify this draft.
  return slope;
}

/** Bound for the unmorphed ground mesh, not for overlays or display skirts.
 * On a cube face ||q|| >= 1 and ||D^2 normalize(q)|| <= 6. Taylor's remainder
 * for a triangle is therefore <= 3*d^2, d its parameter-space diameter.
 * Heights differ by <= K*R*d. Neither estimate relies on vertex-only probes.
 * Feature amplitude gives a separate, non-converging bound; no feature slope
 * or waterline accuracy is inferred from the base field's Lipschitz metadata. */
export function tileGeometricError(manifest, tile, heightRange = manifest.elevationRangeM, grid = 16, boundHint = null, featureHint = null) {
  const radius = manifest.base.frame.radiusM, bound = boundHint ?? tileBound(tile, radius);
  const diameter = 2 * Math.SQRT2 / (2 ** tile.level * grid);
  const features = featureHint ?? intersectingFeatures(manifest, bound);
  // A chart is applied to the already excavated river terrain. These two
  // displacement budgets compose; taking their maximum loses one layer.
  // Charts among themselves and rivers among themselves use envelopes.
  const offsets = featureDisplacementBounds(manifest, bound, features);
  const allowance = Math.max(Math.abs(offsets[0]), Math.abs(offsets[1]));
  const slope = terrainSlopeBound(manifest, bound);
  const height = Math.max(Math.abs(heightRange[0]), Math.abs(heightRange[1]));
  // Include local Float32 position rounding before the mesh exists as well.
  // Four tile radii cover the parent target; additional feature displacement
  // is independent of the base field's slope certificate.
  const roundingM = 128 * Number.EPSILON * (radius + height)
    + 2 ** -23 * (4 * bound.radiusM * (1 + height / radius) + heightRange[1] - heightRange[0] + 2 * allowance);
  const curvatureErrorM = 3 * (radius + height) * diameter ** 2;
  const terrainErrorM = slope * radius * diameter + curvatureErrorM + roundingM;
  const featureErrorM = 2 * allowance;
  return { method: LOD_ERROR_METHOD, terrainErrorM, featureErrorM, geometricErrorM: terrainErrorM + featureErrorM,
    baseCertified: Number.isFinite(terrainErrorM), featureStatus: features.length ? 'amplitude-only' : 'none' };
}

/** Error of the ground triangles actually displayed, including their current
 * parent morph or stitched edge displacement. It does not certify overlays,
 * water boundaries or skirts. A fully fine tile needs no morph metadata. */
export function displayedGroundError(tile, morph, stitchMask=0) {
  const weight=Math.max(0,Math.min(1,1-morph));
  let displacement=weight===0?0:(tile.morphErrorM??Infinity)*weight;
  if(stitchMask){
    const edges=tile.edgeMorphErrorM;
    // Only stitched vertices are forced to the parent surface. Interior
    // displacement may be much larger on a road/river crossing this tile.
    const valid=Array.isArray(edges)&&edges.length===4&&edges.every(v=>Number.isFinite(v)&&v>=0);
    const stitched=valid?Math.max(0,...edges.filter((_,i)=>stitchMask&(1<<i))):(tile.morphErrorM??Infinity);
    displacement=Math.max(displacement,stitched);
  }
  return {baseM:(tile.geometricError?.terrainErrorM??Infinity)+displacement,
    groundM:(tile.geometricError?.geometricErrorM??Infinity)+displacement};
}

/** If the true field AND every triangle vertex lie in [lo,hi], the radial
 * interpolation term is bounded by hi-lo. The remaining spherical direction
 * interpolation uses the same normalized-cube Taylor bound as the base mesh.
 * This whole-tile interval is conservative, not a vertex-only error estimate. */
export function groundIntervalError(manifest,tile,range,grid=16,boundHint=null){
  if(!Array.isArray(range)||range.length!==2||!range.every(Number.isFinite)||range[0]>range[1])return Infinity;
  const radius=manifest.base.frame.radiusM,bound=boundHint??tileBound(tile,radius),height=Math.max(...range.map(Math.abs)),span=range[1]-range[0],diameter=2*Math.SQRT2/(2**tile.level*grid);
  return span+3*(radius+height)*diameter**2+128*Number.EPSILON*(radius+height)+2**-23*(4*bound.radiusM*(1+height/radius)+span);
}

/** Perspective bound for points in the tile sphere in front of the near plane.
 * A tile straddling that plane needs subdivision; its screen bound is unknown.
 * Pixel height must be the physical framebuffer height, including device DPR. */
export function projectedErrorPixels(errorM, manifest, tile, heightRange, camera, pixelHeight, boundHint=null) {
  const scale=camera.heightScale??1;heightRange=heightRange.map(v=>v*scale);errorM*=scale;
  const radius = manifest.base.frame.radiusM, b = boundHint??tileBound(tile, radius), mid = (heightRange[0] + heightRange[1]) / 2;
  const relative = b.center.map((v, i) => v * (radius + mid) - camera.eye[i]);
  const rb=(b.radiusM*(1+Math.max(Math.abs(heightRange[0]),Math.abs(heightRange[1]))/radius)+128*Number.EPSILON*radius)*(1+2**-21),vertical=(heightRange[1]-heightRange[0])/2;
  const depth=dot(relative,camera.forward)-rb-vertical*Math.abs(dot(b.center,camera.forward));
  if(depth<=camera.near||!Number.isFinite(errorM))return Infinity;
  const transverse=Math.hypot(Math.abs(dot(relative,camera.right))+rb+vertical*Math.abs(dot(b.center,camera.right)),Math.abs(dot(relative,camera.up))+rb+vertical*Math.abs(dot(b.center,camera.up)));
  return errorM * pixelHeight * .5 * camera.focal / depth * Math.hypot(1, transverse / depth);
}

/** A barycentric triangle height lies within its vertex-height hull. Bound
 * pointwise height error against that hull instead of pairing two arbitrary
 * heights from the wider terrain enclosure. Spherical chord error is separate. */
export function cellHeightInterpolationError(terrainRange, vertexRange){
  for(const r of [terrainRange,vertexRange])if(!Array.isArray(r)||r.length!==2||!r.every(Number.isFinite)||r[0]>r[1])throw new RangeError('Invalid height interval');
  return Math.max(0,terrainRange[1]-vertexRange[0],vertexRange[1]-terrainRange[0]);
}

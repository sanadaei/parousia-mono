import {createTerrainBandNoise,terrainBandGradientMultiplier} from './terrain-band-noise.mjs';
import { createPeriodicHermiteField } from './periodic-field.mjs';
import { createSphericalNoise } from './spherical-noise.mjs';
import { geographicPoint, sphereBasis } from './spherical.mjs';

export const ANCHORED_DETAIL_METHOD = 'anchored-spherical-residual-bands@2';
const smooth = t => t * t * (3 - 2 * t);

/** Subtract a C1 interpolant of the noise at source centers. This preserves
 * those centers without suppressing entire grid lines or the polar caps.
 * Both terms lie in [-1,1], so half their difference is bounded by one.
 * The constraint is amplitude, not the old four-corner elevation envelope. */
export function createAnchoredSphericalDetail(state, paged = null) {
  const { columns: w, rows: h } = state.grid, radius = state.frame.radiusM;
  const bands = state.detail.bands.filter(b => b.amplitudeM > 0).map(b => {
    const noise = createTerrainBandNoise(`${state.seed}|${b.id}|${b.wavelengthM}`, radius, b);
    const anchors = paged ? null : Array.from({ length: w * h }, (_, i) => noise(sphereBasis(geographicPoint(
      90 - (Math.floor(i / w) + .5) * 180 / h, (i % w + .5) * 360 / w)).up));
    const field = paged ? paged.fieldForBand(b, noise) : createPeriodicHermiteField(anchors, w, h);
    const north = paged ? paged.poleMeans[b.id].north : anchors.slice(0, w).reduce((s, v) => s + v / w, 0);
    const south = paged ? paged.poleMeans[b.id].south : anchors.slice(-w).reduce((s, v) => s + v / w, 0);
    const interpolated = (x, y) => {
      if (y < .5) { const t = smooth(y * 2); return north * (1 - t) + field(x, .5) * t; }
      if (y > h - .5) { const t = smooth((h - y) * 2); return south * (1 - t) + field(x, h - .5) * t; }
      return field(x, y);
    };
    return { ...b, noise, interpolated };
  });
  // Every normalized anchor Bezier control is in [-1,1], hence each patch
  // coordinate derivative is <=6. The cap mean/ring difference is <=2.
  const alpha = Math.PI / (2 * h), lonRate = w / (2 * Math.PI), latRate = h / Math.PI;
  const anchorBound = Math.max(6 * Math.hypot(lonRate / (radius * Math.sin(alpha)), latRate / radius),
    Math.hypot(18 * lonRate / (radius * Math.sin(alpha)), 3 / (radius * alpha)));
  const lipschitzMPerM = bands.reduce((s, b) => s + .5 * b.amplitudeM
    * (3 * Math.sqrt(3) * terrainBandGradientMultiplier(b) / b.wavelengthM + anchorBound), 0) * (1 + 1e-10);
  const lipschitzForLatitudeRange=(low,high)=>{
    if(![low,high].every(Number.isFinite)||low>high||low< -Math.PI/2||high>Math.PI/2)throw new RangeError('Invalid detail latitude range');
    // Interior paths never encounter the polar collapse. Keep the original
    // cap bound whenever the requested interval touches a cap.
    const localAnchor=low<=-Math.PI/2+alpha||high>=Math.PI/2-alpha?anchorBound:6*Math.hypot(lonRate/(radius*Math.cos(Math.max(Math.abs(low),Math.abs(high)))),latRate/radius);
    return bands.reduce((s,b)=>s+.5*b.amplitudeM*(3*Math.sqrt(3)*terrainBandGradientMultiplier(b)/b.wavelengthM+localAnchor),0)*(1+1e-10);
  };
  const sample = (point, x, y) => {
    if (Number.isInteger(x - .5) && Number.isInteger(y - .5)) return 0;
    const up = sphereBasis(point).up;
    return bands.reduce((s, b) => s + .5 * b.amplitudeM * (b.noise(up) - b.interpolated(x, y)), 0);
  };
  const sampleParts=(point,x,y)=>{if(Number.isInteger(x-.5)&&Number.isInteger(y-.5))return bands.map(()=>0);const up=sphereBasis(point).up;return bands.map(b=>.5*b.amplitudeM*(b.noise(up)-b.interpolated(x,y)));};
  return { sample, sampleParts, lipschitzMPerM, lipschitzForLatitudeRange };
}

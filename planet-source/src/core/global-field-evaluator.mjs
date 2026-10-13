import { LOCAL_SHORE_METHOD,localShoreConstraint,SHORE_DETAIL_METHOD,MULTISCALE_SHORE_METHOD,multiscaleShoreConstraints,shoreDetailConstraint } from './shore-detail.mjs';
import { finiteNumber } from './contract-validation.mjs';
import { sphereBasis } from './spherical.mjs';
import { createSphericalNoise } from './spherical-noise.mjs';

// One canonical evaluation path for both resident and streamed source data.
export function createGlobalFieldEvaluator(state, source, evaluate, northPole, southPole, anchoredDetail) {
  const { columns: w, rows: h } = state.grid;
  const wrap = x => (x % w + w) % w;
  const bandFunctions = anchoredDetail ? [] : state.detail.bands.map(b => ({ ...b, noise: createSphericalNoise(`${state.seed}|${b.id}|${b.wavelengthM}`, state.frame.radiusM, b.wavelengthM) }));
  const totalAmplitude = bandFunctions.reduce((sum, b) => sum + b.amplitudeM, 0), smooth = t => t * t * (3 - 2 * t);
  const shore=state.detail.method===SHORE_DETAIL_METHOD?shoreDetailConstraint(state.detail.shoreLevelsM,state.detail.bands.reduce((n,b)=>n+b.amplitudeM,0)):null;
  const multiscale=state.detail.method===MULTISCALE_SHORE_METHOD?multiscaleShoreConstraints(state.detail):null;
  const localShore=state.detail.method===LOCAL_SHORE_METHOD?localShoreConstraint(state.detail,state.grid):null;
  function fieldAt(point) {
    const lonE = point.lonDeg < 0 ? point.lonDeg + 360 : point.lonDeg;
    const x = lonE / 360 * w, y = (90 - point.latDeg) / 180 * h;
    let base = evaluate(x, y), detail = 0;
    if (y < 0.5) { const t = y / 0.5; base = northPole * (1 - smooth(t)) + evaluate(x, 0.5) * smooth(t); }
    else if (y > h - 0.5) { const t = (h - y) / 0.5; base = southPole * (1 - smooth(t)) + evaluate(x, h - 0.5) * smooth(t); }
    else if (totalAmplitude > 0) {
      const xx = Math.floor(x - 0.5), yy = Math.min(h - 2, Math.floor(y - 0.5));
      const tx = x - 0.5 - xx, ty = y - 0.5 - yy;
      const corners = [source[yy * w + wrap(xx)], source[yy * w + wrap(xx + 1)], source[(yy + 1) * w + wrap(xx)], source[(yy + 1) * w + wrap(xx + 1)]];
      const min = Math.min(...corners), max = Math.max(...corners), span = max - min;
      if (span > 0 && tx !== 0 && ty !== 0) {
        const bubble = 16 * tx * tx * (1 - tx) ** 2 * 16 * ty * ty * (1 - ty) ** 2;
        const margin = Math.max(0, (base - min) * (max - base) / span);
        const v = sphereBasis(point).up, noiseSum = bandFunctions.reduce((sum, b) => sum + b.amplitudeM * b.noise(v), 0);
        detail = bubble * margin * Math.min(1, 4 * totalAmplitude / span) * noiseSum / totalAmplitude;
      }
    }
    if (anchoredDetail) detail = anchoredDetail.sample(point, x, y);
    if(multiscale)detail=anchoredDetail.sampleParts(point,x,y).reduce((sum,v,i)=>sum+multiscale[i].constraint.apply(base+state.frame.elevationOffsetM,v),0);
    if(localShore)detail=localShore(base+state.frame.elevationOffsetM,anchoredDetail.sampleParts(point,x,y),x,y);
    if(shore)detail=shore.apply(base+state.frame.elevationOffsetM,detail);
    const ground = base + detail + state.frame.elevationOffsetM;
    finiteNumber(ground, 'global ground elevation');
    return { ground, base: base + state.frame.elevationOffsetM, detail: detail || 0, x, y };
  }
  return fieldAt;
}

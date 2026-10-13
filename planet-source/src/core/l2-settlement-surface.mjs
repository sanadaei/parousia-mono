import {copyJson, hashJson} from './json-contract.mjs';
import {createHash} from './sha256.mjs';
import {createSphericalProjection} from './spherical.mjs';
import {createShapeFirstCandidateChannels} from './shape-first-channels.mjs';
import {validateL2SettlementHandoff} from './l2-settlement-handoff.mjs';

export const L2_SETTLEMENT_DETAIL_SCHEMA = 'l2-settlement-detail@1';
const check = (value, message) => { if (!value) throw new RangeError(`L2 detail: ${message}`); };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const freeze = value => {
  if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
};

/** Bind an explicitly supplied native source to one L1 handoff. This is a saved
 * local design, not a new global terrain authority or a neighbouring seam. */
export function makeL2SettlementDetail(handoff, {candidate, water, center, radiusM, elevationOffsetM = 0, provenance}) {
  validateL2SettlementHandoff(handoff);
  const body = copyJson({schema: L2_SETTLEMENT_DETAIL_SCHEMA, sourceWorldId: handoff.sourceWorldId,
    parentLayerId: handoff.layerId, handoffId: handoff.id, radiusM,
    center, elevationOffsetM, candidate, water, provenance});
  const detail = {...body, id: hashJson(body)};
  createL2SettlementSurface(detail, handoff);
  return detail;
}

/** No coarse fallback: beyond this native domain water/height are unknown.
 * The analytic designed river bed is shared by housing, farms, roads and UI. */
export function createL2SettlementSurface(input, handoff) {
  const detail = copyJson(input);
  check(detail?.schema === L2_SETTLEMENT_DETAIL_SCHEMA, 'unsupported schema');
  const {id, ...body} = detail;
  check(typeof id === 'string' && id === hashJson(body), 'content identity mismatch');
  check(['sourceWorldId','parentLayerId','handoffId'].every(key => typeof detail[key] === 'string' && detail[key]), 'missing source identity');
  check(Number.isFinite(detail.radiusM) && detail.radiusM > 0, 'invalid radius');
  check(Number.isFinite(detail.elevationOffsetM), 'invalid elevation datum');
  check(detail.provenance && typeof detail.provenance.method === 'string' && detail.provenance.method, 'explicit provenance required');
  const center = detail.center;
  check(center && Number.isFinite(center.latDeg) && Math.abs(center.latDeg) <= 90 && Number.isFinite(center.lonDeg), 'invalid center');
  if (handoff) {
    validateL2SettlementHandoff(handoff);
    check(detail.sourceWorldId === handoff.sourceWorldId && detail.parentLayerId === handoff.layerId && detail.handoffId === handoff.id, 'handoff geography mismatch');
  }
  const candidate = detail.candidate, g = candidate?.grid;
  check(candidate?.schema === 'shape-first-candidate@1', 'native shape source required');
  check(g && [g.columns,g.rows].every(v => Number.isSafeInteger(v) && v >= 2) && g.columns*g.rows <= 32768, 'native grid budget exceeded');
  check(g.row0 === 'north' && g.yDirection === 'south', 'native axes must be east/south from northwest');
  check([g.cellSizeM,g.cellSizeYM].every(v => Number.isFinite(v) && v > 0 && v <= 100), 'native spacing must be at most 100m');
  check(Array.isArray(candidate.elevation) && candidate.elevation.length === g.columns*g.rows && candidate.elevation.every(Number.isFinite), 'invalid native elevations');
  const widthM = (g.columns-1)*g.cellSizeM, heightM = (g.rows-1)*g.cellSizeYM;
  check(widthM <= 20000 && heightM <= 20000 && Math.hypot(widthM,heightM)/2 < detail.radiusM*.1, 'domain budget exceeded');
  check(Array.isArray(candidate.rivers) && candidate.rivers.length > 0 && candidate.rivers.length <= 128 &&
    candidate.rivers.every(r => Array.isArray(r) && r.length >= 2 && r.length <= 4096 && r.every(p => p && Number.isFinite(p.xM) && Number.isFinite(p.yM) && p.xM >= 0 && p.xM <= widthM && p.yM >= 0 && p.yM <= heightM)), 'rivers outside native domain');
  const water = detail.water;
  check(water?.schema === 'shape-first-water-annotation@1' && water.scenario?.kind === 'synthetic-demonstration', 'explicit designed water scenario required');
  check(Number.isFinite(water.scenario.runoffMmPerYear) && water.scenario.runoffMmPerYear >= 0, 'invalid runoff assumption');
  for (const [field, value] of [['height', candidate.elevation], ['rivers', candidate.rivers]]) {
    check(water.preservation?.before?.[field] === digest(value) && water.preservation?.after?.[field] === digest(value), `water ${field} geometry mismatch`);
  }
  const projection = createSphericalProjection({centerLatDeg:center.latDeg, centerLonDeg:center.lonDeg,
    radiusM:detail.radiusM, maxRadiusM:Math.min(detail.radiusM*.1, Math.hypot(widthM,heightM)/2+100)});
  const channels = createShapeFirstCandidateChannels(candidate, water);
  freeze(detail);
  function local(latDeg, lonDeg) {
    const p = projection.toLocalIfWithin(latDeg, lonDeg);
    if (!p) return null;
    const xM = p.xM+widthM/2, yM = heightM/2-p.yM;
    if (xM < -1e-6 || yM < -1e-6 || xM > widthM+1e-6 || yM > heightM+1e-6) return null;
    return {xM:Math.max(0,Math.min(widthM,xM)), yM:Math.max(0,Math.min(heightM,yM))};
  }
  function sampleSurfaceAt(latDeg, lonDeg) {
    const p = local(latDeg,lonDeg);
    if (!p) return {groundElevationM:NaN, waterDepthM:NaN, waterLevelElevationM:NaN, unknown:true};
    const q = channels.sample(p.xM,p.yM);
    return {groundElevationM:q.groundElevationM+detail.elevationOffsetM, waterDepthM:q.waterDepthM,
      waterLevelElevationM:q.wet ? q.waterLevelM+detail.elevationOffsetM : null,
      waterSourceIds:q.riverId ? [q.riverId] : [], sitingWet:q.wet, unknown:false};
  }
  return Object.freeze({worldId:detail.sourceWorldId, sourceLayerId:detail.parentLayerId,
    surfaceId:id, layer:'L2', detailKind:'native-l2-terrain@1', method:'saved-native-shape-and-designed-channels@1',
    frame:Object.freeze({radiusM:detail.radiusM}), nativeSpacingM:Object.freeze({east:g.cellSizeM,north:g.cellSizeYM}),
    extent:Object.freeze({widthM,heightM}), projection, local, sampleSurfaceAt,
    groundElevationAt:(lat,lon)=>sampleSurfaceAt(lat,lon).groundElevationM,
    toSnapshot:()=>copyJson(detail)});
}

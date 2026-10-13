// Road-over-road crossings, at-grade junctions and culverts for the visualizer.
//
// Core records are used when the scene (or its bundle) carries them:
// `scene.roadJunctions` / `bundle.roadJunctions` may be an array of crossing
// records or `{ junctions, crossings, overpasses, culverts }`, and
// `bundle.culverts` an array of culverts. Otherwise they are derived here from
// the drawn geometry: road centerline intersections (and road ends meeting
// another road) become junctions, classified by the vertical separation of the
// two road profiles; rivers passing under a road outside any bridge span or
// wet crossing run become culverts with their invert at the base ground.
// Everything in this module is DOM-free.

import { distanceToSegment, boundsOfPoints } from './util.mjs';
import { inspectRoadGradeSeparations, classifyRoadGradeSeparation, ROAD_CROSSING_STATUSES,
  ROAD_GRADE_SEPARATION_DEFAULTS } from '../core/road-junctions.mjs';
import { verticalCurve } from '../core/road-geometry.mjs';

export const JUNCTION_SETTINGS = Object.freeze({
  minimumClearanceM: ROAD_GRADE_SEPARATION_DEFAULTS.requiredVehicleClearanceM,
  structureDepthM: ROAD_GRADE_SEPARATION_DEFAULTS.deckThicknessM,
  atGradeToleranceM: ROAD_GRADE_SEPARATION_DEFAULTS.atGradeToleranceM,
  mergeDistanceM: 1.0,     // intersections closer than this are one junction
  inspectRadiusM: 20,      // inspector search radius beyond the road half width
});

export const JUNCTION_STATUSES = ROAD_CROSSING_STATUSES;

export const JUNCTION_STATUS_LABELS = Object.freeze({
  'grade-separated-clearance-met': 'Clearance met', 'insufficient-vertical-clearance': 'Insufficient clearance',
  'at-grade-matched': 'At-grade junction', collision: 'Collision',
});

export const JUNCTION_STATUS_COLORS = Object.freeze({
  'grade-separated-clearance-met': '#4fc38a', 'insufficient-vertical-clearance': '#e0605a',
  'at-grade-matched': '#d9dde4', collision: '#ff3344',
});

export const CULVERT_COLOR = '#5ce1ff';

const finite = v => typeof v === 'number' && Number.isFinite(v);
const num = (...values) => values.find(finite) ?? null;

/** Status of a road-over-road crossing from its vertical separation / clearance. */
export function classifyRoadCrossing({ verticalSeparationM = null, clearanceM = null, requiredClearanceM = null,
  deckThicknessM = null, atGradeEligible = true } = {}, settings = JUNCTION_SETTINGS) {
  const s = { ...JUNCTION_SETTINGS, ...settings };
  return classifyRoadGradeSeparation({ verticalSeparationM, verticalClearanceM: clearanceM,
    requiredVehicleClearanceM: requiredClearanceM ?? s.minimumClearanceM,
    deckThicknessM: deckThicknessM ?? s.structureDepthM, atGradeToleranceM: s.atGradeToleranceM, atGradeEligible });
}

// ---------- Geometry ----------

/** Polyline with cumulative stations. */
function stationed(points) {
  const st = [0];
  for (let i = 1; i < points.length; i++) st.push(st[i - 1] + Math.hypot(points[i].xM - points[i - 1].xM, points[i].yM - points[i - 1].yM));
  return st;
}

/** Proper intersection of segments ab and cd: parameters (t, u) in [0, 1], or null. */
function segmentIntersection(a, b, c, d) {
  const rx = b.xM - a.xM, ry = b.yM - a.yM, sx = d.xM - c.xM, sy = d.yM - c.yM;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const qx = c.xM - a.xM, qy = c.yM - a.yM;
  const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
  return t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9 ? { t: Math.min(1, Math.max(0, t)), u: Math.min(1, Math.max(0, u)) } : null;
}

const unit = (a, b) => { const l = Math.hypot(b.xM - a.xM, b.yM - a.yM) || 1; return { x: (b.xM - a.xM) / l, y: (b.yM - a.yM) / l }; };

/** Nearest point of a road polyline: station, offset distance and unit direction. */
export function nearestOnRoad(road, xM, yM, st = stationed(road.points)) {
  let best = null;
  for (let i = 1; i < road.points.length; i++) {
    const a = road.points[i - 1], b = road.points[i], d = distanceToSegment(xM, yM, a.xM, a.yM, b.xM, b.yM);
    if (!best || d.distance < best.distance) best = { distance: d.distance, stationM: st[i - 1] + d.t * (st[i] - st[i - 1]), direction: unit(a, b), index: i - 1 };
  }
  return best;
}

/** Road surface elevation at a station: designed centerline profile, else base ground at the point. */
export function roadElevationAt(scene, roadId, stationM, point = null) {
  const profile = scene.roadProfiles?.get?.(roadId);
  if (profile?.length) {
    let lo = 0, hi = profile.length - 1;
    if (profile.length === 1) return profile[0].roadElevationM ?? null;
    stationM = Math.max(profile[0].distanceM, Math.min(profile[hi].distanceM, stationM));
    // Core selects the segment ending at an exact knot. Match that choice so
    // polynomial rounding cannot flip a clearance threshold in the UI.
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (profile[mid].distanceM < stationM) lo = mid; else hi = mid; }
    const a = profile[lo], b = profile[hi];
    return finite(a.roadElevationM) && finite(b.roadElevationM) ? verticalCurve(a, b).at(stationM).roadElevationM : null;
  }
  if (point && typeof scene.base?.groundElevationAt === 'function') {
    try { return scene.base.groundElevationAt(point.xM, point.yM); } catch { return null; }
  }
  return null;
}

// ---------- Normalization of core records ----------

/** One road-over-road crossing / junction record in the shape the UI draws. */
export function normalizeRoadCrossing(raw, index = 0, settings = JUNCTION_SETTINGS) {
  const p = raw.point ?? raw.location ?? raw;
  const roadIds = raw.roadIds ?? [raw.upperRoadId ?? raw.roadAId ?? raw.overRoadId, raw.lowerRoadId ?? raw.roadBId ?? raw.underRoadId].filter(v => v != null);
  const upperElevationM = num(raw.upperElevationM, raw.upperRoadElevationM, raw.deckElevationM);
  const lowerElevationM = num(raw.lowerElevationM, raw.lowerRoadElevationM);
  const verticalSeparationM = num(raw.verticalSeparationM, raw.separationM,
    finite(upperElevationM) && finite(lowerElevationM) ? upperElevationM - lowerElevationM : null);
  const requiredClearanceM = num(raw.requiredClearanceM, raw.requiredVehicleClearanceM, raw.minimumClearanceM);
  const clearanceM = num(raw.clearanceM, raw.verticalClearanceM);
  const legacyStatuses = { 'clearance-met': 'grade-separated-clearance-met',
    'insufficient-clearance': 'insufficient-vertical-clearance', 'at-grade': 'at-grade-matched' };
  const status = JUNCTION_STATUSES.includes(raw.status) ? raw.status
    : legacyStatuses[raw.status] ?? (raw.kind === 'at-grade' || raw.type === 'at-grade' || raw.gradeSeparated === false ? 'at-grade-matched'
      : classifyRoadCrossing({ verticalSeparationM, clearanceM, requiredClearanceM,
        deckThicknessM: num(raw.deckThicknessM, raw.structureDepthM),
        atGradeEligible: raw.kind !== 'grade-separated' && raw.gradeSeparated !== true }, settings));
  const kind = status == null ? 'unknown' : status === 'at-grade-matched' ? 'at-grade' : 'grade-separated';
  return {
    id: String(raw.id ?? raw.junctionId ?? raw.crossingId ?? `junction:${index}`),
    kind, status,
    roadIds, upperRoadId: kind === 'at-grade' ? null : raw.upperRoadId ?? roadIds[0] ?? null,
    lowerRoadId: kind === 'at-grade' ? null : raw.lowerRoadId ?? roadIds[1] ?? null,
    xM: p.xM, yM: p.yM, stationsM: { ...(raw.stationsM ?? {}) },
    upperElevationM, lowerElevationM, verticalSeparationM, clearanceM, requiredClearanceM,
    direction: raw.direction ?? null, source: raw.source ?? 'core',
  };
}

/** One culvert record in the shape the UI draws. */
export function normalizeCulvert(raw, index = 0) {
  const p = raw.point ?? raw.location ?? raw;
  const invertElevationM = num(raw.invertElevationM, raw.invertM, raw.inletInvertElevationM);
  const roadElevationM = num(raw.roadElevationM, raw.crownElevationM);
  return {
    id: String(raw.id ?? raw.culvertId ?? `culvert:${index}`), roadId: raw.roadId ?? null,
    stationM: num(raw.stationM, raw.distanceM, raw.stationDistanceM), xM: p.xM, yM: p.yM, invertElevationM, roadElevationM,
    coverM: num(raw.coverM, finite(roadElevationM) && finite(invertElevationM) ? roadElevationM - invertElevationM : null),
    diameterM: num(raw.diameterM, raw.spanM, raw.widthM), waterSourceIds: raw.waterSourceIds ?? (raw.riverId ? [raw.riverId] : []),
    flowDirection: raw.flowDirection ?? null, source: raw.source ?? 'core',
  };
}

function coreRecords(scene) {
  const bundle = scene.rawBundle ?? {};
  const raw = scene.roadJunctions ?? bundle.roadJunctions ?? bundle.junctions ?? null;
  const out = { crossings: null, culverts: scene.culverts ?? bundle.culverts ?? null };
  if (Array.isArray(raw)) out.crossings = raw;
  else if (raw && typeof raw === 'object') {
    out.crossings = [...(raw.junctions ?? []), ...(raw.crossings ?? []), ...(raw.overpasses ?? [])];
    out.culverts ??= raw.culverts ?? null;
  }
  return out;
}

// ---------- Derivation from geometry ----------

/** Road-over-road crossings and junctions from centerline geometry and profiles. */
export function deriveRoadCrossings(scene, settings = JUNCTION_SETTINGS) {
  const s = { ...JUNCTION_SETTINGS, ...settings };
  const roads = (scene.overlays?.roads ?? []).filter(r => r.points?.length > 1);
  // Intersect the sparse plan alignment in core, then evaluate the designed
  // vertical curves only at crossings. Dense profile samples are not separate
  // plan segments and must not exhaust the intersection budget.
  const geometry = inspectRoadGradeSeparations(roads.map(r => ({ ...r, structureKind: 'at-grade',
    points: r.points.map(p => ({ xM: p.xM, yM: p.yM, roadElevationM: 0 })) })));
  const surface = (id, station, point) => {
    const road = roads.find(r => r.id === id), profile = scene.roadProfiles?.get?.(id);
    const at = profile?.findIndex(p => p.distanceM >= station) ?? -1;
    const b = at >= 0 ? profile[at] : profile?.at(-1), a = at > 0 ? profile[at - 1] : b;
    const p = station === b?.distanceM ? b : a;
    const kind = station === b?.distanceM ? b?.structureKind ?? road.structureKind ?? 'at-grade'
      : a?.segmentKind ?? a?.structureKind ?? road.structureKind ?? 'at-grade';
    return { roadElevationM: roadElevationAt(scene, id, station, point), kind,
      deckThicknessM: kind === 'bridge-deck' ? p?.deckThicknessM ?? road.deckThicknessM ?? s.structureDepthM : road.deckThicknessM ?? 0,
      atGradeEligible: kind !== 'bridge-deck' && road.gradeSeparated !== true };
  };
  return geometry.crossings.map((raw, i) => {
    const [idA, idB] = raw.roadIds, A = surface(idA, raw.stationsM[idA], raw), B = surface(idB, raw.stationsM[idB], raw);
    const known = finite(A.roadElevationM) && finite(B.roadElevationM);
    const upperFirst = !known || A.roadElevationM >= B.roadElevationM;
    const [upper, lower] = upperFirst ? [A, B] : [B, A];
    const separation = known ? upper.roadElevationM - lower.roadElevationM : null;
    const deckThicknessM = settings.structureDepthM !== JUNCTION_SETTINGS.structureDepthM ? s.structureDepthM : upper.deckThicknessM;
    const clearanceM = known ? upper.roadElevationM - deckThicknessM - lower.roadElevationM : null;
    const status = classifyRoadCrossing({ verticalSeparationM: separation, clearanceM, deckThicknessM,
      requiredClearanceM: s.minimumClearanceM, atGradeEligible: A.atGradeEligible && B.atGradeEligible }, s);
    const c = normalizeRoadCrossing({ ...raw, status, kind: status === 'at-grade-matched' ? 'at-grade' : 'grade-separated',
      upperRoadId: upperFirst ? idA : idB, lowerRoadId: upperFirst ? idB : idA,
      upperRoadElevationM: upper.roadElevationM, lowerRoadElevationM: lower.roadElevationM,
      verticalSeparationM: separation, clearanceM, requiredClearanceM: s.minimumClearanceM,
      deckThicknessM, source: 'derived-core' }, i, s);
    const road = roads.find(r => r.id === (c.upperRoadId ?? c.roadIds[0]));
    c.direction = nearestOnRoad(road, c.xM, c.yM)?.direction ?? null;
    return c;
  });
}

/** Culverts where a river passes under a road outside bridge spans and wet crossing runs. */
export function deriveCulverts(scene) {
  const o = scene.overlays ?? {}, roads = (o.roads ?? []).filter(r => r.points?.length > 1);
  const rivers = [...(o.rivers ?? []), ...(o.sourceRivers ?? [])].filter(r => r.points?.length > 1);
  const spans = roadId => [
    ...(o.bridges ?? []).filter(b => b.roadId === roadId).map(b => [b.startDistanceM, b.endDistanceM]),
    ...(scene.crossings ?? []).filter(c => c.roadId === roadId).map(c => [
      Math.min(c.startDistanceM, c.design?.startDistanceM ?? Infinity), Math.max(c.endDistanceM, c.design?.endDistanceM ?? -Infinity)]),
  ];
  const culverts = [];
  for (const road of roads) {
    const st = stationed(road.points), covered = spans(road.id);
    for (const river of rivers) for (let a = 1; a < road.points.length; a++) for (let b = 1; b < river.points.length; b++) {
      const x = segmentIntersection(road.points[a - 1], road.points[a], river.points[b - 1], river.points[b]);
      if (!x) continue;
      const stationM = st[a - 1] + x.t * (st[a] - st[a - 1]);
      if (covered.some(([lo, hi]) => stationM >= lo - 1e-6 && stationM <= hi + 1e-6)) continue;
      if (culverts.some(c => c.roadId === road.id && Math.abs(c.stationM - stationM) <= JUNCTION_SETTINGS.mergeDistanceM)) continue;
      const p0 = road.points[a - 1], p1 = road.points[a], point = { xM: p0.xM + (p1.xM - p0.xM) * x.t, yM: p0.yM + (p1.yM - p0.yM) * x.t };
      let invert = null;
      try { invert = scene.base?.groundElevationAt?.(point.xM, point.yM) ?? null; } catch { invert = null; }
      const roadElevationM = scene.roadProfiles?.has?.(road.id) ? roadElevationAt(scene, road.id, stationM) : null;
      culverts.push({
        id: `culvert:${road.id}:${river.id}:${culverts.length}`, roadId: road.id, stationM, ...point,
        invertElevationM: finite(invert) ? invert : null, roadElevationM,
        coverM: finite(invert) && finite(roadElevationM) ? roadElevationM - invert : null, diameterM: null,
        waterSourceIds: [river.id], flowDirection: unit(river.points[b - 1], river.points[b]), source: 'derived',
      });
    }
  }
  return culverts.sort((p, q) => String(p.roadId).localeCompare(String(q.roadId)) || p.stationM - q.stationM);
}

const cache = new WeakMap();

/** Junctions, overpasses and culverts of a scene (core records first, else derived); cached per scene. */
export function sceneJunctions(scene, settings = JUNCTION_SETTINGS) {
  if (!scene) return { roadCrossings: [], culverts: [] };
  const cached = settings === JUNCTION_SETTINGS ? cache.get(scene) : null;
  if (cached) return cached;
  const core = coreRecords(scene), roads = scene.overlays?.roads ?? [];
  const roadCrossings = core.crossings ? core.crossings.map((r, i) => normalizeRoadCrossing(r, i, settings)) : deriveRoadCrossings(scene, settings);
  for (const c of roadCrossings) {
    const road = roads.find(r => r.id === (c.upperRoadId ?? c.roadIds[0]));
    if (!c.direction && road?.points?.length > 1) c.direction = nearestOnRoad(road, c.xM, c.yM)?.direction ?? null;
  }
  const culverts = core.culverts ? core.culverts.map(normalizeCulvert) : deriveCulverts(scene);
  for (const c of culverts) {
    const road = roads.find(r => r.id === c.roadId);
    if (road?.points?.length > 1 && (!c.flowDirection || !finite(c.stationM))) {
      const near = nearestOnRoad(road, c.xM, c.yM);
      c.flowDirection ??= near && { x: -near.direction.y, y: near.direction.x };
      if (!finite(c.stationM)) c.stationM = near?.stationM ?? null;
    }
  }
  const result = { roadCrossings: roadCrossings.filter(c => finite(c.xM) && finite(c.yM)), culverts: culverts.filter(c => finite(c.xM) && finite(c.yM)) };
  if (settings === JUNCTION_SETTINGS) cache.set(scene, result);
  return result;
}

// ---------- Summaries and formatting ----------

/** Counts per crossing kind and status. `waterBridges` is the count of designed water bridge spans. */
export function summarizeJunctions(scene) {
  const { roadCrossings, culverts } = sceneJunctions(scene);
  const byStatus = Object.fromEntries(JUNCTION_STATUSES.map(s => [s, 0]));
  for (const c of roadCrossings) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  return {
    waterBridges: scene?.overlays?.bridges?.filter(b => b.crossingId != null).length ?? 0,
    overpasses: roadCrossings.filter(c => c.kind === 'grade-separated').length,
    atGrade: byStatus['at-grade-matched'], byStatus, culverts: culverts.length,
    roadCrossings, culvertList: culverts,
  };
}

/** Culvert totals: per-road lists and invert / cover range. */
export function summarizeCulverts(culverts) {
  const byRoad = new Map(), inverts = [], covers = [];
  for (const c of culverts) {
    if (!byRoad.has(c.roadId)) byRoad.set(c.roadId, []);
    byRoad.get(c.roadId).push(c);
    if (finite(c.invertElevationM)) inverts.push(c.invertElevationM);
    if (finite(c.coverM)) covers.push(c.coverM);
  }
  return {
    count: culverts.length, byRoad,
    minInvertElevationM: inverts.length ? Math.min(...inverts) : null, maxInvertElevationM: inverts.length ? Math.max(...inverts) : null,
    minCoverM: covers.length ? Math.min(...covers) : null,
  };
}

/** Map marker style of a road crossing or culvert (shape, colour and pixel size). */
export function junctionMarker(feature, { focused = false } = {}) {
  if (feature.invertElevationM !== undefined && feature.roadIds === undefined) {
    return { shape: 'culvert', color: CULVERT_COLOR, sizePx: focused ? 9 : 6, label: `culvert ${feature.roadId ?? ''}`.trim() };
  }
  const color = JUNCTION_STATUS_COLORS[feature.status] ?? '#999';
  if (feature.kind === 'grade-separated') {
    return { shape: 'overpass', color, sizePx: focused ? 12 : 9, label: `${feature.upperRoadId} over ${feature.lowerRoadId}` };
  }
  return { shape: 'circle', color, sizePx: focused ? 6 : 4, label: feature.roadIds.join(' × ') };
}

/** Short title of a road crossing for lists and the inspector. */
export function formatJunctionLabel(c) {
  return c.kind === 'grade-separated' ? `${c.upperRoadId} over ${c.lowerRoadId}` : `${c.roadIds.join(' × ')} junction`;
}

/** Framing box and centre for focusing the map on a junction or culvert. */
export function junctionLocation(feature, padM = 40) {
  const center = { xM: feature.xM, yM: feature.yM };
  return { center, bounds: boundsOfPoints([center], padM) };
}

/** Junctions, overpasses and culverts within reach of a point, nearest first. */
export function junctionFeaturesNear(scene, xM, yM, radiusM = null) {
  const { roadCrossings, culverts } = sceneJunctions(scene);
  const width = Math.max(3, ...(scene?.overlays?.roads ?? []).map(r => r.halfWidthM ?? 3));
  const reach = radiusM ?? width + JUNCTION_SETTINGS.inspectRadiusM;
  return [...roadCrossings.map(feature => ({ type: feature.kind === 'grade-separated' ? 'overpass' : 'junction', feature })),
    ...culverts.map(feature => ({ type: 'culvert', feature }))]
    .map(e => ({ ...e, distanceM: Math.hypot(e.feature.xM - xM, e.feature.yM - yM) }))
    .filter(e => e.distanceM <= reach)
    .sort((a, b) => a.distanceM - b.distanceM);
}

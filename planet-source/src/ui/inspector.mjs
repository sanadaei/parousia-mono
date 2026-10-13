// Point inspector: every value is read from the canonical core surface frame
// at the exact point (never from the map raster).

import { h, formatNumber, formatMeters, shortId, rgbCss, STRUCTURE_COLORS } from './util.mjs';
import { terrainTrafficabilityAt, formatCost } from './trafficability.mjs';
import { basinStatusOf, basinColor, isTrappedFlow, flowBearingDeg, formatFlowDirection } from './drainage.mjs';
import { junctionFeaturesNear, formatJunctionLabel, JUNCTION_STATUS_LABELS, JUNCTION_STATUS_COLORS, CULVERT_COLOR } from './junctions.mjs';

/**
 * Inspect one point. Uses the base surface frame unless the road earthwork may
 * modify the point (same rule as the scene's corridor sampler), in which case
 * the road-adjusted frame is used.
 */
export function inspectPoint(scene, xM, yM) {
  const t0 = performance.now();
  const adjusted = scene.terrain !== scene.base && scene.sampler.mayAdjust(xM, yM, scene.base.groundElevationAt(xM, yM));
  const source = adjusted ? scene.terrain : scene.base;
  let frame;
  try { frame = source.surfaceFrameAt(xM, yM); } catch (error) {
    frame = { ...source.sampleAt(xM, yM), normal: null, curvature: null, curvatureStatus: `unavailable: ${error.message}` };
  }
  const structure = scene.structureAt(xM, yM, frame);
  const slope = frame.slopeMPerM ?? Math.hypot(frame.gradient.x, frame.gradient.y);
  // Aspect: compass direction the slope faces (downhill), clockwise from north.
  const aspectDeg = slope > 0 ? (Math.atan2(-frame.gradient.x, -frame.gradient.y) * 180 / Math.PI + 360) % 360 : null;
  const geographic = scene.base.toGeographic ? scene.base.toGeographic(xM, yM) : null;
  return {
    xM, yM, geographic,
    groundElevationM: frame.groundElevationM,
    slopeMPerM: slope, slopePercent: slope * 100, slopeDeg: Math.atan(slope) * 180 / Math.PI, aspectDeg,
    gradientStatus: frame.gradientStatus ?? null, triangleIndex: frame.triangleIndex ?? null,
    gradient: frame.gradient, normal: frame.normal ?? null,
    curvature: frame.curvature ?? null, curvatureStatus: frame.curvatureStatus ?? null,
    hydrologyStatus: frame.hydrologyStatus ?? scene.hydrologyStatus,
    surfaceKind: frame.surfaceKind ?? null,
    waterStatus: waterStatus(frame),
    waterLevelElevationM: frame.waterLevelElevationM ?? null,
    waterSurfaceElevationM: frame.waterSurfaceElevationM ?? null,
    waterDepthM: frame.waterDepthM ?? null,
    waterSourceIds: frame.waterSourceIds ?? [],
    basinId: frame.basinId ?? null, basinIndex: frame.basinIndex ?? null,
    basinStatus: basinStatusOf(frame), outletCellIndex: frame.outletCellIndex ?? null,
    trappedFlow: isTrappedFlow(frame), waterChartId: frame.waterChartId ?? null,
    flowDirectionDeg: flowBearingDeg(frame.gradient),
    groundwaterLevelElevationM: frame.groundwaterLevelElevationM ?? null,
    structureKind: structure.structureKind, structure,
    trafficability: terrainTrafficabilityAt(scene.terrain, xM, yM),
    roadAdjustmentId: frame.roadAdjustmentId ?? null,
    junctions: junctionFeaturesNear(scene, xM, yM),
    sampledWith: adjusted ? 'road-adjusted terrain' : 'base terrain',
    worldId: frame.worldId ?? scene.worldId, regionId: frame.regionId ?? null,
    elapsedMs: performance.now() - t0,
  };
}

/** Human-readable water status of a sample. */
export function waterStatus(sample) {
  if (sample.waterDepthM === null || sample.waterDepthM === undefined || sample.surfaceKind === 'unresolved') return 'unresolved (no water model)';
  if (sample.waterDepthM > 0) {
    const src = sample.waterSourceIds?.length ? sample.waterSourceIds.join(', ') : 'water-level grid';
    return `wet · ${src}`;
  }
  return sample.waterLevelRole === 'groundwater' ? 'dry (groundwater below ground)' : 'dry';
}

const passText = m => `${m.class} · ${m.passable ? 'passable' : 'impassable'} · cost ${formatCost(m.costFactor)}`;

/** Pedestrian / vehicle accessibility rows for one trafficability classification. */
function trafficRows(t) {
  if (!t) return [['class', '—']];
  const both = t.pedestrian.passable && t.vehicle.passable;
  return [
    ['class', t.label],
    ['pedestrian', passText(t.pedestrian), 'walkable / difficult / cliff / wading / deep-water'],
    ['vehicle', passText(t.vehicle), 'highway / offroad / steep / flooded'],
    ['cost factor', formatCost(t.costFactor), 'Best of pedestrian and vehicle; 1 = flat open ground'],
    ['passable', !t.passable ? 'no' : both ? 'yes (all modes)' : t.pedestrian.passable ? 'pedestrian only' : 'vehicle only'],
  ];
}

/** Basin / flow rows; values come from the canonical sample at the point. */
export function drainageRows(info) {
  return [
    ['basinId', info.basinId ?? '—'],
    ['basinStatus', info.basinStatus ?? '—', info.trappedFlow ? 'Flow is trapped: no resolved outlet' : undefined],
    ['outletCellIndex', info.outletCellIndex ?? '—'],
    ['waterChartId', info.waterChartId ?? '—', info.waterChartId ? undefined : 'Outside explicit water charts (or a planar scene)'],
    ['flow direction', formatFlowDirection(info.flowDirectionDeg ?? null), 'Downhill bearing, clockwise from north'],
    ...(info.trappedFlow ? [['flow', 'trapped (depression)']] : []),
  ];
}

/** One row per nearby junction, overpass or culvert (nearest first). */
export function junctionRows(info) {
  return (info.junctions ?? []).flatMap(({ type, feature: f, distanceM }) => {
    const away = `${formatMeters(distanceM, 1)} away`;
    if (type === 'culvert') {
      return [['culvert', `${f.roadId ?? '—'} @ ${f.stationM === null ? '—' : formatMeters(f.stationM, 1)} · ${away}`, f.id],
        ['invert', formatMeters(f.invertElevationM, 2), 'Pipe invert (bed) elevation'],
        ...(f.coverM !== null ? [['cover', formatMeters(f.coverM, 2), 'Road surface above the invert']] : []),
        ...(f.waterSourceIds.length ? [['drains', f.waterSourceIds.join(', ')]] : [])];
    }
    const rows = [[type, `${formatJunctionLabel(f)} · ${away}`, f.id], ['status', JUNCTION_STATUS_LABELS[f.status] ?? f.status]];
    if (type === 'overpass') {
      rows.push(['clearance', `${formatMeters(f.clearanceM, 2)} (min ${formatMeters(f.requiredClearanceM, 2)})`],
        ['upper / lower', `${formatMeters(f.upperElevationM, 2)} / ${formatMeters(f.lowerElevationM, 2)}`]);
    } else if (f.verticalSeparationM !== null) rows.push(['separation', formatMeters(f.verticalSeparationM, 2)]);
    return rows;
  });
}

const vec = v => v ? `(${formatNumber(v.x, 4)}, ${formatNumber(v.y, 4)}${v.z !== undefined ? `, ${formatNumber(v.z, 4)}` : ''})` : '—';

/** Rows (label, value, optional title) grouped into sections for display or export. */
export function inspectionRows(info) {
  const s = info.structure;
  const sections = [
    ['Position', [
      ['xM', formatNumber(info.xM, 2)], ['yM', formatNumber(info.yM, 2)],
      ...(info.geographic ? [['lat / lon', `${formatNumber(info.geographic.latDeg, 6)}°, ${formatNumber(info.geographic.lonDeg, 6)}°`]] : []),
    ]],
    ['Surface', [
      ['ground', formatMeters(info.groundElevationM, 3)],
      ['slope', `${formatNumber(info.slopeMPerM, 4)} m/m · ${formatNumber(info.slopePercent, 2)} % · ${formatNumber(info.slopeDeg, 2)}°`],
      ['aspect', info.aspectDeg === null ? 'flat' : `${formatNumber(info.aspectDeg, 1)}°`],
      ['gradient', vec(info.gradient)],
      ['gradient status', info.gradientStatus ?? '—'],
      ['normal', vec(info.normal)],
      ['mean curv.', info.curvature ? `${formatNumber(info.curvature.meanPerM, 5)} 1/m` : '—', info.curvatureStatus],
      ['gauss curv.', info.curvature ? `${formatNumber(info.curvature.gaussianPerM2, 6)} 1/m²` : '—', info.curvatureStatus],
      ['curv. status', info.curvatureStatus ?? '—'],
    ]],
    ['Water', [
      ['status', info.waterStatus],
      ['hydrology', info.hydrologyStatus],
      ['water level', formatMeters(info.waterLevelElevationM, 3)],
      ['water depth', formatMeters(info.waterDepthM, 3)],
      ...(info.groundwaterLevelElevationM !== null ? [['groundwater', formatMeters(info.groundwaterLevelElevationM, 3)]] : []),
    ]],
    ['Drainage', drainageRows(info)],
    ['Trafficability', trafficRows(info.trafficability)],
    ['Structure', [
      ['structureKind', info.structureKind],
      ['feature', s.featureId ?? '—'],
      ...(s.stationM !== undefined ? [['station', formatMeters(s.stationM, 1)], ['offset', formatMeters(s.offsetM, 2)],
        ['road elev. ≈', formatMeters(s.roadElevationApproxM, 2), 'Linear between centerline stations']] : []),
      ...(s.earthworkDeltaM !== undefined ? [['earthwork', `${s.batterKind} ${formatMeters(s.earthworkDeltaM, 3)}`]] : []),
      ...(s.padElevationM !== undefined ? [['pad elev.', formatMeters(s.padElevationM, 2)]] : []),
      ['sampled with', info.sampledWith],
    ]],
    ...(info.junctions?.length ? [['Junctions & culverts', junctionRows(info)]] : []),
  ];
  return sections;
}

/** Inspector panel. `update(info)` re-renders; `pinned` marks a clicked (frozen) point. */
export class Inspector {
  constructor(container) {
    this.container = container;
    this.info = null;
    this.pinned = false;
    this.render();
  }
  update(info, { pinned = false } = {}) { this.info = info; this.pinned = pinned; this.render(); }
  clear() { this.info = null; this.render(); }

  render() {
    const c = this.container;
    c.replaceChildren();
    if (!this.info) {
      c.append(h('p', { class: 'empty' }, 'Hover the map to inspect a point. Click to pin it.'));
      return;
    }
    const info = this.info;
    c.append(h('div', { class: 'inspector-head' },
      h('span', { class: `badge ${this.pinned ? 'badge-pin' : ''}` }, this.pinned ? 'Pinned' : 'Live'),
      h('span', { class: 'chip', style: { '--chip': STRUCTURE_COLORS[info.structureKind] ?? '#7d8a99' } }, info.structureKind),
      info.trafficability && h('span', { class: 'chip', title: info.trafficability.label, style: { color: info.trafficability.color, borderColor: info.trafficability.color } },
        info.trafficability.passable ? info.trafficability.class : `${info.trafficability.class} · impassable`),
      info.basinId && h('span', { class: 'chip', title: `basin ${info.basinId}`,
        style: { color: rgbCss(basinColor(String(info.basinId))), borderColor: rgbCss(basinColor(String(info.basinId))) } },
        info.trappedFlow ? 'basin · trapped' : 'basin'),
      info.junctions?.length > 0 && (({ type, feature }) => {
        const color = type === 'culvert' ? CULVERT_COLOR : JUNCTION_STATUS_COLORS[feature.status] ?? '#999';
        return h('span', { class: 'chip', title: feature.id, style: { color, borderColor: color } }, type);
      })(info.junctions[0]),
      h('button', { class: 'ghost small', title: 'Copy inspection as JSON',
        onclick: () => navigator.clipboard?.writeText(JSON.stringify(info, null, 2)) }, 'Copy JSON')));
    for (const [title, rows] of inspectionRows(info)) {
      c.append(h('h4', {}, title), h('dl', { class: 'kv' }, rows.flatMap(([k, v, tip]) => [h('dt', {}, k), h('dd', { title: tip ?? String(v) }, v)])));
    }
    c.append(h('p', { class: 'muted small' }, `world ${shortId(info.worldId)}${info.regionId ? ` · region ${shortId(info.regionId)}` : ''} · ${formatNumber(info.elapsedMs, 2)} ms`));
  }
}

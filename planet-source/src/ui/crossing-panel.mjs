// Road crossing diagnostics: each wet run found by inspectRoadCrossings, its
// bridge design (or the reason it failed), and the designed bridge spans with
// their sampled minimum clearance; road-over-road crossings (grade-separated
// overpasses with their clearance status, at-grade junctions) and culverts.
// Clicking an entry focuses map and profile.

import { h, formatMeters, formatDistance, CROSSING_STATUS_COLORS } from './util.mjs';
import { summarizeJunctions, summarizeCulverts, formatJunctionLabel, JUNCTION_STATUS_LABELS, JUNCTION_STATUS_COLORS,
  CULVERT_COLOR } from './junctions.mjs';

export const STATUS_LABELS = Object.freeze({
  'bridge-designed': 'Bridge designed', 'sampled-clearance-met': 'Clearance met',
  'bridge-height-required': 'Deck height required', 'insufficient-sampled-clearance': 'Insufficient clearance',
  'design-failed': 'Design failed',
});

/** Summary counts and per-road grouping (DOM-free). */
export function summarizeCrossings(scene) {
  const byStatus = {}, byRoad = new Map();
  for (const c of scene.crossings) {
    byStatus[c.uiStatus] = (byStatus[c.uiStatus] ?? 0) + 1;
    if (!byRoad.has(c.roadId)) byRoad.set(c.roadId, []);
    byRoad.get(c.roadId).push(c);
  }
  const bridges = scene.overlays.bridges.filter(b => b.crossingId != null).map(b => ({ ...b, lengthM: b.endDistanceM - b.startDistanceM,
    clearanceOk: b.minClearanceM === null ? null : b.minClearanceM >= (b.design?.minimumClearanceM ?? b.design?.clearanceM ?? 0) - 1e-9 }));
  const junctions = summarizeJunctions(scene);
  return { total: scene.crossings.length, byStatus, byRoad, bridges, roadErrors: scene.roadErrors, inspection: scene.roadInspection,
    junctions, culverts: summarizeCulverts(junctions.culvertList) };
}

export class CrossingPanel {
  /** `onFocusCrossing(crossing)`, `onFocusBridge(bridge)`, `onFocusJunction(junctionOrCulvert)`, `onSelectRoad(roadId)`. */
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;
    this.scene = null;
    this.filter = 'all';
    this.activeId = null;
    this.render();
  }
  setScene(scene) { this.scene = scene; this.activeId = null; this.render(); }
  setActive(id) {
    this.activeId = id;
    for (const el of this.container.querySelectorAll('[data-id]')) el.classList.toggle('active', el.dataset.id === id);
  }

  render() {
    const c = this.container, scene = this.scene;
    c.replaceChildren();
    if (!scene) { c.append(h('p', { class: 'empty' }, 'No scene loaded.')); return; }
    if (!scene.overlays.roads.length) { c.append(h('p', { class: 'empty' }, 'This scene has no roads. Load a scene bundle with roads to diagnose crossings.')); return; }
    const sum = summarizeCrossings(scene);
    const statuses = Object.keys(sum.byStatus);
    const j = sum.junctions, stat = (value, label, cls = '') => h('div', { class: `stat ${cls}` }, h('b', {}, String(value)), h('span', {}, label));
    c.append(h('div', { class: 'summary-row' },
      stat(scene.overlays.roads.length, 'roads'), stat(sum.total, 'water crossings'),
      stat(sum.bridges.length, 'water bridges'), stat(sum.roadErrors.length, 'road errors', sum.roadErrors.length ? 'bad' : ''),
      stat(j.overpasses, 'overpasses', (j.byStatus['insufficient-vertical-clearance'] + j.byStatus.collision) ? 'bad' : ''), stat(j.atGrade, 'at-grade junctions'),
      stat(j.culverts, 'culverts')));
    if (statuses.length > 1) {
      c.append(h('div', { class: 'filters' }, ['all', ...statuses].map(s => h('button', {
        class: `pill ${this.filter === s ? 'on' : ''}`, onclick: () => { this.filter = s; this.render(); },
      }, s === 'all' ? 'All' : `${STATUS_LABELS[s] ?? s} (${sum.byStatus[s]})`))));
    }
    for (const err of sum.roadErrors) {
      c.append(h('div', { class: 'callout bad' }, h('b', {}, err.roadId ?? 'Roads'), ': ', err.message));
    }

    c.append(h('h4', {}, 'Crossings'));
    if (!sum.total) c.append(h('p', { class: 'muted' }, scene.hydrologyStatus === 'unresolved'
      ? 'Water is unresolved in this scene, so no wet runs can be diagnosed.' : 'No road crosses water.'));
    for (const [roadId, list] of sum.byRoad) {
      const shown = list.filter(x => this.filter === 'all' || x.uiStatus === this.filter);
      if (!shown.length) continue;
      c.append(h('div', { class: 'group-title' }, h('a', { href: '#', onclick: e => { e.preventDefault(); this.callbacks.onSelectRoad?.(roadId); } }, roadId), ` · ${list.length}`));
      for (const x of shown) c.append(this.crossingItem(x));
    }

    if (sum.bridges.length) {
      c.append(h('h4', {}, 'Bridge clearances'));
      const table = h('table', { class: 'grid' },
        h('thead', {}, h('tr', {}, ['Road', 'Span', 'Deck', 'Min clearance', ''].map(t => h('th', {}, t)))),
        h('tbody', {}, sum.bridges.map(b => h('tr', {
          'data-id': `bridge:${b.roadId}:${b.startDistanceM}`, class: 'clickable',
          onclick: () => { this.setActive(`bridge:${b.roadId}:${b.startDistanceM}`); this.callbacks.onFocusBridge?.(b); },
        },
        h('td', {}, b.roadId),
        h('td', {}, `${formatDistance(b.startDistanceM)}–${formatDistance(b.endDistanceM)}`),
        h('td', {}, formatMeters(b.deckElevationM, 2)),
        h('td', {}, formatMeters(b.minClearanceM, 2)),
        h('td', {}, b.clearanceOk === null ? '—' : h('span', { class: `dot ${b.clearanceOk ? 'ok' : 'bad'}`, title: b.clearanceOk ? 'meets design clearance' : 'below design clearance' }))))));
      c.append(table);
    }
    this.renderJunctions(c, sum);
    if (sum.inspection) {
      c.append(h('p', { class: 'muted small' }, `${sum.inspection.sampledPoints} centerline probes · ${sum.inspection.precision}`
        + (sum.inspection.unresolvedWaterSamples ? ` · ${sum.inspection.unresolvedWaterSamples} unresolved water samples` : '')));
    }
    if (this.activeId) this.setActive(this.activeId);
  }

  focusJunction(feature) { this.setActive(feature.id); this.callbacks.onFocusJunction?.(feature); }

  /** Road-over-road crossings (overpasses first) and the culvert list. */
  renderJunctions(c, sum) {
    const list = [...sum.junctions.roadCrossings].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'grade-separated' ? -1 : 1));
    c.append(h('h4', {}, 'Road crossings & junctions'));
    if (!list.length) c.append(h('p', { class: 'muted' }, 'No road crosses or joins another road.'));
    for (const x of list) c.append(this.junctionItem(x));
    c.append(h('h4', {}, 'Culverts'));
    if (!sum.culverts.count) { c.append(h('p', { class: 'muted' }, 'No drainage pass-throughs under road embankments.')); return; }
    const table = h('table', { class: 'grid' },
      h('thead', {}, h('tr', {}, ['Road', 'Station', 'Invert', 'Cover', ''].map(t => h('th', {}, t)))),
      h('tbody', {}, sum.junctions.culvertList.map(k => h('tr', { 'data-id': k.id, class: 'clickable', title: k.waterSourceIds.join(', '),
        onclick: () => this.focusJunction(k) },
      h('td', {}, k.roadId ?? '—'), h('td', {}, k.stationM === null ? '—' : formatDistance(k.stationM)),
      h('td', {}, formatMeters(k.invertElevationM, 2)), h('td', {}, formatMeters(k.coverM, 2)),
      h('td', {}, h('span', { class: 'dot', style: { background: CULVERT_COLOR } }))))));
    c.append(table);
    if (sum.culverts.minInvertElevationM !== null) {
      c.append(h('p', { class: 'muted small' }, `inverts ${formatMeters(sum.culverts.minInvertElevationM, 2)} – ${formatMeters(sum.culverts.maxInvertElevationM, 2)}`
        + (sum.culverts.minCoverM !== null ? ` · min cover ${formatMeters(sum.culverts.minCoverM, 2)}` : '')));
    }
  }

  junctionItem(x) {
    const color = JUNCTION_STATUS_COLORS[x.status] ?? '#999', graded = x.kind === 'grade-separated';
    const stations = Object.entries(x.stationsM).map(([road, m]) => `${road} @ ${formatDistance(m)}`).join(' · ');
    return h('div', { class: 'crossing', 'data-id': x.id, tabindex: 0,
      onclick: () => this.focusJunction(x), onkeydown: e => { if (e.key === 'Enter') this.focusJunction(x); } },
    h('div', { class: 'crossing-head' },
      h('span', { class: 'dot', style: { background: color } }),
      h('b', {}, formatJunctionLabel(x)),
      h('span', { class: 'status', style: { color } }, JUNCTION_STATUS_LABELS[x.status] ?? x.status)),
    h('dl', { class: 'kv compact' },
      h('dt', {}, 'type'), h('dd', {}, graded ? 'grade-separated overpass' : 'at-grade junction'),
      ...(stations ? [h('dt', {}, 'stations'), h('dd', { title: stations }, stations)] : []),
      ...(graded ? [h('dt', {}, 'upper road'), h('dd', {}, `${x.upperRoadId} · ${formatMeters(x.upperElevationM, 2)}`),
        h('dt', {}, 'lower road'), h('dd', {}, `${x.lowerRoadId} · ${formatMeters(x.lowerElevationM, 2)}`),
        h('dt', {}, 'clearance'), h('dd', { class: ['insufficient-vertical-clearance', 'collision'].includes(x.status) ? 'bad' : '' },
          `${formatMeters(x.clearanceM, 2)} (min ${formatMeters(x.requiredClearanceM, 2)})`)]
        : [h('dt', {}, 'separation'), h('dd', {}, formatMeters(x.verticalSeparationM, 2))])));
  }

  crossingItem(x) {
    const color = CROSSING_STATUS_COLORS[x.uiStatus] ?? '#999', d = x.design;
    return h('div', { class: 'crossing', 'data-id': x.crossingId, tabindex: 0,
      onclick: () => { this.setActive(x.crossingId); this.callbacks.onFocusCrossing?.(x); },
      onkeydown: e => { if (e.key === 'Enter') { this.setActive(x.crossingId); this.callbacks.onFocusCrossing?.(x); } } },
    h('div', { class: 'crossing-head' },
      h('span', { class: 'dot', style: { background: color } }),
      h('b', {}, x.crossingId.split('/').pop()),
      h('span', { class: 'status', style: { color } }, STATUS_LABELS[x.uiStatus] ?? x.uiStatus)),
    h('dl', { class: 'kv compact' },
      h('dt', {}, 'wet run'), h('dd', {}, `${formatDistance(x.startDistanceM)} – ${formatDistance(x.endDistanceM)} (${formatMeters(x.endDistanceM - x.startDistanceM, 1)})`),
      h('dt', {}, 'water level'), h('dd', {}, formatMeters(x.maxWaterLevelElevationM, 2)),
      h('dt', {}, 'required deck'), h('dd', {}, formatMeters(x.requiredDeckElevationM, 2)),
      h('dt', {}, 'sources'), h('dd', { title: x.waterSourceIds.join(', ') }, x.waterSourceIds.join(', ') || '—'),
      ...(d ? [h('dt', {}, 'designed deck'), h('dd', {}, formatMeters(d.deckElevationM, 2)),
        h('dt', {}, 'bridge span'), h('dd', {}, `${formatDistance(d.startDistanceM)} – ${formatDistance(d.endDistanceM)}`),
        h('dt', {}, 'clearance'), h('dd', {}, `${formatMeters(d.clearanceM, 2)} (min ${formatMeters(d.minimumClearanceM, 2)})`)] : []),
      ...(x.designError ? [h('dt', {}, 'error'), h('dd', { class: 'bad' }, x.designError)] : [])));
  }
}

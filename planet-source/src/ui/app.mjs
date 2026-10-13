// Visualizer shell: wires the map, profile chart, inspector, crossing panel and
// LOD comparator to one loaded scene. Importing this module has no side
// effects; index.html calls createApp(root).

import { loadScene, crossingLocation, sceneBundleForExport } from './scene.mjs';
import { PRESETS, fetchPreset } from './presets.mjs';
import { MapViewer, DEFAULT_LAYERS } from './map-viewer.mjs';
import { ProfileChart, annotateLineProfile } from './profile-chart.mjs';
import { Inspector, inspectPoint } from './inspector.mjs';
import { CrossingPanel } from './crossing-panel.mjs';
import { junctionLocation } from './junctions.mjs';
import { LodComparator } from './lod-comparator.mjs';
import { designTestPad, designTestRoad, SANDBOX_DEFAULTS } from './sandbox.mjs';
import { TRAFFIC_CLASSES, TRAFFIC_COLORS, TRAFFIC_LABELS, TRAFFIC_THRESHOLDS } from './trafficability.mjs';
import { basinPalette, formatFlowDirection } from './drainage.mjs';
import { h, elevationColor, formatNumber, formatMeters, formatDistance, shortId, boundsOfPoints, distanceToSegment,
  pointInPolygon, rgbCss } from './util.mjs';

const LAYER_LABELS = {
  elevation: 'Elevation colormap', hillshade: 'Shaded relief', water: 'Water depth', contours: 'Contours',
  trafficability: 'Trafficability',
  rivers: 'River channels', waterBodies: 'Water bodies', roads: 'Roads', roadStructure: 'Road structure colours',
  bridges: 'Bridges', pads: 'Building pads', crossings: 'Crossing markers', junctions: 'Junctions & culverts', labels: 'Labels', bounds: 'Scene bounds',
  drainage: 'Drainage & Basins',
};

/** Keyboard shortcuts of the quick layer toggles. */
const LAYER_KEYS = { Trafficability: 'T', Drainage: 'D' };

/** Toolbar quick toggles; "Structures" groups the road structure colours, bridges and pads. */
export const QUICK_LAYERS = Object.freeze([
  ['Elevation', ['elevation']], ['Relief', ['hillshade']], ['Water', ['water']], ['Contours', ['contours']],
  ['Structures', ['roadStructure', 'bridges', 'pads']], ['Trafficability', ['trafficability']], ['Drainage', ['drainage']],
]);

/** Profile samples → CSV text. */
export function profileToCsv(profile) {
  const cols = ['distanceM', 'xM', 'yM', 'groundElevationM', 'baseGroundElevationM', 'waterSurfaceElevationM', 'waterDepthM',
    'roadElevationM', 'structureKind', 'clearanceM'];
  const cell = v => v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : `"${String(v).replace(/"/g, '""')}"`;
  return [cols.join(','), ...profile.samples.map(p => cols.map(c => cell(p[c])).join(','))].join('\n');
}

export function createApp(root) {
  const $ = id => root.querySelector(`#${id}`);
  const state = { scene: null, input: null, label: null, viewIndex: 0, profile: null, pinned: null, hoverPending: null, loading: false,
    sandbox: { mode: 'pad', items: [], pending: null, selectedId: null, settings: { ...SANDBOX_DEFAULTS } } };
  const layerInputs = {};

  // ---------- Components ----------

  const map = new MapViewer($('map-canvas'), {
    onHover: point => scheduleHover(point),
    onClick: ({ point, hit }) => onMapClick(point, hit),
    onProfileLine: (a, b) => showLineProfile(a, b),
    onProgress: ({ pending, level }) => {
      const step = `sample step ${formatMeters(2 ** level, level < 0 ? 2 : 0)}`;
      $('hud-tiles').textContent = pending ? `rendering ${pending} tile${pending === 1 ? '' : 's'} · ${step}` : step;
    },
  });
  const chart = new ProfileChart($('profile-canvas'), {
    onHover: sample => map.setOverlay({ cursor: sample ? { xM: sample.xM, yM: sample.yM } : null }),
  });
  const inspector = new Inspector($('inspector-panel'));
  const crossings = new CrossingPanel($('crossing-panel'), {
    onFocusCrossing: c => focusCrossing(c),
    onFocusBridge: b => focusBridge(b),
    onFocusJunction: f => focusJunction(f),
    onSelectRoad: id => showRoadProfile(id, { focus: true }),
  });
  const lod = new LodComparator($('lod-panel'), {
    getArea: () => ({ area: map.viewport.worldBounds, center: state.pinned ?? null }),
    onWindow: w => map.setOverlay({ lodWindow: w }),
    onFocusPoint: p => { map.centerOn(p); pin(p); },
  });

  // ---------- Loading ----------

  function status(text) { $('status').textContent = text ?? ''; }
  function toast(message, kind = 'bad') {
    const t = $('toast');
    t.textContent = message; t.className = `toast ${kind}`; t.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { t.hidden = true; }, kind === 'bad' ? 9000 : 3500);
  }

  async function load(input, { label = null, viewIndex = 0 } = {}) {
    if (state.loading) return;
    state.loading = true;
    $('loading').hidden = false;
    const progress = m => { if (m) $('loading-text').textContent = m; };
    try {
      const scene = await loadScene(input, { label, viewIndex, onProgress: progress });
      Object.assign(state, { scene, input, label, viewIndex: scene.viewIndex, profile: null, pinned: null });
      Object.assign(state.sandbox, { items: [], pending: null, selectedId: null });
      map.setScene(scene); crossings.setScene(scene); lod.setScene(scene);
      syncSandbox();
      inspector.clear(); setProfile(null);
      renderSceneInfo(); renderViews(); renderRoadSelect(); renderLegend();
      $('crossing-count').textContent = scene.crossings.length ? String(scene.crossings.length) : '';
      status(`${scene.label} · ${scene.hydrologyStatus} water · loaded in ${formatNumber(scene.timings.totalMs / 1000, 2)} s`);
      for (const w of scene.warnings) toast(w, 'info');
      // Start with the most informative road profile.
      const first = scene.crossings.find(c => c.design) ?? scene.crossings[0];
      if (first) showRoadProfile(first.roadId);
      else if (scene.overlays.roads.length) showRoadProfile(scene.overlays.roads[0].id);
    } catch (error) {
      console.error(error);
      toast(`Could not load scene: ${error.message}`);
      status(state.scene ? `${state.scene.label} (previous scene kept)` : 'No scene loaded');
    } finally {
      state.loading = false;
      $('loading').hidden = true;
    }
  }

  async function loadPreset(id) {
    try {
      $('loading').hidden = false; $('loading-text').textContent = 'Fetching preset…';
      $('preset-select').value = id;
      const { preset, input } = await fetchPreset(id);
      $('loading').hidden = true;
      await load(input, { label: preset.label, viewIndex: preset.viewIndex ?? 0 });
      if (preset.layers) setLayers(preset.layers);
      const url = new URL(location.href); url.searchParams.set('preset', id); history.replaceState(null, '', url);
    } catch (error) {
      $('loading').hidden = true;
      toast(`Preset failed: ${error.message}`);
    }
  }

  async function loadFile(file) {
    if (!file) return;
    if (file.size > 256 * 1024 * 1024) { toast('File is larger than 256 MB'); return; }
    const text = await file.text();
    $('preset-select').value = '';
    await load(text, { label: file.name });
  }

  // ---------- Hover / inspect ----------

  function scheduleHover(point) {
    state.hoverPending = point;
    if (scheduleHover.queued) return;
    scheduleHover.queued = true;
    requestAnimationFrame(() => {
      scheduleHover.queued = false;
      const p = state.hoverPending, scene = state.scene;
      if (!scene) return;
      if (!p) { $('hud-coords').textContent = '—'; chart.setExternalDistance(null); return; }
      try {
        const info = inspectPoint(scene, p.xM, p.yM);
        $('hud-coords').textContent = `x ${formatNumber(p.xM, 1)} · y ${formatNumber(p.yM, 1)} · z ${formatMeters(info.groundElevationM, 2)}`
          + (info.waterDepthM > 0 ? ` · depth ${formatMeters(info.waterDepthM, 2)}` : '') + ` · ${info.structureKind}`
          + (map.layers.trafficability ? ` · ${info.trafficability.class}${info.trafficability.passable ? '' : ' (impassable)'}` : '')
          + (map.layers.drainage ? ` · flow ${formatFlowDirection(info.flowDirectionDeg)}${info.basinId ? ` · ${shortId(String(info.basinId), 12)}` : ''}`
            + `${info.trappedFlow ? ' (trapped)' : ''}${info.waterChartId ? ` · chart ${info.waterChartId}` : ''}` : '');
        if (!state.pinned) inspector.update(info);
      } catch (error) { $('hud-coords').textContent = `x ${formatNumber(p.xM, 1)} · y ${formatNumber(p.yM, 1)} · ${error.message}`; }
      syncChartToMap(p);
    });
  }

  /** Crosshair on the chart when hovering within 12 px of the profile path. */
  function syncChartToMap(p) {
    const prof = state.profile;
    if (!prof) return;
    const v = map.viewport, s = v.toScreen(p.xM, p.yM);
    let best = null, offset = 0;
    for (let i = 1; i < prof.path.length; i++) {
      const a = v.toScreen(prof.path[i - 1].xM, prof.path[i - 1].yM), b = v.toScreen(prof.path[i].xM, prof.path[i].yM);
      const d = distanceToSegment(s.x, s.y, a.x, a.y, b.x, b.y), len = Math.hypot(prof.path[i].xM - prof.path[i - 1].xM, prof.path[i].yM - prof.path[i - 1].yM);
      if (d.distance <= 12 && (!best || d.distance < best.distance)) best = { distance: d.distance, along: offset + d.t * len };
      offset += len;
    }
    chart.setExternalDistance(best ? best.along : null);
  }

  function pin(point) {
    state.pinned = point;
    map.setOverlay({ pinned: point });
    if (point && state.scene) {
      try { inspector.update(inspectPoint(state.scene, point.xM, point.yM), { pinned: true }); } catch (error) { toast(error.message); }
    }
  }

  function onMapClick(point, hit) {
    if (!state.scene) return;
    if (map.tool === 'sandbox') return sandboxClick(point);
    if (hit?.kind === 'crossing') return focusCrossing(hit.crossing);
    if (hit?.kind === 'junction') return focusJunction(hit.junction);
    if (hit?.kind === 'road') { showRoadProfile(hit.road.id); }
    pin(point);
    selectTab('inspect');
  }

  // ---------- Profiles ----------

  function setProfile(profile, options = {}) {
    state.profile = profile;
    chart.setProfile(profile, options);
    map.setOverlay({ profile: profile ? { kind: profile.kind, path: profile.path } : null, selectedRoadId: profile?.roadId ?? null });
    $('profile-title').textContent = profile ? `${profile.label} · ${formatDistance(profile.lengthM)} · ${profile.samples.length} samples` : 'Profile';
    $('profile-csv').disabled = $('profile-clear').disabled = !profile;
    $('road-select').value = profile?.roadId ?? '';
  }

  function showLineProfile(a, b) {
    try {
      const profile = annotateLineProfile(state.scene, state.scene.lineProfile(a, b));
      setProfile(profile);
    } catch (error) { toast(`Profile failed: ${error.message}`); map.setOverlay({ profile: null }); }
  }

  function showRoadProfile(roadId, { range = null, focus = false } = {}) {
    try {
      const profile = state.scene.roadPathProfile(roadId);
      setProfile(profile, { crossings: state.scene.crossings.filter(c => c.roadId === roadId), range });
      if (focus) map.focusBounds(boundsOfPoints(profile.path, 40));
    } catch (error) { toast(`Road profile failed: ${error.message}`); }
  }

  function focusCrossing(c) {
    const loc = crossingLocation(state.scene, c);
    if (!loc) return;
    map.focusBounds(loc.bounds, { minMetersPerPixel: 0.08 });
    map.setOverlay({ focusCrossingId: c.crossingId, focusJunctionId: null, highlight: loc.center });
    showRoadProfile(c.roadId, { range: { fromM: loc.fromDistanceM, toM: loc.toDistanceM } });
    crossings.setActive(c.crossingId);
    selectTab('crossings');
  }

  /** Frame a junction, overpass or culvert, pin it for the inspector and profile its (upper) road. */
  function focusJunction(f) {
    const loc = junctionLocation(f);
    map.focusBounds(loc.bounds, { minMetersPerPixel: 0.08 });
    map.setOverlay({ focusJunctionId: f.id, focusCrossingId: null, highlight: loc.center });
    const roadId = f.roadId ?? f.upperRoadId ?? f.roadIds?.[0], stationM = f.stationM ?? f.stationsM?.[roadId];
    if (roadId != null) showRoadProfile(roadId, Number.isFinite(stationM) ? { range: { fromM: stationM - 80, toM: stationM + 80 } } : {});
    pin(loc.center);
    crossings.setActive(f.id);
    selectTab('crossings');
  }

  function focusBridge(b) {
    const road = state.scene.overlays.roads.find(r => r.id === b.roadId);
    if (!road) return;
    map.focusBounds(boundsOfPoints(b.points, 50), { minMetersPerPixel: 0.08 });
    map.setOverlay({ focusCrossingId: b.crossingId, highlight: b.points[Math.floor(b.points.length / 2)] });
    const span = b.endDistanceM - b.startDistanceM, pad = Math.max(40, span * 2);
    showRoadProfile(b.roadId, { range: { fromM: b.startDistanceM - pad, toM: b.endDistanceM + pad } });
  }

  // ---------- Sandbox (interactive placement) ----------

  function syncSandbox() {
    const sb = state.sandbox, set = sb.settings;
    map.setOverlay({ sandbox: { items: sb.items, mode: sb.mode, pending: sb.pending, selectedId: sb.selectedId,
      ghost: { widthM: set.padWidthM, depthM: set.padDepthM, rotationDeg: set.padRotationDeg } } });
    $('sandbox-count').textContent = sb.items.length ? String(sb.items.length) : '';
    $('sandbox-pad').classList.toggle('on', sb.mode === 'pad');
    $('sandbox-road').classList.toggle('on', sb.mode === 'road');
    renderSandbox();
  }

  function setSandboxMode(mode) {
    Object.assign(state.sandbox, { mode, pending: null });
    syncSandbox();
  }

  function sandboxClick(point) {
    const sb = state.sandbox, set = sb.settings;
    if (sb.mode === 'pad') {
      // Clicking an existing test pad selects it instead of stacking another one.
      const existing = sb.items.find(i => i.kind === 'pad' && pointInPolygon(point.xM, point.yM, i.polygon));
      if (existing) return selectSandboxItem(existing.id);
      runSandbox(() => designTestPad(state.scene, { xM: point.xM, yM: point.yM,
        widthM: set.padWidthM, depthM: set.padDepthM, rotationDeg: set.padRotationDeg }));
    } else if (!sb.pending) {
      sb.pending = point;
      syncSandbox();
    } else {
      const a = sb.pending;
      sb.pending = null;
      runSandbox(() => designTestRoad(state.scene, a, point,
        { widthM: set.roadWidthM, smoothingM: set.roadSmoothingM, maxRoadGrade: set.maxRoadGrade }));
    }
  }

  function runSandbox(design) {
    try {
      const t0 = performance.now(), item = design();
      item.elapsedMs = performance.now() - t0;
      state.sandbox.items.push(item);
      selectSandboxItem(item.id);
      selectTab('sandbox');
    } catch (error) {
      syncSandbox();
      toast(`Sandbox design failed: ${error.message}`);
    }
  }

  function selectSandboxItem(id) {
    const item = state.sandbox.items.find(i => i.id === id);
    state.sandbox.selectedId = item?.id ?? null;
    if (item) setProfile(item.profile);
    syncSandbox();
  }

  function removeSandboxItem(id) {
    const sb = state.sandbox;
    sb.items = sb.items.filter(i => i.id !== id);
    if (sb.selectedId === id) { sb.selectedId = null; if (state.profile?.id === `sandbox:${id}`) setProfile(null); }
    syncSandbox();
  }

  function clearSandbox() {
    if (state.profile?.kind === 'sandbox') setProfile(null);
    Object.assign(state.sandbox, { items: [], pending: null, selectedId: null });
    syncSandbox();
  }

  const volume = v => `${formatNumber(v, v >= 100 ? 0 : 1)} m³`;
  const percent = v => `${formatNumber(v * 100, 1)} %`;

  function sandboxSummaryRows(item) {
    const s = item.summary;
    if (item.kind === 'pad') return [
      ['footprint', `${formatNumber(item.widthM, 1)} × ${formatNumber(item.depthM, 1)} m · ${formatNumber(item.rotationDeg, 0)}°`],
      ['pad elev.', formatMeters(s.padElevationM, 2), s.elevationMode],
      ...(s.minimumPadElevationM !== null ? [['min. (water)', formatMeters(s.minimumPadElevationM, 2), `water clearance ${s.waterClearanceStatus}`]] : []),
      ['cut', volume(s.cutVolumeM3)], ['fill', volume(s.fillVolumeM3)],
      ['net', `${s.netVolumeM3 >= 0 ? 'import' : 'export'} ${volume(Math.abs(s.netVolumeM3))}`],
      ['max height', formatMeters(s.maxPerimeterHeightM, 2), 'Largest perimeter cut/fill height'],
      ['batter', `≤ ${formatMeters(s.maxBatterWidthM, 1)}`, 'Widest perimeter batter transition'],
      ...(s.overlaps.length ? [['overlaps', s.overlaps.join(', ')]] : []),
      ...(s.wetProbes ? [['water', `${s.wetProbes} wet probe${s.wetProbes === 1 ? '' : 's'} in footprint`]] : []),
    ];
    return [
      ['length', formatDistance(s.lengthM)], ['width', formatMeters(s.widthM, 1)],
      ['ends', `${formatMeters(s.startElevationM, 1)} → ${formatMeters(s.endElevationM, 1)} · avg ${percent(s.averageGrade)}`],
      ['max grade', `${percent(s.maxGrade)}${s.steepLengthM > 0 ? ` · ${formatDistance(s.steepLengthM)} over ${percent(s.maxRoadGrade)}` : ''}`],
      ['max cut / fill', `${formatMeters(s.maxCutM, 2)} / ${formatMeters(s.maxFillM, 2)}`],
      ['cut', volume(s.cutVolumeM3)], ['fill', volume(s.fillVolumeM3)],
      ['net', `${s.netVolumeM3 >= 0 ? 'import' : 'export'} ${volume(Math.abs(s.netVolumeM3))}`],
      ...(s.wetLengthM > 0 ? [['wet length', `${formatDistance(s.wetLengthM)} · needs bridge/culvert`]] : []),
      ...(s.crossesRoads.length ? [['crosses', s.crossesRoads.join(', ')]] : []),
      ['vehicle (natural)', percent(s.vehiclePassableNaturalFraction), 'Share of the line passable by vehicles before construction'],
    ];
  }

  function trafficBar(traffic, lengthM) {
    return h('div', { class: 'traffic-bar', title: 'Natural-ground trafficability along the line' },
      TRAFFIC_CLASSES.filter(c => traffic[c] > 0).map(c => h('span', { title: `${TRAFFIC_LABELS[c]} · ${formatDistance(traffic[c])}`,
        style: { width: `${100 * traffic[c] / lengthM}%`, background: TRAFFIC_COLORS[c] } })));
  }

  function renderSandbox() {
    const sb = state.sandbox, set = sb.settings, panel = $('sandbox-panel');
    const num = (label, key, attrs, scale = 1) => h('label', { class: 'field' }, h('span', {}, label),
      h('input', { type: 'number', value: +(set[key] * scale).toFixed(3), ...attrs,
        onchange: e => { const v = Number(e.target.value); if (Number.isFinite(v) && v >= (attrs.min ?? 0)) { set[key] = v / scale; syncSandbox(); } } }));
    const hint = map.tool !== 'sandbox' ? 'Choose the Sandbox tool (S) in the toolbar, then click the map.'
      : sb.mode === 'pad' ? 'Click the map to place a test building pad. Click a placed pad to select it.'
        : sb.pending ? 'Click the second point to finish the test road (Esc cancels).' : 'Click the first point of a test road.';
    // h() flattens arrays and drops nulls; replaceChildren would stringify them.
    panel.replaceChildren(...[
      h('h4', {}, 'Placement'),
      h('div', { class: 'form-row' },
        h('div', { class: 'segmented' },
          h('button', { class: sb.mode === 'pad' ? 'on' : '', onclick: () => { setTool('sandbox'); setSandboxMode('pad'); } }, 'Building pad'),
          h('button', { class: sb.mode === 'road' ? 'on' : '', onclick: () => { setTool('sandbox'); setSandboxMode('road'); } }, 'Road segment'))),
      h('p', { class: 'muted small' }, hint),
      sb.mode === 'pad'
        ? h('div', { class: 'form-grid' }, num('Width (m)', 'padWidthM', { min: 1, step: 1 }), num('Depth (m)', 'padDepthM', { min: 1, step: 1 }),
          num('Rotation (°)', 'padRotationDeg', { min: -360, max: 360, step: 5 }))
        : h('div', { class: 'form-grid' }, num('Width (m)', 'roadWidthM', { min: 1, step: 0.5 }), num('Smoothing (m)', 'roadSmoothingM', { min: 0, step: 10 }),
          num('Max grade (%)', 'maxRoadGrade', { min: 0.5, step: 0.5 }, 100)),
      h('h4', {}, `Placed items (${sb.items.length})`),
      sb.items.length ? null : h('p', { class: 'empty' }, 'No test pads or roads yet.'),
      sb.items.map(item => h('div', { class: `sandbox-item${item.id === sb.selectedId ? ' active' : ''}`, onclick: () => selectSandboxItem(item.id) },
        h('div', { class: 'sandbox-item-head' },
          h('b', {}, item.kind === 'pad' ? 'Test pad' : 'Test road'), h('span', { class: 'muted small' }, item.id),
          h('button', { class: 'ghost small', title: 'Remove', onclick: e => { e.stopPropagation(); removeSandboxItem(item.id); } }, 'Remove')),
        item.kind === 'road' ? trafficBar(item.summary.naturalTraffic, item.summary.lengthM) : null,
        h('dl', { class: 'kv compact' }, sandboxSummaryRows(item).flatMap(([k, v, tip]) => [h('dt', {}, k), h('dd', { title: tip ?? String(v) }, v)])),
        h('div', { class: 'muted small' }, `designed in ${formatNumber(item.elapsedMs ?? 0, 0)} ms`))),
      sb.items.length ? h('div', { class: 'form-row' },
        h('button', { class: 'ghost', onclick: clearSandbox }, 'Clear all'),
        h('button', { class: 'ghost', onclick: exportSandbox }, 'Export JSON')) : null,
      h('p', { class: 'muted small' }, 'Previews only: the scene terrain is not modified. Pads use the core minimum-earthwork design; ',
        'roads use a smoothed design grade with average-end-area volumes (carriageway + batters).'),
    ].flat().filter(Boolean));
  }

  function exportSandbox() {
    const items = state.sandbox.items.map(({ profile, ...rest }) => rest);
    download('sandbox-earthwork.json', JSON.stringify({ scene: state.scene?.label ?? null, worldId: state.scene?.worldId ?? null, items }, null, 2), 'application/json');
  }

  // ---------- Layers ----------

  function setLayers(patch) {
    map.setLayers(patch);
    for (const [key, input] of Object.entries(layerInputs)) input.checked = !!map.layers[key];
    for (const b of $('layer-toggles').children) {
      const on = b.dataset.layers.split(',').every(k => map.layers[k]);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    $('traffic-legend').hidden = !map.layers.trafficability;
    $('drainage-legend').hidden = !map.layers.drainage;
    if (state.pinned) pin(state.pinned);
  }

  function renderQuickLayers() {
    $('layer-toggles').replaceChildren(...QUICK_LAYERS.map(([label, keys]) => h('button', {
      dataset: { layers: keys.join(',') }, title: `Toggle ${label.toLowerCase()}${LAYER_KEYS[label] ? ` (${LAYER_KEYS[label]})` : ''}`,
      onclick: () => { const on = keys.every(k => map.layers[k]); setLayers(Object.fromEntries(keys.map(k => [k, !on]))); },
    }, label)));
    const t = TRAFFIC_THRESHOLDS;
    $('traffic-legend').replaceChildren(h('b', {}, 'Trafficability · pedestrian'),
      ...TRAFFIC_CLASSES.map(c => h('div', {}, h('span', { class: 'swatch', style: { background: c === 'cliff'
        ? `repeating-linear-gradient(45deg, ${TRAFFIC_COLORS[c]} 0 3px, #7a1f18 3px 6px)` : TRAFFIC_COLORS[c] } }), TRAFFIC_LABELS[c])),
      h('div', { class: 'small' }, `scramble > ${t.offroadSlope * 100}% · cliff > ${t.cliffSlope * 100}% · wading ≤ ${t.wadingDepthM} m · vehicle slope ≤ ${t.vehicleMaxSlope * 100}% / water ≤ ${t.vehicleFordDepthM} m · unknown water stays unknown`));
    $('drainage-legend').replaceChildren(h('b', {}, 'Drainage & basins'),
      h('div', {}, ...basinPalette(6).map(c => h('span', { class: 'swatch tight', style: { background: rgbCss(c) } })), 'catchments (by basin)'),
      h('div', {}, h('span', { class: 'swatch', style: { background: 'rgba(0,0,0,0.55)' } }), 'basin divide'),
      h('div', {}, h('span', { class: 'glyph' }, '➝'), 'downhill flow'),
      h('div', {}, h('span', { class: 'glyph', style: { color: '#ff6b4a' } }, '▼'), 'depression (trapped flow)'),
      h('div', {}, h('span', { class: 'glyph', style: { color: '#f2b84b' } }, '▼'), 'pit (local minimum)'),
      h('div', {}, h('span', { class: 'glyph', style: { color: '#c792ea' } }, '◆'), 'chart seam'));
  }

  // ---------- Panels ----------

  function renderLegend() {
    const c = $('legend-canvas'), ctx = c.getContext('2d'), range = state.scene.elevationRange;
    for (let i = 0; i < c.width; i++) {
      const [r, g, b] = elevationColor(range.minM + (range.maxM - range.minM) * i / (c.width - 1), range);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`; ctx.fillRect(i, 0, 1, c.height);
    }
    $('legend-min').textContent = formatMeters(range.minM, 0);
    $('legend-max').textContent = formatMeters(range.maxM, 0);
  }

  function renderViews() {
    const scene = state.scene, field = $('view-field'), sel = $('view-select');
    field.hidden = scene.views.length < 2;
    sel.replaceChildren(...scene.views.map(v => h('option', { value: v.index, selected: v.index === scene.viewIndex }, v.label)));
    $('chart-prev').disabled = $('chart-next').disabled = scene.views.length < 2;
  }

  /** Load another water chart of the current multi-chart scene (wraps around). */
  function jumpToChart(index) {
    const views = state.scene?.views ?? [];
    if (views.length < 2 || state.loading) return;
    const next = ((index % views.length) + views.length) % views.length;
    if (next !== state.scene.viewIndex) load(state.input, { label: state.label, viewIndex: next });
  }

  function renderRoadSelect() {
    const roads = state.scene.overlays.roads;
    $('road-select').hidden = !roads.length;
    $('road-select').replaceChildren(h('option', { value: '' }, roads.length ? 'Road profile…' : 'No roads'),
      ...roads.map(r => h('option', { value: r.id }, r.id)));
  }

  function renderSceneInfo() {
    const s = state.scene, b = s.bounds, o = s.overlays, panel = $('scene-panel');
    const row = (k, v, title) => [h('dt', {}, k), h('dd', { title: title ?? String(v) }, v)];
    panel.replaceChildren(
      h('h4', {}, s.label ?? 'Scene'),
      h('dl', { class: 'kv' },
        row('schema', s.schema), row('kind', s.kind), row('interpolation', s.interpolation ?? '—'),
        row('worldId', shortId(s.worldId, 16), s.worldId),
        ...(s.regionId ? row('regionId', shortId(s.regionId, 16), s.regionId) : []),
        ...(s.roadAdjustmentId ? row('roadAdjustmentId', shortId(s.roadAdjustmentId, 16), s.roadAdjustmentId) : []),
        row('vertical datum', s.verticalDatum ?? '—'),
        row('hydrology', s.hydrologyStatus),
        row('bounds', `${formatNumber(b.minXM, 0)}…${formatNumber(b.maxXM, 0)} × ${formatNumber(b.minYM, 0)}…${formatNumber(b.maxYM, 0)} m`),
        row('extent', `${formatDistance(b.maxXM - b.minXM)} × ${formatDistance(b.maxYM - b.minYM)}`),
        ...(s.grid ? row('grid', `${s.grid.columns}×${s.grid.rows} @ ${s.grid.cellSizeM} m`) : []),
        row('elevation', `${formatMeters(s.elevationRange.minM, 1)} … ${formatMeters(s.elevationRange.maxM, 1)}`)),
      h('h4', {}, 'Features'),
      h('dl', { class: 'kv' },
        row('water bodies', o.waterBodies.length), row('river edges', o.rivers.length + o.sourceRivers.length),
        row('roads', o.roads.length), row('bridges', o.bridges.length), row('building pads', o.buildingPads.length),
        row('settlements', o.settlements.length), row('crossings', s.crossings.length)),
      ...(map.charts.length > 1 ? [h('h4', {}, `Water charts (${map.charts.length})`),
        h('div', { class: 'chart-list' }, map.charts.map(c => h('div', { class: `chart-item${c.active ? ' active' : ''}` },
          h('div', {}, h('b', {}, c.id), h('div', { class: 'muted small' }, c.label.slice(c.id.length + 3)),
            h('div', { class: 'muted small' }, `${c.riverCount} river edge${c.riverCount === 1 ? '' : 's'} · ${c.seams.length} seam${c.seams.length === 1 ? '' : 's'}`
              + (c.active ? ' · shown' : ` · ${formatDistance(c.distanceM)}${c.bearingDeg === null ? '' : ` at ${formatNumber(c.bearingDeg, 0)}°`}`))),
          c.active ? h('span', { class: 'badge' }, 'Active') : h('button', { class: 'ghost small', onclick: () => jumpToChart(c.index) }, 'Jump'))))] : []),
      ...(s.warnings.length ? [h('h4', {}, 'Notes'), ...s.warnings.map(w => h('div', { class: 'callout' }, w))] : []),
      h('h4', {}, 'Load timings'),
      h('dl', { class: 'kv' }, Object.entries(s.timings).flatMap(([k, v]) => row(k, `${formatNumber(v, 0)} ms`))),
      h('div', { class: 'form-row' }, h('button', { class: 'ghost', onclick: exportBundle }, 'Download scene bundle')));
  }

  function exportBundle() {
      const s = state.scene, bundle = sceneBundleForExport(s);
    download(`${String(s.label ?? 'scene').replace(/[^\w.-]+/g, '_')}.scene.json`, JSON.stringify(bundle), 'application/json');
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderLayers() {
    const body = $('layers-body');
    body.replaceChildren(
      ...Object.keys(DEFAULT_LAYERS).map(key => h('label', { class: 'check' },
        layerInputs[key] = h('input', { type: 'checkbox', checked: map.layers[key], onchange: e => setLayers({ [key]: e.target.checked }) }), LAYER_LABELS[key] ?? key)),
      h('hr'),
      h('label', { class: 'field' }, h('span', {}, 'Relief exaggeration'),
        h('input', { type: 'range', min: 0.5, max: 10, step: 0.5, value: map.shading.exaggeration,
          oninput: e => map.setShading({ exaggeration: Number(e.target.value) }) })),
      h('label', { class: 'field' }, h('span', {}, 'Light azimuth'),
        h('input', { type: 'range', min: 0, max: 359, step: 1, value: map.shading.azimuthDeg,
          oninput: e => map.setShading({ azimuthDeg: Number(e.target.value) }) })),
      h('label', { class: 'field' }, h('span', {}, 'Raster resolution'),
        h('select', { onchange: e => { map.setShading({ pixelsPerSample: Number(e.target.value) }); map.viewChanged(); } },
          [[1, 'Fine (1 px)'], [1.5, 'Balanced (1.5 px)'], [3, 'Fast (3 px)'], [6, 'Draft (6 px)']].map(([v, t]) =>
            h('option', { value: v, selected: v === map.shading.pixelsPerSample }, t)))));
  }

  function selectTab(name) {
    for (const b of root.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === name);
    for (const p of root.querySelectorAll('[data-panel]')) p.classList.toggle('on', p.dataset.panel === name);
  }

  function setTool(tool) {
    map.setTool(tool);
    $('tool-pan').classList.toggle('on', tool === 'pan');
    $('tool-profile').classList.toggle('on', tool === 'profile');
    $('tool-sandbox').classList.toggle('on', tool === 'sandbox');
    $('sandbox-modes').hidden = tool !== 'sandbox';
    if (tool !== 'sandbox') state.sandbox.pending = null;
    syncSandbox();
  }

  // ---------- Wiring ----------

  $('preset-select').replaceChildren(h('option', { value: '', disabled: true }, 'Choose a preset…'),
    ...PRESETS.map(p => h('option', { value: p.id, title: p.description ?? p.path }, `${p.label} · ${p.size}`)));
  $('preset-select').addEventListener('change', e => e.target.value && loadPreset(e.target.value));
  $('open-file').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
  $('view-select').addEventListener('change', e => load(state.input, { label: state.label, viewIndex: Number(e.target.value) }));
  $('chart-prev').addEventListener('click', () => jumpToChart((state.scene?.viewIndex ?? 0) - 1));
  $('chart-next').addEventListener('click', () => jumpToChart((state.scene?.viewIndex ?? 0) + 1));
  $('tool-pan').addEventListener('click', () => setTool('pan'));
  $('tool-profile').addEventListener('click', () => setTool('profile'));
  $('tool-sandbox').addEventListener('click', () => { setTool('sandbox'); selectTab('sandbox'); });
  $('sandbox-pad').addEventListener('click', () => setSandboxMode('pad'));
  $('sandbox-road').addEventListener('click', () => setSandboxMode('road'));
  $('fit-view').addEventListener('click', () => map.fit());
  $('road-select').addEventListener('change', e => e.target.value && showRoadProfile(e.target.value, { focus: true }));
  $('profile-reset').addEventListener('click', () => chart.setRange(null));
  $('profile-clear').addEventListener('click', () => setProfile(null));
  $('profile-csv').addEventListener('click', () => state.profile && download(`${state.profile.id.replace(/[^\w.-]+/g, '_')}.csv`, profileToCsv(state.profile), 'text/csv'));
  for (const b of root.querySelectorAll('[data-tab]')) b.addEventListener('click', () => selectTab(b.dataset.tab));

  // Drag and drop anywhere in the window.
  let dragDepth = 0;
  const overlay = $('drop-overlay');
  const hasFiles = e => [...(e.dataTransfer?.types ?? [])].includes('Files');
  window.addEventListener('dragenter', e => { if (hasFiles(e)) { dragDepth++; overlay.classList.add('on'); e.preventDefault(); } });
  window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; overlay.classList.remove('on'); } });
  window.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); dragDepth = 0; overlay.classList.remove('on');
    loadFile(e.dataTransfer.files[0]);
  });

  window.addEventListener('keydown', e => {
    if (e.target.closest?.('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'f' || e.key === 'F') map.fit();
    else if (e.key === 'p' || e.key === 'P') setTool(map.tool === 'profile' ? 'pan' : 'profile');
    else if (e.key === 's' || e.key === 'S') { setTool(map.tool === 'sandbox' ? 'pan' : 'sandbox'); if (map.tool === 'sandbox') selectTab('sandbox'); }
    else if (e.key === 't' || e.key === 'T') setLayers({ trafficability: !map.layers.trafficability });
    else if (e.key === 'd' || e.key === 'D') setLayers({ drainage: !map.layers.drainage });
    else if (e.key === '[') jumpToChart((state.scene?.viewIndex ?? 0) - 1);
    else if (e.key === ']') jumpToChart((state.scene?.viewIndex ?? 0) + 1);
    else if (e.key === 'Escape') {
      // First Escape cancels a half-drawn sandbox road; the next one resets the tool.
      if (state.sandbox.pending) { state.sandbox.pending = null; syncSandbox(); return; }
      pin(null); map.setOverlay({ highlight: null, focusCrossingId: null, focusJunctionId: null }); setTool('pan');
    }
  });

  renderLayers();
  renderQuickLayers();
  setLayers({});
  syncSandbox();
  const initial = new URL(location.href).searchParams.get('preset') ?? 'demo';
  $('preset-select').value = PRESETS.some(p => p.id === initial) ? initial : 'demo';
  loadPreset($('preset-select').value);

  return { state, map, chart, inspector, crossings, lod, load, loadPreset, loadFile, focusCrossing, focusJunction, showRoadProfile, showLineProfile,
    setLayers, setTool, setSandboxMode, sandboxClick, clearSandbox, jumpToChart };
}

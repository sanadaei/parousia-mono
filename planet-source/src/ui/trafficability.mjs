// Presentation of core movement results. Colours summarize pedestrian movement;
// each mode retains the core class, passability, cost and unknown water depth.
import { evaluateTrafficabilityAt, TRAFFICABILITY_DEFAULTS } from '../core/trafficability.mjs';

// Historical UI option names remain aliases of the core defaults.
export const TRAFFIC_THRESHOLDS = Object.freeze({
  offroadSlope: TRAFFICABILITY_DEFAULTS.maxWalkableSlopeMPerM,
  vehicleMaxSlope: TRAFFICABILITY_DEFAULTS.maxVehicleSlopeMPerM,
  cliffSlope: TRAFFICABILITY_DEFAULTS.maxScrambleSlopeMPerM,
  vehicleFordDepthM: TRAFFICABILITY_DEFAULTS.maxVehicleWadingDepthM,
  wadingDepthM: TRAFFICABILITY_DEFAULTS.maxPedestrianWadingDepthM,
});
export const TRAFFIC_CLASSES = Object.freeze(['highway', 'paved', 'offroad', 'difficult', 'cliff', 'wading', 'deep-water']);
export const TRAFFIC_COLORS = Object.freeze({
  highway: '#3fbf5f', paved: '#5fcf8a', offroad: '#a6e07a', difficult: '#f2b84b',
  cliff: '#e0453a', wading: '#4fd6e8', 'deep-water': '#2a62d8',
});
export const TRAFFIC_LABELS = Object.freeze({
  highway: 'Dry road / bridge', paved: 'Building pad', offroad: 'Walkable ground',
  difficult: 'Difficult scramble', cliff: 'Cliff / blocked', wading: 'Shallow wading', 'deep-water': 'Deep water (pedestrian blocked)',
});
function coreOptions(t) {
  return { maxWalkableSlopeMPerM: t.offroadSlope, maxScrambleSlopeMPerM: t.cliffSlope,
    maxVehicleSlopeMPerM: t.vehicleMaxSlope, maxPedestrianWadingDepthM: t.wadingDepthM,
    maxVehicleWadingDepthM: t.vehicleFordDepthM, ...t };
}
function presentation(p, v) {
  const overlay = p.pedestrianClass === 'impassable-cliff' ? 'cliff'
    : p.pedestrianClass === 'drowning-deep' ? 'deep-water'
      : p.pedestrianClass === 'wading-shallow' ? 'wading'
        : p.pedestrianClass === 'difficult-scramble' ? 'difficult'
          : v.vehicleClass === 'highway' ? 'highway' : p.structureKind === 'building-pad' ? 'paved' : 'offroad';
  return { class: overlay, label: TRAFFIC_LABELS[overlay], color: TRAFFIC_COLORS[overlay],
    pedestrian: { class: p.pedestrianClass, passable: p.isPassable, costFactor: p.costFactor },
    vehicle: { class: v.vehicleClass, passable: v.isPassable, costFactor: v.costFactor },
    waterDepthM: p.waterDepthM, waterStatus: p.waterDepthM == null ? 'unknown' : p.waterDepthM > 0 ? 'wet' : 'dry',
    passable: p.isPassable, costFactor: p.costFactor };
}
/** Query the actual terrain, including its canonical road surface and deck overtopping. */
export function terrainTrafficabilityAt(terrain, xM, yM, options = {}) {
  const config = coreOptions(options);
  return presentation(evaluateTrafficabilityAt(terrain, xM, yM, { ...config, movementMode: 'pedestrian' }),
    evaluateTrafficabilityAt(terrain, xM, yM, { ...config, movementMode: 'vehicle' }));
}
/** Present an already sampled surface without inventing separate movement rules. */
export function classifyTrafficability(sample = {}, t = TRAFFIC_THRESHOLDS) {
  const surface = { slopeMPerM: 0, waterDepthM: null, structureKind: 'natural-ground', ...sample };
  if (['at-grade', 'cut', 'fill', 'approach-ramp', 'bridge-deck'].includes(surface.structureKind)) surface.surfaceKind ??= 'road';
  return terrainTrafficabilityAt({ sampleAt: () => surface }, 0, 0, t);
}
const RGB = Object.fromEntries(Object.entries(TRAFFIC_COLORS).map(([k, hex]) =>
  [k, [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))]));
/** Natural-ground raster uses the same core classifier; NaN water remains unknown. */
export function trafficRasterColor(slopeMPerM, depthM, t = TRAFFIC_THRESHOLDS) {
  // Infinity is the existing map's sentinel for the cliff hatch colour.
  if (slopeMPerM === Infinity) return RGB.cliff;
  return RGB[classifyTrafficability({ slopeMPerM, waterDepthM: Number.isNaN(depthM) ? null : depthM }, t).class];
}
export const formatCost = cost => Number.isFinite(cost) ? `×${cost.toFixed(2)}` : '∞';

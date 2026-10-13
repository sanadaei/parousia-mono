import { finiteNumber as finite, positiveNumber as positive } from './contract-validation.mjs';

export const TRAFFICABILITY_CLASSES = Object.freeze({
  pedestrian: Object.freeze(['walkable', 'difficult-scramble', 'impassable-cliff', 'wading-shallow', 'drowning-deep']),
  vehicle: Object.freeze(['highway', 'offroad-passable', 'steep-infeasible', 'flooded', 'blocked']),
});

export const TRAFFICABILITY_DEFAULTS = Object.freeze({
  maxWalkableSlopeMPerM: 0.5,
  maxScrambleSlopeMPerM: 1,
  maxVehicleSlopeMPerM: 0.3,
  maxPedestrianWadingDepthM: 0.3,
  maxVehicleWadingDepthM: 0.4,
});

const MAX_WINDOW_SAMPLES = 262144;
function nonnegative(value, name) {
  finite(value, name);
  if (value < 0) throw new RangeError(`${name} must be nonnegative`);
  return value;
}
function checkTerrain(terrain) {
  if (typeof terrain?.sampleAt !== 'function') throw new TypeError('Terrain needs sampleAt');
  if (terrain.frame?.kind === 'sphere-geographic') throw new TypeError('Trafficability requires a metric terrain view');
}
function settings(options) {
  const movementMode = options.movementMode ?? 'pedestrian';
  if (!['pedestrian', 'vehicle'].includes(movementMode)) throw new TypeError('Invalid movementMode');
  const result = {
    movementMode,
    ...Object.fromEntries(Object.entries(TRAFFICABILITY_DEFAULTS).map(([key, fallback]) =>
      [key, nonnegative(options[key] ?? fallback, key)])),
  };
  if (result.maxWalkableSlopeMPerM > result.maxScrambleSlopeMPerM) {
    throw new RangeError('Walkable slope must not exceed scramble slope');
  }
  if (options.maxWadingDepthM != null) {
    result[movementMode === 'pedestrian' ? 'maxPedestrianWadingDepthM' : 'maxVehicleWadingDepthM']
      = nonnegative(options.maxWadingDepthM, 'maxWadingDepthM');
  }
  return Object.freeze(result);
}

function evaluate(terrain, xM, yM, config) {
  finite(xM, 'xM'); finite(yM, 'yM');
  const sample = terrain.sampleAt(xM, yM);
  const frame = terrain.surfaceFrameAt?.(xM, yM) ?? sample;
  const road = terrain.roadSurfaceAt?.(xM, yM) ?? null;
  const surface = { ...sample, ...frame, ...road };
  const structureKind = surface.structureKind ?? 'natural-ground';
  const surfaceKind = surface.surfaceKind ?? 'ground';
  const isBridge = structureKind === 'bridge-deck';
  const isRoad = road !== null || isBridge || surfaceKind === 'road' || surfaceKind === 'carriageway';
  const isPad = structureKind === 'building-pad';
  const slopeMPerM = nonnegative(surface.slopeMPerM ?? Math.hypot(
    finite(surface.gradient?.x, 'gradient.x'), finite(surface.gradient?.y, 'gradient.y')), 'slopeMPerM');
  const roughness = nonnegative(surface.roughness ?? 0, 'roughness');
  let waterDepthM = sample.waterDepthM == null ? null : nonnegative(sample.waterDepthM, 'waterDepthM');
  if (isRoad) {
    const level = sample.waterLevelElevationM ?? sample.waterSurfaceElevationM;
    const elevation = surface.roadElevationM ?? surface.deckElevationM;
    if (level != null && elevation != null) {
      waterDepthM = Math.max(0, finite(level, 'water level') - finite(elevation, 'road elevation'));
    } else if (isBridge) {
      // Explicit bridge-deck samples describe the supported deck, rather than
      // the riverbed. Road overlays supply elevation to detect deck overtopping.
      waterDepthM = 0;
    }
  }
  // Unknown hydrology remains null. These are geometric movement estimates;
  // absence of a water model is not evidence that the location is dry.
  const depth = waterDepthM ?? 0;
  let pedestrianClass = slopeMPerM <= config.maxWalkableSlopeMPerM ? 'walkable'
    : slopeMPerM <= config.maxScrambleSlopeMPerM ? 'difficult-scramble' : 'impassable-cliff';
  if (depth > config.maxPedestrianWadingDepthM) pedestrianClass = 'drowning-deep';
  else if (depth > 0 && pedestrianClass !== 'impassable-cliff') pedestrianClass = 'wading-shallow';
  let vehicleClass = depth > config.maxVehicleWadingDepthM ? 'flooded'
    : slopeMPerM > config.maxVehicleSlopeMPerM ? 'steep-infeasible'
      : isRoad && depth === 0 ? 'highway' : 'offroad-passable';
  if (surfaceKind === 'blocked' || structureKind === 'blocked') {
    pedestrianClass = 'impassable-cliff'; vehicleClass = 'blocked';
  }
  const isPassable = config.movementMode === 'pedestrian'
    ? !['impassable-cliff', 'drowning-deep'].includes(pedestrianClass)
    : ['highway', 'offroad-passable'].includes(vehicleClass);
  // Fixed coefficients make cost monotone in slope, roughness and water depth.
  // Engineered dry surfaces discard inherited natural-ground roughness.
  const costFactor = !isPassable ? Infinity : isRoad && depth === 0 ? 1
    : finite(1 + 2 * slopeMPerM + (isRoad || isPad ? 0 : roughness) + 4 * depth, 'costFactor');
  return { xM, yM, worldId: sample.worldId ?? terrain.worldId ?? null, slopeMPerM, waterDepthM,
    surfaceKind, structureKind, roughness, pedestrianClass, vehicleClass, costFactor, isPassable };
}

/** Point evaluation in metres; slope thresholds are inclusive rise/run ratios.
 * Defaults: walk <= 0.5, scramble <= 1, vehicle <= 0.3; wade <= 0.3m/0.4m.
 * movementMode selects isPassable/costFactor (default pedestrian); both classes
 * are always returned. maxWadingDepthM overrides the selected mode's limit.
 * Passable costs are finite; blocked costs are Infinity. No display/LOD state
 * participates in classification, derivatives, or cost.
 */
export function evaluateTrafficabilityAt(terrain, xM, yM, options = {}) {
  checkTerrain(terrain);
  return evaluate(terrain, xM, yM, settings(options));
}

/** Wrap base or earthwork terrain. Own the numeric options so later caller
 * mutations cannot alter results. Windows are inclusive row-major vertex grids;
 * exactly equal metric coordinates yield exactly equal point results at all LODs.
 */
export function createTrafficabilitySampler(terrain, options = {}) {
  checkTerrain(terrain);
  const config = settings(options);
  const trafficabilityAt = (xM, yM) => evaluate(terrain, xM, yM, config);
  function sampleTrafficabilityWindow({ minXM, minYM, maxXM, maxYM, spacingM } = {}) {
    for (const [key, value] of Object.entries({ minXM, minYM, maxXM, maxYM })) finite(value, key);
    positive(spacingM, 'spacingM');
    const width = maxXM - minXM, height = maxYM - minYM;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new RangeError('Window must have a finite positive area');
    }
    if (minXM + spacingM === minXM || minYM + spacingM === minYM
      || maxXM - spacingM === maxXM || maxYM - spacingM === maxYM) {
      throw new RangeError('spacingM is too small for these coordinates');
    }
    const nx = Math.round(width / spacingM), ny = Math.round(height / spacingM);
    if (!Number.isSafeInteger(nx) || !Number.isSafeInteger(ny) || nx < 1 || ny < 1
      || Math.abs(nx * spacingM - width) > Math.max(1, width) * 1e-10
      || Math.abs(ny * spacingM - height) > Math.max(1, height) * 1e-10) {
      throw new RangeError('Window dimensions must be whole multiples of spacingM');
    }
    if ((nx + 1) * (ny + 1) > MAX_WINDOW_SAMPLES) throw new RangeError('Window exceeds 262144 samples');
    const samples = [];
    for (let y = 0; y <= ny; y++) for (let x = 0; x <= nx; x++) {
      samples.push(trafficabilityAt(x === nx ? maxXM : minXM + x * spacingM,
        y === ny ? maxYM : minYM + y * spacingM));
    }
    return { worldId: terrain.worldId ?? null, ...(terrain.regionId ? { regionId: terrain.regionId } : {}),
      bounds: { minXM, minYM, maxXM, maxYM }, spacingM, columns: nx + 1, rows: ny + 1, samples };
  }
  return Object.freeze({ ...terrain, trafficabilityAt, sampleTrafficabilityWindow });
}

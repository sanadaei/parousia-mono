/** Shared cuts for cell-center interpolation patches (not physical cell edges). */
export function* gridAxisCuts(min, max, origin, count, cellSizeM) {
  for (let i = Math.max(0, Math.ceil((min - origin) / cellSizeM - 0.5)); i < count; i++) {
    const value = origin + (i + 0.5) * cellSizeM;
    if (value >= max) break;
    if (value > min) yield value;
  }
}

export function segmentGridCuts(a, b, grid, frame, maxCuts = Infinity) {
  const marks = new Set([0, 1]);
  for (const [axis, origin, count] of [['xM', frame.originXM, grid.columns], ['yM', frame.originYM, grid.rows]]) {
    const delta = b[axis] - a[axis]; if (!delta) continue;
    for (const value of gridAxisCuts(Math.min(a[axis], b[axis]), Math.max(a[axis], b[axis]), origin, count, grid.cellSizeM)) {
      marks.add((value - a[axis]) / delta);
      if (marks.size > maxCuts) throw new RangeError('Grid cuts exceed sample budget');
    }
  }
  return [...marks].sort((x, y) => x - y);
}

/** Vertex of the quadratic reconstructed from its endpoint and midpoint values. */
export function quadraticVertex(f0, fm, f1, { minimumOnly = false, epsilon = 0 } = {}) {
  const quadratic = 2 * (f0 + f1 - 2 * fm), linear = f1 - f0 - quadratic;
  if (minimumOnly ? quadratic <= epsilon : Math.abs(quadratic) <= epsilon) return null;
  const t = -linear / (2 * quadratic);
  return t > 0 && t < 1 ? t : null;
}

/** The public surface depth is computed once, after local/background composition. */
export function composeSurfaceWater(ground, localLevel, localSources, staticLevel, role, surfaceDefined) {
  const gridLevel = role === 'surface' ? staticLevel : null;
  const waterLevelElevationM = localLevel === null ? gridLevel : gridLevel === null
    ? localLevel : Math.max(localLevel, gridLevel);
  const waterSourceIds = [...localSources];
  if (gridLevel !== null && gridLevel > ground && gridLevel >= (localLevel ?? -Infinity)) {
    if (gridLevel > (localLevel ?? -Infinity) + 1e-6) waterSourceIds.length = 0;
    waterSourceIds.push('water-level-grid'); waterSourceIds.sort();
  }
  return { waterLevelElevationM, waterDepthM: waterLevelElevationM === null ? (surfaceDefined ? 0 : null)
    : Math.max(0, waterLevelElevationM - ground), waterSourceIds };
}

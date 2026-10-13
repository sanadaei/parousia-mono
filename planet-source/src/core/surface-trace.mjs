export const MAX_TRACE_SAMPLES = 262144;

/** Common budget and coordinate arithmetic for finite and projected traces. */
export function surfaceTracePlan(a, b, maxStepM, maxSamples) {
  if (!Number.isFinite(maxStepM) || maxStepM <= 0) throw new RangeError('maxStepM must be positive and finite');
  if (!Number.isSafeInteger(maxSamples) || maxSamples < 2 || maxSamples > MAX_TRACE_SAMPLES) throw new RangeError('Invalid trace sample budget');
  const lengthM = Math.hypot(b.xM - a.xM, b.yM - a.yM), steps = Math.max(1, Math.ceil(lengthM / maxStepM));
  if (steps > Math.floor((maxSamples - 1) / 2)) throw new RangeError('Surface trace exceeds sample budget');
  const marks = new Set();
  for (let i = 0; i <= steps; i++) marks.add(i / steps);
  const pointAt = t => t === 0 ? a : t === 1 ? b
    : { xM: a.xM * (1 - t) + b.xM * t, yM: a.yM * (1 - t) + b.yM * t };
  return { lengthM, marks, pointAt };
}

/** Event providers supply marks; field-specific extrema refine initial intervals. */
export function completeSurfaceTrace(plan, { worldId, regionId, maxStepM, maxSamples, precision, sampleAt, refineInterval }) {
  const { lengthM, marks, pointAt } = plan;
  if (marks.size > maxSamples) throw new RangeError('Surface trace exceeds sample budget');
  const cuts = [...marks].sort((x, y) => x - y);
  for (let i = 1; i < cuts.length; i++) {
    const lo = cuts[i - 1], hi = cuts[i]; marks.add((lo + hi) / 2);
    refineInterval?.(lo, hi, marks, pointAt);
    if (marks.size > maxSamples) throw new RangeError('Surface trace exceeds sample budget');
  }
  return { worldId, ...(regionId ? { regionId } : {}), lengthM, maxStepM,
    ...(precision ? { precision } : {}), samples: [...marks].sort((x, y) => x - y)
      .map(t => { const p = pointAt(t); return { distanceM: t * lengthM, ...sampleAt(p.xM, p.yM) }; }) };
}

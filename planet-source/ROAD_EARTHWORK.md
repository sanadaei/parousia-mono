# Stage 4 road core

`road-earthwork.mjs` adds bridge vertical alignments, metric centerline sampling,
and a deterministic road earthwork overlay. All elevations use the terrain's
vertical datum; grades and batter slopes are rise/run. No external packages are
required. The package exposes `./road-earthwork` and `./contract-validation`.

```js
import { inspectRoadCrossings } from './road-crossings.mjs';
import { designBridgeProfile, sampleRoadCenterlineProfile,
  createRoadAdjustedTerrain } from './road-earthwork.mjs';

const crossings = inspectRoadCrossings(terrain, { roads: [road] }).crossings;
const bridges = crossings.map(c => designBridgeProfile(c, road, {
  groundElevationAt: (xM, yM) => terrain.groundElevationAt(xM, yM),
}));
const centerline = sampleRoadCenterlineProfile(terrain, road, bridges);
const adjusted = createRoadAdjustedTerrain(terrain, [centerline]);
const sample = adjusted.sampleAt(xM, yM);
```

## Bridge profiles

`designBridgeProfile(crossing, road, options = {})` returns `startDistanceM`,
`endDistanceM`, `deckElevationM`, `deckThicknessM`, `minimumClearanceM`,
`clearanceM`, `requiredDeckElevationM`, and `approaches.before/after`.
`sampleAt(distanceM)` returns the road elevation, analytic grade, and structure
kind inside the alignment, or `null` outside it. The returned design is owned
and immutable; its numeric data also survives JSON serialization.

Defaults are `clearanceM = 1`, `maxApproachSlope = 0.08`,
`deckThicknessM = 0.5`, and `minBridgeLengthM = 0`. The minimum length never
shortens the span between the dry witnesses bracketing the diagnosed wet run.
Clearance is measured from the **underside** of the deck to water, so structural
thickness is added to the required road surface elevation. A larger clearance
already requested by the crossing diagnosis remains binding.

Approaches are cubic Hermite curves joining the ground/road elevation and its
local grade to a flat deck. Constant-height ties reduce to cubic smoothstep;
its maximum derivative is 1.5, which is included in ramp length calculation.
The complete quadratic grade curve is checked analytically against the limit.
Insufficient road length, missing dry witnesses, changed road geometry, and
overlapping approaches produce explicit errors.

Roads need an `id` and at least two distinct consecutive `{ xM, yM }` points.
Optional `roadElevationM` must be provided on every point if provided on any
point. `halfWidthM` defaults to 3; `widthM / 2` is also accepted.
`options.roadElevationAt(distanceM, point)` overrides the explicit road heights;
otherwise `options.groundElevationAt(xM, yM)` supplies ground ties.
Without either elevations or an oracle, design uses constant-height estimates
from the dry witnesses and marks `requiresGroundTieResolution`. The centerline
sampler re-solves those approaches against the actual terrain. Supply the
oracle when final approach stations are needed before sampling.

## Centerlines and earthwork

`sampleRoadCenterlineProfile(terrain, road, bridges = [], options = {})` returns
an ordered array with the requested `distanceM`, `xM`, `yM`,
`groundElevationM`, `waterSurfaceElevationM`, `roadElevationM`,
`structureKind`, `clearanceM`, and `gradeSlope` fields. It also includes the
road ID, half width, available world/region IDs, and a `segmentKind` interval
tag that preserves deck boundaries in the earthwork input. `clearanceM` is
`null` where there is no known water surface. Dry terrain with unresolved
hydrology is never treated as proof that water is absent.

`maxStepM` defaults to 2m and `maxSamples` to 262,144. Road vertices, terrain
trace events, bridge joins, and approach grade extrema supplement the uniform
probes. Near-identical floating point stations are merged while preserving
vertices/joins. Road points retain their metric positions and sampling does
not depend on a display window. Existing bridge ties and world/region IDs are
validated before reuse; newly sampled deck clearance is checked too.

`createRoadAdjustedTerrain(terrain, profiles = [], options = {})` accepts an
array of centerline arrays, one flat centerline array, or objects containing
`{ roadId, halfWidthM, samples }`. It copies the numeric profiles and reconstructs
cubic vertical curves from sample heights and grades. Bridge spans leave the
underlying ground and waterway unchanged. Ground-supported spans set the road
carriageway to the design elevation and join the base terrain with smoothstep
batters and round end caps.

`batterSlope` defaults to 0.5 (1V:2H); `cutBatterSlope` and `fillBatterSlope`
override it separately. Batter width includes the smoothstep peak derivative:
`1.5 * abs(roadElevationM - localGroundElevationM) / batterSlope`. This bounds
the cross-slope on constant base terrain. Sloping base terrain contributes
its own derivative; the limit is not a global slope certificate.

Complete source samples are returned unchanged outside the earthwork footprint
and under bridge decks. Inside earthwork, water depths, gradients, and surface
frames are recomputed from the adjusted ground. `sampleWindow` and
`traceSurfaceSegment` use the same sampler, preserving exact same-coordinate
matches across adjacent windows and LOD. Road carriageways take precedence
over weaker batters; equal influences use nearest distance then sorted road
IDs. Differing elevations where multiple road corridors overlap require a
joint intersection design for continuous geometry; this module only provides
deterministic precedence there.

## Identity, rebuilding, and remaining work

The source `worldId` is retained so unchanged samples remain exactly equal to
the base terrain. The overlay has its own `roadAdjustmentId`, also included in
modified samples and windows. `toSnapshot()` returns an explicit
`minimal-world-road-adjusted-terrain@1` recipe containing `baseTerrain`,
`roadCenterlineProfiles`, and `options`. Rebuild by restoring the base with its
appropriate finite/projected terrain restorer, then calling
`createRoadAdjustedTerrain(base, recipe.roadCenterlineProfiles, recipe.options)`.
The recipe is not accepted directly by the canonical `restoreTerrain` function.

Stage 4 road core is implemented; Stage 4 as a whole remains in progress.
Bridge loads/supports, full-width water clearance, intersection alignment,
earthwork volumes, building foundations, flow recalculation, and global C1
geometry remain outside this core. Source trace events plus bounded probes do
not certify all earthwork extrema. Stage 5 runtime/UI/performance and user
acceptance remain pending.

Validation: `node --test test/road-earthwork.test.mjs` covers 22 new tests;
`npm test` covers those plus all 107 existing tests.

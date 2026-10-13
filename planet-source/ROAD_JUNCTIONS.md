# Stage 4 road junctions and earthwork drainage

The core APIs are exported from `index.mjs`, `src/core/index.mjs`, and the
`road-junctions.mjs` / `earthwork-drainage.mjs` package subpaths. Node 22+ ESM,
no external dependencies.

```js
import {
  designRoadJunctions, inspectRoadGradeSeparations,
  createJunctionAdjustedTerrain, restoreJunctionAdjustedTerrain,
  inspectEarthworkDrainage,
} from './index.mjs';

const design = designRoadJunctions(roads, { maxSlope: 0.08 });
const crossings = inspectRoadGradeSeparations(design.roads);
const adjusted = createJunctionAdjustedTerrain(baseTerrain, {
  ...design, batterSlopeMPerM: 0.5,
});
const drainage = inspectEarthworkDrainage(baseTerrain, {
  roads: design.roads, pads, culvertSpacingM: 100, maxPondingDepthM: 0.5,
});
const reopened = restoreJunctionAdjustedTerrain(JSON.stringify(adjusted.toSnapshot()));
```

## Road input and vertical profiles

Roads use `{ id, points, halfWidthM? }` or sampled profiles
`{ roadId, samples, halfWidthM? }`. Points require metric `xM`, `yM` and
`roadElevationM` (or a road-level `roadElevationM`). Optional `distanceM` must
match cumulative metric centerline distance, starting at zero. Default half
width is 3m; `widthM` is also accepted. Consecutive points must be distinct.
Optional `gradeSlope` values define cubic Hermite endpoint derivatives; without
them the original elevation is linear between vertices. Structure kinds are
`at-grade`, `cut`, `fill`, `approach-ramp`, `bridge-deck`. `segmentKind` tags the
following span, preserving exact deck/approach boundaries.

`designRoadJunctions` detects crossings and common endpoints, merges multi-road
crossing witnesses, and returns frozen, owned JSON `{ junctions, roads }`.
Each adjusted road contains both `points` and `samples`, including inserted
curve joins, geometry vertices and exact junction stations. Reconstruct these
as Hermite curves with their stored `gradeSlope`; linear interpolation loses
the designed approach smoothness. Each junction has `junctionId`, `roadIds`,
`members` (road ID and station), `roadElevationM`, and `plateauRadiusM`.

Ground-supported roads share one exact junction elevation. Its default is the
mean of incident elevations; `junctionElevationM` overrides it. The plateau
length accounts for both carriageway widths and the crossing angle. An
explicit `plateauRadiusM` must cover that overlap. Cubic approaches preserve
baseline heights/grades at ties, with analytic derivative extrema constrained
by `maxSlope` (default 0.08) and any stricter road-level limit. Adjacent
junctions can use a joint curve when independent approaches cannot fit.
Impossible slopes, incompatible overlapping plateaus, collinear overlapping
roads, duplicate IDs, malformed metadata, and exceeded numerical budgets
reject explicitly. Bridge decks and roads marked `gradeSeparated: true` are
excluded from at-grade unification.

## Road-over-road clearance

`inspectRoadGradeSeparations` returns `{ crossings, roadCount }`. Each crossing
includes both stations/elevations, upper/lower road IDs, `deckThicknessM`,
`verticalClearanceM`, `requiredVehicleClearanceM`, and one of:

- `at-grade-matched`: ground-supported carriageways agree within tolerance.
- `grade-separated-clearance-met`: underside clearance meets the requirement.
- `insufficient-vertical-clearance`: clearance is positive but too small.
- `collision`: the upper deck underside touches or penetrates the lower road.

The default requirement is 4.5m. Deck thickness comes from the local point or
road; unspecified bridge decks use 0.5m, other spans use zero. The inspector's
`deckThicknessM` option overrides thickness. `atGradeToleranceM` defaults to
1e-7m. Records also carry `kind`, `clearanceM`, `requiredClearanceM`, and
`stationsM` for consumers using the existing presentation conventions.
This checks centerline intersection elevations, not a full swept vehicle
envelope, bridge load capacity, or overlapping parallel structures.

## Joint terrain and restoration

`createJunctionAdjustedTerrain` validates designed junction membership and
matching elevation/grade. It preserves full carriageways and combines
overlapping smooth cut/fill batters continuously. It places no fill beneath
bridge decks. Sampling, surface frames, windows and traces use the same metric
ground function; query order, render LOD and window boundaries do not alter
the design. Traces use bounded probes and do not certify every batter extremum.

The adapter's `toSnapshot()` stores the natural base snapshot, junctions,
adjusted roads, batter slope, and `junctionAdjustmentId` under
`minimal-world-junction-adjusted-terrain@1`. `restoreJunctionAdjustedTerrain`
revalidates the recipe and its identity. Its default base restorer is the
regional `restoreTerrain`; pass a second callback for other base terrain
schemas or nested overlays. The canonical source world identity stays intact;
the additional adjustment ID identifies the construction recipe.

## Culvert and pad drainage proposals

Supply **natural terrain before these fills**, adjusted road profiles, and pad
designs or explicit pad records accepted by `createBuildingPadAdjustedTerrain`.
Inspection is separate from the terrain overlay: culverts represent pipes
through fill, not open trenches lowering the carriageway.

Roads are inspected in fixed station cells independent of render sampling.
Each spacing cell uses probes no more than 10m apart (or spacing/4), split at
geometry vertices. Positive fill contributes to `totalEmbankmentLengthM`, a
sampled length estimate. Transects follow road normals and are accepted only
where natural ground falls monotonically across the fill and crest height
exceeds upstream natural ground by `maxPondingDepthM`. Bridge spans, cuts,
flat crossfall, parallel flow and natural ridges do not generate proposals.

Each blocked spacing cell gets its lowest sampled drainage-path proposal.
Both pipe mouths extend beyond the actual fill batter toes; each end is solved
independently against local natural ground. Culverts include `roadId`,
`distanceM` / `stationM`, mouth coordinates, natural upstream/downstream
`invertElevationM`, positive `slopeMPerM`, `lengthM`, `pondingDepthM`,
`flowDirection`, and `drainageContinuity: true`. Pad proposals use polygon
transects in the local downhill direction and include `buildingId` instead.

`blockedFlowCount` counts sampled blocked road sections plus blocked pad
transects, rather than pipe count; road candidates include
`blockedSectionCount`. `unresolvedFlowCount` reports transects whose mouths
cannot be established within the region. The proposals survive JSON round
trips; recomputation from restored natural terrain and profiles is deterministic.

This is a bounded geometric drainage inspection. Flow paths smaller than the
probe spacing, paths curving around fills, pipe diameter/capacity, rainfall,
watershed accumulation, hydraulic head losses, network-wide routing and
time-dependent ponding remain unresolved. The default spacing limits station
cell size, not a certified maximum distance between irregular drainage paths.

## Roadmap position and evidence

Stage 4 junction alignment, centerline vehicle-clearance inspection, continuous
joint earthwork and sampled gravity pass-through design are implemented.
The dedicated `test/road-junctions.test.mjs` covers analytical grade bounds,
shared levels, deck boundaries, cut/fill continuity, natural pipe inverts,
batter-toe exits, source ownership, contracts, LOD/window/trace agreement,
JSON recipes and restoration in a fresh Node process. Actual scene acceptance,
full vehicle envelopes, structural calculations and hydraulic capacity remain
later validation gates; Stage 4 as a whole remains in progress.

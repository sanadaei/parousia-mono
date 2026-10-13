# Progressive terrain and water refinement

## Latest design direction: shape first

Following the user’s explicit correction, terrain and river morphology are now
prototyped together before fitting numerical explanations and accounting. The
working order is: compare plausible same-scale landforms and river sketches,
choose a useful shape, derive its coarse-to-fine representations, then reconcile
regional joins and water quantities. Earlier elevations and outlet choices are
revisable design inputs, not constraints that must prevent a better draft.
Existing accepted records are not silently overwritten; new shapes are explicit
region drafts. The constraint-led experiments below remain implementation and
diagnostic evidence, not the gatekeeper for visual design.

Current runnable workflow: [SHAPE_FIRST_REGION.md](SHAPE_FIRST_REGION.md).
The selected shape and all three alternatives are reproducible; water supply
annotations are a subsequent explanatory layer and do not deform the sketch.

## Earlier constraint-led implementation selection

Use adjacent 2× spacing reductions as the default engineering policy. A 4× step
is an explicit experiment requiring evidence; a large jump is not made safe by
renaming it a layer. These are provisional choices from bounded terrain tests,
not a universal physical resolution law.

Two boundary cases require different algorithms:

- **Unresolved, unadopted survey boundary:** `provisional-boundary` inserts fine
  exit samples only inside already open coarse boundary corridors. New samples
  use the actual fine elevations. Their volumes are reconciled under the parent
  corridor identities before one shared context is committed.
- **Specified receiving endpoints:** `soft-divide` with preference 0.15 keeps the
  endpoints and weakly favors inherited destinations among nearly equivalent
  downhill routing-head edges. It does not enforce nearest-parent watershed
  ownership as a hard wall. Adopted downstream budgets cannot silently change.

The existing hard-mask implementation remains available for regression and
controlled comparison. It is not the selected general refinement strategy.

## Evidence and its scope

The reproducible benchmark is in
`scripts/experiments/real-dem-layer-gap/REPORT.md`. It uses five predetermined,
overlapping 21.6 × 29.7 km Tuscany crops from NOAA ETOPO2022. Fine target heights
are genuine samples from the source product, not interpolation of the parent.
All variants share physical extents and target sampling. Computed drainage is
compared with a fine-terrain solver reference, not observed river centerlines.

Hard inherited masks lose corridor agreement as the gap grows from 2× to 8×.
Repeated smaller steps alone do not cure hard inherited watershed boundaries.
Interpolation-only refinement also fails to restore missing terrain information.
A weak preference avoids most of these restrictions, but preserving only sparse
coarse boundary exits still creates artificial routing-head corrections. The
provisional-boundary variant addresses that separate failure.

Perfect agreement with a fine-open reference is expected when every survey edge
is explicitly open. It validates the implementation, not real-world watershed
boundaries. The boundary variant changes parent corridor allocations by roughly
33–50% in these trials. This is a substantial uncertainty to reconcile, not a
small numerical residual. Routing head is neither excavated ground nor lake depth.

## Water and adoption contract

`refineWaterCandidate` returns a proposal whose identity includes the exact
terrain, routing options, output context and revised outlet budgets.
`reconcileWaterCandidate` performs an internal transaction on a still-provisional
shared domain. It checks total conservation and any already adopted allocations.
This is not a user confirmation gate. A conflicting adopted allocation rejects
with a wider-uncommitted-domain or retained-solution path.

`saveWaterCandidate` saves the context and the complete revised downstream ledger
in one immutable materialization record. Changed conditions require migration;
they do not replace an existing saved world. Neither total supply nor individual
rainfall sources are fabricated to recover the old outlet totals.

New imported inflows preserve their source identities, volumes and exact node
positions across refinement. Nonempty inflows retain ownership by default.
Legacy contexts with only combined flow cannot recover missing historical source
identities; they remain explicitly classified as legacy combined sources.
No-import legacy context identities remain compatible with the pinned baseline.

## New surface information

The experimental anchored surface and stage builder are in
`scripts/experiments/anchored-regional-surface.mjs` and
`scripts/experiments/staged-layer-handoff.mjs`.

One physical detail source is generated for a shared domain. For each stage,
subtract the bilinear reconstruction through that source's parent-node samples
from the finer source samples. Add this residual to the interpolated adopted
parent terrain, with a declared added-slope and added-relief envelope. Every
adopted parent point is then restored exactly. The source is sampled in physical
coordinates; rectangular grids are not stretched into square grids.

This adds measured nonzero generated detail rather than merely magnifying the
parent. It does not conserve parent-cell mean height or sediment volume, and it
is not an erosion model. The initial envelope is an experimental Tuscany-based
setting, not a general geology calibration. Requests finer than the source's
native spacing reject instead of claiming interpolated samples as new evidence.

`buildSavedLayerHandoff` preflights stage sizes, saves the full generated chain,
and serves neighboring windows from its single final context. Window reads do
not reroute or reseed terrain. Fresh-process reads with generators disabled are
part of the verification. Equal adjacent windows certify a shared context, not
independently generated neighboring contexts.

## Remaining scope

- The broad L1-to-local sampling gap must be reported in full; a fine local chain
  alone does not solve a missing broad transition.
- Open exterior survey exits remain unresolved until connected to a wider domain.
- Lakes, coasts, seasonal hydraulics and global imported-flow adoption are not
  established by this implementation.
- Same-scale real terrain is the reference for each comparison; matching extent
  and display does not by itself establish matching geological formation or
  terrain class.
- Legacy globe/UI paths are not silently switched to these experimental builders.

## Broad-to-local and complete-cell global connection

`broad-local-bridge.mjs` demonstrates a physical L1 lattice, not a fine local
window mislabeled as its first refinement. The saved Muna example spans
113.908 × 156.368 km, refining 3 × 3 through 129 × 129 in six 2× steps.
Its center-to-center survey budget deliberately excludes unadopted exterior
L1 crossings. It is a diagnostic broad bridge, not the complete global ledger.

The later `global-water-handoff.mjs` uses **two by two complete L1 cells** instead.
It preserves each cell's exact spherical-area local yield and actual incoming
coarse-edge volumes. A half-cell 5 × 5 lattice distributes local sources with
area quadrature, followed by five 2× stages to 129 × 129. This avoids mixing
full-cell accumulated flows with a center-to-center partial-cell footprint.
Domains whose water leaves and reenters are rejected before importing it twice.

An immutable accepted overlay stores the regional context and recomputed exterior
downstream corrections together. A compiled reader validates the graph and all
corrections once, snapshots the data, and supplies corrected outside flow in
constant time. Obsolete replaced coarse-cell queries reject. The original L1
record is unchanged. See [GLOBAL_WATER_HANDOFF.md](GLOBAL_WATER_HANDOFF.md).

## Continuing into fine local terrain

`fine-local-layer.mjs` cuts an aligned subgraph from the actual broad context.
Every incoming graph edge becomes an identified inlet at its exact node; local
sources and outgoing destination edges are accounted separately. Reentrant cuts
reject or require a different/wider joint domain. Four 2× stages can reach
approximately 55 × 76 m over an approximately 8.85 × 9.77 km neighborhood using
one native 55 m generated source. This is generated detail, not a real 55 m DEM.

The adopted demonstration uses a hydrologically selected single-outlet crop,
retaining that endpoint's identity, node, level and budget. Multi-outlet
provisional revisions are separate experiments and do not authorize changing an
already accepted outside ledger. All source, stages and edge accounting fit
inside the unchanged 16 MiB atomic-record limit; large display windows are
reconstructed from the stored result. Reload checks also continue refinement
from a reloaded source, including canonical source identity.

Accounting success does not certify ground-compatible rivers: the initial
unattenuated detail worsens required routing-head correction. Flow-aware and
lower-amplitude alternatives are evaluated separately before selecting a new
experimental local recipe. No arbitrary deep valley excavation is used to hide
this mismatch.

## Morphology alternatives

A fixed lowland-context Paris Basin reference supplements the deliberately
unmatched mountainous Apennines reference at the same broad footprint. The
baseline generated patch remains smoother than the lowland reference.
Two bounded alternatives added scale-aware spectral relief, with or without
limited drainage-guided incision. The incision candidate improves branching at
100 km² but worsens it at 25 and 400 km²; it is not adopted as a general default.
The multi-threshold result is recorded in
`reports/broad-relief-methods-2026-10-12.json`. Similar relief alone is not an
acceptance criterion, and old saved terrain is unchanged.

## Selected local detail recipe

Three methods were tried on the **same** accepted single-outlet neighborhood:
original residual, quarter-strength residual, and positive-residual attenuation
near a flow corridor that is recomputed at each stage. Quarter-strength wins
this bounded test and is now the explicit default recipe; the other methods
remain selectable for comparisons. The method name and version are part of the
immutable saved conditions.

Maximum / 95th-percentile routing-head correction drops from 35.30 / 23.71 m to
8.76 / 5.66 m. The flow-aware alternative yields 34.31 / 13.68 m. Selected detail
still changes 20,670 of 20,769 fine points relative to simple parent interpolation,
with cumulative RMS 3.01 m. Exact parent points, inlet identities and magnitudes,
and the adopted outlet remain unchanged. The selected atomic core is 7,912,954
bytes, within the unchanged 16 MiB limit.

This selection **does not certify physical rivers**. The parent already requires
up to 6.42 m of routing-head correction, and the selected fine surface still has
uphill ground edges along routed paths. A directed budget ledger and a downhill
water head are not the same thing as a downhill river bed. No deep excavation is
performed to hide this limitation. See `reports/fine-detail-selection-2026-10-12.json`.

## Reproduce the adopted global-to-local chain

The exact small L0 source used in the review is bundled at
`examples/progressive-layer/l0-source.json`. The expected L1 identity is:
`sha256:343bd23a29779d6fb1005b43014963f79491358c933ee6f5aa9a28e66127aca9`.

From the repository root:

```sh
node --max-old-space-size=256 scripts/experiments/build-global-water-handoff.mjs \
  examples/progressive-layer/l0-source.json \
  sha256:343bd23a29779d6fb1005b43014963f79491358c933ee6f5aa9a28e66127aca9 \
  /tmp/planet-global-review
```

Use a new output directory for changed recipes. The CLI refuses to overwrite
an existing different output. Local review CLI usage is documented in the
script and accepts this handoff as its upstream source; an adopted single-outlet
mode must be retained for this already accepted overlay.

```sh
node --max-old-space-size=256 scripts/experiments/review-fine-local-layer.mjs \
  /tmp/planet-global-review/handoff.json /tmp/planet-fine-review --adopted
node --max-old-space-size=256 scripts/experiments/review-fine-local-layer.mjs \
  /tmp/planet-global-review/handoff.json /tmp/planet-fine-review --adopted --reload
python scripts/experiments/render-fine-local-layer.py \
  /tmp/planet-fine-review/fine-local-layer.json /tmp/planet-fine-review/fine-local-layer.png
```

The first command selects the first declared positive-flow, non-reentrant,
single-outlet candidate domain in a fixed list. This is a hydraulic eligibility
choice, not a search for an attractive image. The second command forbids storage
writes and missing-record generation, then checks saved native-source replay.

## Independent fine-scale real-terrain reference

The frozen `scripts/experiments/fine-real-reference/` bundle compares the selected
55.297 × 76.351 m grid with a predetermined Maryland Piedmont window from official
USGS 3DEP. Its source has native resolution approximately 8.01 × 10.28 m;
coarse global elevation is not upsampled and presented as local ground truth.
Both surfaces cover the same physical extent and target sampling.

Under a separate identical all-open-boundary D8 diagnostic, maximum fill is
7.34 m for the real reference, 28.43 m for the original detail and 6.99 m for the
selected quarter-strength detail. Positive-fill fractions are 3.63%, 22.95% and
11.47%. This diagnostic does not include inherited inflows or the adopted outlet
and must not be conflated with the constrained pipeline measurements above.
The selected terrain remains substantially smoother than this reference:
median slope 0.75° versus 2.52°, P95 1.81° versus 6.88°. This is evidence of a
remaining morphology gap, not a realism certification or a matched landform class.
Source provenance, hashes, sampling checks, arrays and reproduction scripts are
included in that bundle.

## Integrated verification

On 2026-10-12 the final integrated implementation passed all 1,258 tests
(0 failures), the production build and `git diff --check`. Independent tests
also exercised overlay tampering, exact boundary inheritance and fresh-process
read-only replay. The experimental builders and core water-candidate APIs are
implemented; this does not automatically replace the globe renderer or certify
physical river geometry at every level.

## Follow-on: explicit next layer and physical feasibility gate

The bounded next-layer experiment is documented in `NEXT_LOCAL_LAYER.md`.
It cuts a fixed-order hydraulically eligible 1.991 × 1.985 km region from the
selected layer and adds one genuine 2× refinement using a new 27.5 m native
source. All 999 immediate-parent points remain exact. The resulting 73 × 53
point field has 27.6487 × 38.1757 m spacing. This is an implemented experimental
builder and reproducible candidate, **not a newly adopted world layer**.

Three additional residual alternatives were rejected because none improved
all routing-obstruction measures. The quarter-strength recipe is retained;
see `reports/fine-relief-alternatives-2026-10-13.json`. Further amplitude tuning
cannot repair the following fixed-endpoint contradiction.

An independent necessary-condition audit found eight imported source identities
in the selected layer below its sole fixed outlet ground, requiring a maximum
4.219521 m endpoint climb. In the next crop, 43 source identities at 41 distinct
nodes require up to 8.172312 m. These are topology-independent obstructions to
an everywhere nonascending **ground-bed** connection while the endpoint ground
heights stay fixed. They do not prove that hydraulic flow with backwater is
impossible: inlet water stages, hydraulic geometry and available energy are
not specified, so that stronger physical question remains undetermined.

Accounting, replay and endpoint identity checks may pass while the new
`monotoneGroundBedGate` fails. A passed endpoint necessary condition likewise
never certifies a river. The next candidate also worsens the independent
all-open terrain-pit screen. It therefore remains experimental, with
`physicalRiverCertified=false`; no parent heights, water quantities or default
world selection are silently changed. This is a parent-child contract issue,
not a reason to keep adding finer noise.

The corresponding independent endpoint evidence is in
`reports/selected-river-endpoint-audit-2026-10-13.json` and
`reports/next-river-endpoint-audit-2026-10-13.json`. The compact same-scale
USGS comparison is in `scripts/experiments/next-layer-reference/`.

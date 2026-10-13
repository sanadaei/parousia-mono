# Research-led relief experiments (not production)

These scripts are isolated comparisons. They do not change `generatePlanet`,
existing worlds, the browser bundle, settlements, water or physical sampling.
A successful experiment test is **not** landscape acceptance.

## Sources and implementation boundaries

- Gaillard et al., *Dendry*, 2019, https://www.mgaillard.fr/content/publications/pdfs/Gaillard19I3D.pdf
- Génevaux et al., *Terrain Generation Using Procedural Models Based on Hydrology*, 2013,
  https://perso.liris.cnrs.fr/eric.galin/Articles/2013-river-networks.pdf
- Tzathas et al., *Physically-based analytical erosion for fast terrain generation*, 2024,
  https://www-sop.inria.fr/reves/Basilic/2024/TGSC24/Analytical_Terrains_EG.pdf

The first comparison uses our bounded branching/distance-envelope model with
compact reconstruction. It is not Dendry's complete infinite-domain algorithm.
The second implements a steady-state comparison with fixed boundary heights,
coarse-to-fine iteration and nonnegative graph-increment correction. Its routing
surrogate differs from the paper's depression carving; it is not a reproduction.
No external implementation source has been copied. See LOCAL_LANDSCAPE_PLAN.md
for the broader research decisions, including settlement, road and LOD references.

## Reproduce (Node >=22, no dependencies)

From the repository root, the complete comparison can be regenerated with:

```sh
node --max-old-space-size=256 scripts/experiments/run-relief-comparison.mjs /tmp/relief-comparison
```

Individual steps:

```sh
node --max-old-space-size=256 --test --test-concurrency=1 scripts/experiments/relief-research.test.mjs
node --max-old-space-size=256 scripts/experiments/drainage-led-relief.mjs /tmp/relief-synthetic
node --max-old-space-size=256 --input-type=module -e "import {generatePlanet} from './src/core/planet-generation.mjs'; import {writeFileSync} from 'node:fs'; writeFileSync('/tmp/parent-planet.json',JSON.stringify(generatePlanet({settlementCount:0}).base.toSnapshot()));"
node --max-old-space-size=256 scripts/experiments/planet-parent-relief.mjs /tmp/parent-planet.json /tmp/relief-actual-parent
node --max-old-space-size=256 scripts/experiments/steady-stream-power.mjs /tmp/relief-actual-parent/field.json /tmp/relief-steady
```

`planet-parent-relief` produces real input provenance, old/proposed scalar fields,
SVG plan views and quantified boundary mismatch. It refuses to invent a parent
if the source has none. The SVG caption deliberately labels the experiment.
The old terrain is the actual original field, not the proposed one.

`correctDiscontinuities` is separately exported by `steady-stream-power.mjs`.
It retains its best measured objective and preserves fixed graph roots. Lower
objective alone does not mean that its ridges look natural, that a solution has
converged, or that it preserves an existing planetary river.

All work is sequential with a 256 MiB Node heap. CLI entry points check free
memory. Defer runs rather than raising resource limits if memory is insufficient.
Generated files belong outside the repo unless explicitly selected for a report.

## Actual findings and blockers

- A graph can be connected while its reconstructed bed is wrong: the first probe
  checked old branches only and let new branches float above earlier valleys.
  Both directions are now checked; finite sampling still is not a proof.
- Sequential overlapping channel carving cut neighboring beds. Reconstruction
  now blends back to one audited shared envelope near the graph.
- A real parent river is not sufficient to connect region edges. The observed
  8.192 km region changes an edge by 360 m if inserted directly. **Do not insert it.**
- Grid-local minima counts include undersampling of narrow valleys. They are
  diagnostics, not automatically generated lakes or proof of continuous sinks.
- The steady-state comparison preserves edge heights but does not preserve the
  internal original river. Visible grid-aligned artifacts remain and the bounded
  iteration has not converged. Do not describe it as an adopted erosion engine.
- Cache/query-order reproducibility within one canonical region is checked;
  independently generated neighboring catchments are not reconciled.

Next production gate: a shared parent/boundary constraint treatment preserving
receiving river geometry and adjacent region terrain, followed by actual scene
inspection. Neither experiment currently passes that gate.

## Constraint-compatible follow-up (still not adopted)

Run `node --max-old-space-size=256 scripts/experiments/run-constrained-comparison.mjs /tmp/constrained-comparison`.
This creates the same saved planet and surveys four explicitly selected existing
river neighborhoods sequentially. `constrained-valley-relief.mjs` fits bounded
profiles below the existing ground, reserves a boundary collar, and protects the
whole original river/bank corridor. It checks the unchanged bank connector too:
keeping a channel's name while leaving an uphill barrier is not connectivity.

The current measured results are 0, 4, 11 and 1 accepted dry valleys. The first
site remains unchanged; zero numerical errors there are vacuous and must not be
called successful generation. The other sites keep sampled boundaries and river
corridors unchanged, with no sampled uphill bed/connector steps. They still use
straight, terrain-agnostic hierarchical proposals and are not a complete
cross-region drainage or water solution. The four sites share one seed and are
not population-level coverage. See `reports/research-constrained-relief-2026-10-11.json`.
Ten focused checks pass, including a deliberately blocked bank connection.

This follow-up is our compact-curve/interval-fitting adaptation, not a faithful
implementation of Dendry, the 2013 river network paper, or a PDE terrain solver.
The production sampler, saved worlds, roads, buildings and viewer remain unchanged.

## Terrain-aware river routing (2026-10-11, unadopted)

`terrain-cost-routing.mjs` compares direct, bounded terrain-cost corridor, and
rounded corridor paths, fitting each against original unincised ground. The
selected valid path cannot have a worse sampled incision/length score than a
valid direct path. Search and validation spacings are separate (3000 m / 500 m).
This is an original experiment motivated by terrain-sensitive routing research,
not a reproduction of Galin's road algorithm or a meander simulation.

Run `node --max-old-space-size=256 scripts/experiments/run-terrain-route-comparison.mjs SNAPSHOT.json reports/research-terrain-routing-2026-10-11.json`.
Input profiles are mandatory; missing profiles fail rather than generating fixtures.
The report records input/source hashes and all candidate results.

Three actual profiles: rounded routes reduce sampled score in two; the third
keeps its direct route. Nevertheless map inspection shows the first improved
route follows the search corridor's outer limit for a long distance. This is a
constrained-search artifact, not evidence of a natural valley. No production
caller exists. Crossings, shared catchment boundaries, finer terrain extrema,
and credible morphology remain adoption gates. A lower cost alone is not success.

`river-route-topology.mjs` adds indexed minor-great-circle centerline intersection
checks to the route comparison. It accepts only shared, named junctions at fixed
endpoints and rejects collinear overlap/unregistered crossings, including across
the antimeridian. It explicitly does not certify overlapping banks or hydraulic
capacity. All nine real route variants in the three-profile comparison passed
this centerline-only gate; their morphology remains unaccepted.

A width-sensitivity audit now compares 20/40/80 km half-widths at the same
2.5 km lateral spacing, with at most 16,384 search cells per attempt. An edge-
hugging path is not accepted merely because a wider box makes its score lower.
On the three saved profiles, the first still touches the outer 80 km limit;
the second becomes interior at 40 km; the third still prefers its direct path.
This narrows the diagnosis: the first is not fixed by a modest corridor widening.
No production adoption follows, and source-catchment membership remains unchecked.

## Near-field incision baseline (not adopted)

`run-nearfield-incision-comparison.mjs SAVED_WORLD.json REPORT.json [GRID.json]`
reads an actual saved world with a river, a settlement candidate and a temperate
forest region. It samples three 3.2 km windows (97x97), and runs bounded implicit
n=1 incision on a virtual priority-flood drainage order. Existing river corridors
and patch boundaries have zero displacement; no water or sediment deposition is
invented. This is a limited adaptation, not FastScape or a reproduction of a paper.

Actual current-generator planet-1 inputs show 0.029 m and 0.307 m total relief in
two lowland windows. Shore attenuation and elevation activation suppress most
local detail there. Incision only lowers these by 0.0024 m and 0.0439 m maximum;
it cannot supply missing landform structure. The river window retains the broad
straight trench even after up to 0.825 m of additional incision. Diagnostic
images were inspected; none establishes a natural close view. No production
caller was added. See `reports/research-nearfield-incision-2026-10-11.json`.

## Exact regional triangle viewer (2026-10-11, research)

The existing globe renderer now has a regional inspection entry at
`/src/globe/relief.html`, linked from the globe page. Open a canonical
`minimal-world-triangular-terrain@1` JSON file. Heading, tilt, distance and
height exaggeration only change the view. The source world identity and
geometry stay fixed. The viewer uses WebGL when available and the existing
bounded CPU diagnostic renderer otherwise. Missing data remains empty;
no lake, sea or surrounding planet is invented.

To reproduce the synthetic regional input (NumPy/SciPy needed for the first
command only):

```
python scripts/experiments/make-relief-mesh.py NEW_MESH.json
node scripts/experiments/run-mesh-relief.mjs NEW_MESH.json NEW_OUTPUT_DIRECTORY
node src/ui/server.mjs 3000
```

Open `http://localhost:3000/src/globe/relief.html` and select
`NEW_OUTPUT_DIRECTORY/terrain.json`. `raster-preview.json` is the older lossy
comparison format, not the input to this regional triangle viewer. The existing
2D metric UI also accepts the canonical triangle snapshot for height/slope
inspection. The regional viewer's default sphere placement is only an explicit
reference frame, not inferred real-world georeferencing or insertion into an
existing game world.

The file limit is 16MiB. Preparation yields between 16 requested windows, with
at most 32MiB of new draw buffers. Replacing a scene keeps the old display until
new uploads succeed, cleans partially uploaded buffers on cancellation/error,
and supports renderer recovery and persisted page navigation. The actual page
logic has an instrumented DOM lifecycle test. This does NOT replace real
browser/WebGL acceptance, which remains unverified in this cloud environment.

For a reproducible production CPU framebuffer without a browser:

```
node scripts/experiments/render-triangular-scene.mjs NEW_OUTPUT_DIRECTORY/terrain.json fixtures/triangular-relief-view.json NEW_IMAGE.ppm NEW_REPORT.json
```

The fixture checks the source identity. Its placement is a synthetic geographic
binding test; it is not an actual watershed at that latitude and longitude.
# Material and resolution comparison

`python scripts/experiments/make-relief-mesh.py NEW_MESH.json --nodes-per-side 193`
creates a reproducible finer research mesh (37,249 nodes). Supported odd side
counts are 3–255; the default 129 and seed preserve the existing input exactly.
Mesh density is a generation input, never changed by the camera or viewer.

`node --max-old-space-size=256 scripts/experiments/run-mesh-materials.mjs NEW_MESH.json NEW_OUTPUT_DIRECTORY`
runs the same saved drainage envelope and forcing with uniform material, a
resistant upper layer, and a resistant intermediate band. Every run saves real
inputs, canonical surface JSON and measured output reports. The directory must
not exist. The skeleton requires a 20km mesh with the declared terminal node.

Material contacts are stated in initial material-height coordinates and move
with uplift. Erosion crossing a contact consumes part of the time step before
using the next layer's erodibility. This bounded, sharp-contact approximation
is independently implemented; it is NOT Terrainbento's smooth two-lithology
scheme. Reference: Barnhart et al. (2019), section 3.7.2,
https://doi.org/10.5194/gmd-12-1267-2019 . No external source code is copied.

These outputs remain unadopted experiments. More nodes alone do not establish
convergence or realistic cliffs. Reports separate raw uphill-edge counts from
their actual height difference and a stated 1e-8m diagnostic tolerance. This
tolerance is not a lake/overflow model. Hillslope transport, rockfall,
sedimentation and shared planetary boundaries still need work.


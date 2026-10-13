# L0 → L1 → L2

Updated 2026-10-12 following the user's naming instruction.

- **L0**: planetary sketch: continents, ocean, broad relief and climate.
- **L1 (new)**: broad-scale concretisation. Explicitly selects a finer sampling
  stage, stores terrain and drainage, and carries L0 climate evidence forward.
- **L2 (formerly L1)**: regional detail using the saved L1 parent.

These are responsibilities, not fixed kilometre sizes. 128×64, 256×128 and
512×256 are current sampling stages, not the universal definitions of layers.
The existing `L1_REGIONAL_DESIGN.md` path is retained for historical links;
its title and current terminology refer to L2. Old dated report filenames
remain historical records rather than silently rewritten claims.

## Implemented now

`createL1BroadRegion(parent, level)` builds the new L1 parent from a selected
saved-recipe resolution stage. Root world identity is retained; the layer gets
a separate stable ID and source-resolution reference. Climate normals are
projected from L0 with an explicit elevation lapse correction. Annual local
runoff intensity is inherited and reaccumulated on the L1 graph. It is not a
new atmospheric model. Province labels are rough elevation/relief classes.

`build-l1-broad-region.mjs` saves and reloads the parent atomically. Changed
conditions require migration, never overwrite an existing record. The measured
512×256 parent is 17,008,235 bytes, so this dedicated L1 store has a 24 MiB cap;
the ordinary local-world store and its 16 MiB export archive are unchanged.

The regional candidate generator now accepts this L1 parent. L2 outputs record
`sourceLayerId`, and saved L2 conditions include that ID. A same-location
11.52×8.64 km L2 trial has been generated from the saved 512×256 L1 fields.

## Not yet complete

- Successive sampling stages still recompute drainage; they do not preserve all
  previous catchment topology or exact receiving-water constraints.
- L1 retains a grid water graph, not resolved valley cross-sections or surveyed
  channel geometry.
- The original regional generator still uses unresolved outside receivers. The
  new explicit water-connected generator enforces parent corridors and imports
  annual upstream water; see the bounded implementation below.
- Newly refined coastline cells can disagree with their coarse parent's
  land/water classification. Their climate evidence remains explicitly coarse;
  old ocean/lake biome labels are not reclassified as established land ecology.
- The old L2 trial's outside receivers remain unresolved. Its local drainage
  budget passing does not certify interregional hydraulic continuity.

## Reproduce

```sh
node scripts/experiments/plan-macro-water.mjs L0.json SERIES.json 3
node scripts/build-l0-resolution-review.mjs SERIES.json REVIEW.html
node scripts/experiments/build-l1-broad-region.mjs L0.json SERIES.json L1.json L1_SAVE 2
node scripts/experiments/place-regional-candidate.mjs L1.json L2.json L2_SAVE
```

The last CLI chooses a suitable inland review location. For a controlled
same-location comparison, call `savePlacedRegion` with the previous geographic
settings and a new L2 entity ID/store; do not regenerate an already committed
old location in place.

## Water-connected L2 trial (2026-10-12)

`createL1WaterNetwork` derives basin receivers, upstream area, stream order,
annual potential flow and explicit river corridors from the saved L1. It does
not regenerate L1 terrain. Uphill ground edges are marked unresolved; an L2
trial encountering one refuses adoption rather than excavating an arbitrary
through-mountain tunnel.

`connectL2Water` clips those corridors to the requested window. The parent
owns crossing coordinates and topology. A centre-to-centre straight line is
an uncertain broad corridor, not an already surveyed channel bed. On first
materialisation the trial chooses lower bed anchors inside the parent
upstream/downstream elevation envelope. Supplied committed bed anchors stay
fixed. A low-cost interior path seeks lower terrain; valley construction and
tributary conditioning then produce downhill ground. Bounds reject excessive
earthwork, incompatible anchors, conflicting branches, multiple unresolved parent catchments, or a river that leaves
and re-enters the window. The latter needs a larger joint domain, not a second
copy of imported upstream flow.

Annual local rainfall-derived yield is debited from a coarse imported total
where already owned by its upstream parent catchment, then added once as local
supply. A display/review flow threshold does not remove smaller incoming
parent branches. The local routing ledger closes. This is not proof of a
fully reconciled global subcell runoff ledger or seasonal hydraulics.

The main channel receiver edges are enforced and validated as adjacent,
downhill and acyclic. Recomputed temperature and cover use the final valley
terrain, rather than stale pre-valley heights. A saved materialisation reopens
identically, and changed conditions require migration.

```sh
node scripts/experiments/review-l1-l2-water.mjs L1.json L2_WATER.json WATER_SAVE L1_NETWORK.json
```

The default review chooses the nearest inland downhill 20–2000 m³/s coarse
reach to the earlier review location, with the same seed. It is not a seed
search. Its terrain amplitude is explicitly 0.5; an earlier amplitude-1 trial
exceeded the 150 m construction bound. An initial linear-bed trial produced
108 m of fictitious routing fill and was rejected. Neither failed approach is
presented as a natural lake system.

### Remaining adoption limits

- L1 still has grid-direction bias. Named basins do not remove it.
- Bed anchors are valid within a coarse envelope, not hydrologically calibrated.
- The 11.46 × 8.58 km sample needed up to 147.6 m of lowering from its proposed
  terrain. This is a substantial modelling limitation, not a cosmetic success.
- Independently generated neighbouring ground, shared refined flow revisions,
  lakes and coastline adaptations are not complete. The API accepting an
  existing bed anchor does not by itself certify a complete neighbouring world.
- The water-connected route is an explicit generation/review CLI. It has not
  replaced every legacy globe generation path or passed browser interaction QA.
- Offline plots show actual generated arrays; they are not browser screenshots.


## Controlled scale-gap comparison (2026-10-12)

The current L1 north-south sample spacing is approximately 78 km, while the
local L2 trial samples at 60 m. The local window's roughly 11 km width is an
extent, not sample spacing. These quantities must not be compared as though
they were the same.

`scripts/experiments/compare-layer-scale-gap.mjs` isolates sampling effects:
- Generate one 127 km square terrain proposal, sampled at 1 km, and freeze it.
- Run the same regional drainage solver at progressively finer resolutions.
- Trace the same geographical source, reporting its grid snapping uncertainty.
- Keep physical area and annual local water supply invariant.
- Do not freeze coarse guessed river vertices as exact finer-level ports.

The plotted actual spacings range from 63.5 km to about 608 m (requested
spacings are rounded to cover the same extent). Finer traces reveal bends and
confluences. Below the source's 1 km spacing, queries only interpolate; this
does not generate new small-scale relief. Eight-neighbour direction bias
remains. All outer survey exits are explicitly unresolved, not world mouths.

A regression test confirms that going directly to the finest resolution gives
the same final heights, drainage and trace as running all intermediate stages.
Therefore this experiment supports resolving terrain before fixing local river
ports; it does NOT prove that adding execution stages alone improves quality.
A real hierarchy must additionally carry parent catchment, inflow/outflow and
neighbour boundary constraints, while leaving unresolved channel positions
as corridors until sufficient detail is available. That integration remains
unfinished; this diagnostic does not replace the production generator.

Reproduce with:
```sh
node --max-old-space-size=256 scripts/experiments/compare-layer-scale-gap.mjs L1.json comparison.json
python scripts/experiments/render-layer-scale-gap.py comparison.json comparison.png
```

See `reports/layer-scale-gap-2026-10-12.json`. Verification: 1,202 tests passed,
zero failed/skipped; build passed. The image is an offline rendering of actual
computed data, not browser QA or a real-Earth terrain comparison.


## Intermediate water inheritance prototype (2026-10-12)

The core now exports `createRegionalWaterContext`, `regionalWaterWindow`,
`saveRegionalWaterWindow`, `refineRegionalWater` and
`saveRegionalWaterRefinement`. These are explicit opt-in APIs; the default
planet/globe generator has not been switched to this experimental pipeline.

A shared intermediate context owns heights and the complete upstream water
graph. Arbitrary metric viewing windows inherit that graph without rerouting on
each rectangle. Shared edge-interior crossings have stable IDs, positions,
annual flow and opposite directions. Graph vertices exactly on boundaries retain
shared node IDs; tangential lines are not counted as crossing that boundary.
Samples finer than the source are clearly marked as interpolation. Existing
atomic persistent storage prevents a changed parent or setting from silently
regenerating an adopted window.

The second prototype actually recomputes fine drainage at a 2x-4x refinement
ratio, preserving parent sample elevations, declared receiving destinations and
annual outlet budgets. Optional fine terrain must retain parent anchors. Without
it the surface is only interpolated. Work is bounded to 65,536 fine samples per
joint context, with sequential catchment solves. Adjacent views of the resulting
context share the same fine physical decision, not independently generated maps.

### Validation and a rejected assumption

The actual 106x106 context (about 1.21 km spacing) became 211x211 (about 605 m).
All 420 outer receiving budgets were preserved; the two 20 km review windows
matched at all 31 refined water crossings. Disk reload produced identical data.
Those outer exits are still unresolved survey exits, not certified global mouths.

However, the first conservative refinement assigns fine catchment membership
from nearest parent samples. This copies block-like divides. Testing NOAA
ETOPO2022 Tuscany heights exposed an important failure: maximum artificial
routing fill rose from 27.66 m in the original coarse solve to 68.00 m under
this inherited-mask refinement. A control using exactly the same fine heights
and receiving outlets without the mask required 34.22 m. Generated terrain
required 6.42 m with masks versus 5.47 m without. Routing fill is not written as
ground and must not be presented as a real lake or successful physical valley.

Thus the shared-context/window/persistence mechanism is reusable, but the
nearest-parent catchment masking is NOT accepted as the final watershed model.
Finer divide placement must follow fine terrain while respecting destination
constraints, and any changed outer-flow budgets need reconciliation before
neighbour adoption. This is not solved merely by adding execution stages.

The real-DEM comparison uses actual heights; all blue drainage is calculated by
our code, not observed river centre-lines. Generated and real panels have
different extents and are not a quantitative naturalness comparison.

Reproduction:
```sh
node --max-old-space-size=256 scripts/experiments/review-inherited-water-windows.mjs comparison.json windows.json WINDOW_STORE
node --max-old-space-size=256 scripts/experiments/review-refined-water.mjs windows.json refined.json REFINEMENT_STORE REAL_DEM.json
python scripts/experiments/render-inherited-water-windows.py windows.json windows.png
python scripts/experiments/render-refined-water.py refined.json refined.png
```

See `reports/inherited-water-refinement-2026-10-12.json`. All 1,215 tests and
build verification passed. These numerical checks do not certify naturalness.
All review images are offline data plots; browser QA remains unperformed.

## Progressive refinement follow-on

The later multi-method selection, genuine fine-DEM benchmark, explicit
provisional boundary refinement, imported-supply ownership, transactional outlet
budgets, and anchored generated-detail chain are described in
[PROGRESSIVE_LAYER_REFINEMENT.md](PROGRESSIVE_LAYER_REFINEMENT.md).
The older nearest-parent-mask results above remain historical experiments, not
the selected final watershed rule. New shared-context builders do not silently
replace existing saved worlds or certify the legacy globe display path.

# Explicit C1 river beds for finite regions and global charts

The existing planar/explicit-chart river model can now opt into
`bed: { method: PLANAR_C1_BED, maxIncisionM: 5 }` when calling
`connectSurfaceWater`, `connectGlobalSurfaceWater`, or each chart supplied to
`connectInterChartRivers`. `PLANAR_C1_BED` is exported by the Core and surface-water
entry points. The literal method is `compact-c1-incision@1`.

## One authoritative sampling path

The validated/resolved river graph, water profiles, fitted widths and body anchors
remain the inputs. The new field uses compact radial capsules with cubic endpoint
interpolation. Smooth positive incision and an absolute-width smooth union join
capsules; a smooth ceiling enforces the explicitly supplied excavation limit.
No second display-only bed is created. Core sampling, snapshot restoration,
projected chart sampling and PagedSource feature sampling use this same function.
Globe packaging includes its complete support bounds and excavation allowance.
The generated `globeDemo()` uses it; immutable historical packages are not replaced.

For a C1 base, excavation remains C1 across the centre, inner bank, outer support,
profile vertices and capsule caps. It does not repair a discontinuous base. It
never fills ground. Overlap smoothing can deepen a channel by millimetres before
the final cap; it is not a hydraulic equilibrium calculation. The cap can prevent
a low water profile from excavating a wet channel; dry results remain dry.

Regional-boundary endpoints continue their constant endpoint section through the
cut. Multi-chart seams require equal bed methods and caps, matching profiles,
flow directions, declared openings and the existing cross-section checks.
Conservative circular support contacts cannot silently authorize a new opening.

## Compatibility and scope

The policy is explicit and serialized; it changes world identity. Omitting it
retains the old strip/bank model and historical sample values. Adding it to a copy
of a saved definition is a new world, not a transparent restoration of the old
world. There is no automatic migration of all saved worlds.

The existing global chart `maxCenterIncisionM` check still bounds the old linear
profile target before acceptance. The new bed's `maxIncisionM` independently bounds
actual excavation everywhere and must not exceed that chart limit. These are
not interchangeable diagnostics.

C1 here describes ground geometry, not flowing water: water selection at overlaps
is a static highest-level rule, and is not guaranteed to have a C1 water surface.
Lake/sea levels are explicit inputs. Rainfall, changing levels, velocity, sediment,
erosion and hydraulic calibration are not inferred by this feature.

## Verification

`test/planar-c1-bed.test.mjs` exercises real public construction/restoration,
one-sided finite differences, overlapping junction caps, sloping base support,
explicit lake/ocean anchors, perpendicular/oblique chart seams, policy mismatch
rejection, and real globe-demo packaging/PagedSource parity. Full-suite results
and input/output evidence are recorded separately after running them.

The building/road feature layer deliberately omits its legacy unconditional linear
river ribbon for C1 recipes. Wetness and nonlinear water profile rendering come
from the canonical sampler's terrain overlays. A separate straight ribbon could
otherwise paint water above a dry, capped channel and disagree with the model.

A separately generated package is saved at `examples/globe/c1/demo/manifest.json`.
Its 512 field pages and feature page have been verified against manifest size and
SHA-256. `npm run globe:package` now defaults to that new directory instead of
silently overwriting the historical 0.4.0 demo. After starting the local server,
open `/src/globe/index.html?world=/examples/globe/c1/demo/manifest.json`.

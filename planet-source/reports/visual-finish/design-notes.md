# Bounded shape-first visual finish

## Diagnosis and scope

The prior globe applied a global 0–7000 m elevation ramp to a native region with only a few hundred metres of relief. The QA seed spans 45.6081–268.45141 m before spherical placement. Noon light and a far, near-map view left its real hills and valleys nearly uniform green.

The new display uses the same canonical ground and water meshes. It does not change elevation, channel dimensions, supply, receiver connection, physical bounds, saved source identity, or height exaggeration (1×).

## Changes

- `terrain-appearance.mjs`: restrained local elevation tones (green, olive, dry earth), with a measured-grade mineral tone on steep banks. No noise texture, inferred snow line, generated vegetation, or climate claim. The collar fades continuously back into the saved planet's original elevation palette.
- `mesh.mjs`: applies those RGB values to the existing vertices in both GPU and software paths. A calmer slate-teal water tone replaces the saturated diagnostic blue in shape-first worlds. Optional river-guide symbols use a quieter blue while remaining lighter than physical water; their 48 m drawing width, toggle behavior and disclosure are unchanged.
- `app.mjs`: shape-first views retain the cleaner tested 45° obliquity and noon light, with extent-scaled regional framing. Existing saved solar state and restored navigation views take precedence; explicit URL altitude still wins. The regional return button uses the same framing helper.

## Verification

Five new appearance tests establish geographic-height-offset invariance, nonmutation of source samples, collar continuity, measured-grade bank color, and bounded extent-based framing. The focused appearance/software-renderer/shape-first-provider/runtime run passes all 42 tests. Actual cloud-browser before/after images are collected separately under `reports/shape-first-end-to-end-qa/`; they are CPU diagnostic images, not WebGL acceptance.

## Limits

Color and lighting improve topographic readability; they do not turn the existing shallow regional geometry into mountainous relief. Distant water may be thinner than the bounded CPU framebuffer's pixels. Inherited dark bank flecks are still present; no image-space concealment, fabricated water width, or new mesh topology is introduced. WebGL2 and GPU performance remain unverified in this cloud browser.

## Candidate comparison and decision

Actual CPU browser views (same seed 314159, 1× height):

- Baseline: `../shape-first-end-to-end-qa/visual-before-314159-10000m.png` (10 km, 45°, noon). Almost uniform green, little readable relief.
- Selected rendering: `../shape-first-end-to-end-qa/visual-after-314159-10000m-matched.png` (same framing/light, new palette). Broad ridge and valley contours become readable without changing geometry.
- Discarded default: `../shape-first-end-to-end-qa/visual-after-314159-10000m-oblique.png` (55°, 09:30). Harsher lighting exposes large triangular tonal facets in the foreground.
- Manual alternative, not selected default: `../shape-first-end-to-end-qa/visual-after-314159-5000m-oblique.png` (5 km, 55°, 09:30). Closer valley read, but darker and less regional context; no clear improvement over the cleaner noon overview.

The runtime defaults retain noon and 45° after this comparison. No saved source is replaced or silently changed to seed 314159.

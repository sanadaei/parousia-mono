# Terrain-aware village streets

Generator revision: `planet-generator@14`. The generation result is saved in the
same planet snapshot; the viewer does not invent roads or buildings.

## Inputs and construction

`generatePlanet` accepts `villageRoads: true` (default), or `false` for the prior
single-street layout. The CLI equivalent is `--single-street`.
`extendVillageRoads` is also exported from Core and the package subpath.

- Start from the existing 480m main road and any saved bridge.
- Try perpendicular, 120m side streets at 20%, 50%, and 80% of the main road,
  on either side. Keep at most two, ordered by sampled grade cost and stable ID.
- Reject wet or unknown-water carriageways (centre and two edges every 2m),
  excessive longitudinal grade, or incompatible junction geometry.
- Reuse `designRoadJunctions` for the actual common-height carriageway plateau
  and cubic approach profiles. The accepted maximum grade is 12%.
- Do not change an existing bridge deck to make a junction fit. Such a branch
  is rejected, with the reason in `streetGeneration`.
- Add up to eight candidate house lots along each accepted side street. Existing
  water, terrain, overlap and foundation checks remain in effect. Additional
  clearance checks keep house batters off side-street carriageways.
- Drainage passage planning uses the complete accepted road and pad collection.

The canonical geometry is `roadCenterlineProfiles`. `roadJunctions` and
`streetGeneration` record the generation result and rejection reasons; they do
not provide a second terrain surface. All road drawing, terrain adjustments and
vehicle checks continue to use the saved profiles.

## Defects found by connecting existing pieces

1. Rotated T-junction endpoints differed from the main line by floating-point
   roundoff and were sometimes lost when designing the next junction. Endpoint
   comparison now admits only a coordinate-scaled 32-ulp tolerance.
2. Almost identical stations could produce identical positions and zero-length
   segments. The junction planner merges roundoff-level station duplicates.
3. A junction approach could reshape a remote bridge span. The planner now
   rejects any approach that changes the original bridge cubic on an overlap.

These are covered by rotated, repeated-junction and real generated-world restore
regressions. The five-world integration checks sample across road widths and
compare the canonical profile with the paged reader, rather than checking only
junction centre points.

## Limits

This is a bounded local street generator, not a population simulator, a city
layout system or an inter-settlement road network. Houses still use axis-aligned
rectangular foundations. Wet-route and terrain checks are finite probes, not a
proof against every sub-metre feature. Side streets are straight, not optimized
curved alignments. Existing physics, display and device acceptance gates remain
separate; adding more streets is not a declaration that the entire roadmap is
complete.

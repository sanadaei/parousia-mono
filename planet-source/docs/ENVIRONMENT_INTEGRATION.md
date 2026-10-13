# Environment integration, 2026-10-11

## Acceptance target

Preserve the existing height source. A landscape becomes legible through connected
water, vegetation and human land use, not another iteration of erosion research.
The source controls both overview colours and local objects; camera movement must
not change IDs, channels, vegetation or roads. Work proceeds without waiting for
intermediate human approval. Existing saved worlds are not silently regenerated.

## Implemented in this working change

- Monthly precipitation and temperature feed a bounded soil-water bucket and the
  existing receiver graph. Actual cell areas weight water volumes. Closed basins
  remain closed. Annual available supply, soil wetness and supply-month counts
  are saved with inputs identified by content hash. Monthly freezing conditions
  retain snowfall and positive temperatures release it with an explicit bounded
  temperature-index melt scenario; this is not an energy-balance snow model.
- Climate-enabled planet generation sizes/selects representative river profiles
  using climate yield normalized by a stated reference runoff and cell area.
  Source drainage-cell counts remain separately available in the terrain.
- One potential-cover classifier distinguishes forest, woodland, grassland,
  scrub, dry bare land, exposed rock, tundra, snow/ice, riparian woodland, wetland,
  and water. Local slope and height above a nearby existing river matter.
- The regional landscape sampler and streamed tree placement consume those
  classifications. Saved worlds without the new policy retain their old recipe.
- Coarse and local road corridors accept the same environment's traversal resistance;
  expensive cover changes routing without moving settlement roots. Local searches
  sample cover along edges and do not shortcut straight through expensive cover.
  This does not
  certify a local bridge or a traversable path through every detailed obstacle.
- Globe layers expose potential environment, soil wetness and routed supply.
  Old climate files report missing data instead of fabricating a new result.

## Evidence and outstanding acceptance

The six-scenario preview uses the previously reviewed, unchanged 20 km triangular
terrain. It executes production water-budget and cover code. Its blue polylines
are potential supply routes, not final water meshes. The illustration is an
analysis render, not a browser screenshot. The triangle terrain is not thereby
installed as a globally continuous planet source.

Focused tests cover water accounting, dry downstream areas supplied from wet
upstream areas, arid/seasonal climates, terminal basins, data persistence,
environmental maps, river proximity versus high cliffs, and road-cost rerouting.
The whole-suite result must be recorded after final changes; focused results do
not substitute for that result.

## Remaining work for the requested integrated landscape

1. Actual overview/near-field scene acceptance including visible water surfaces,
   banks, forest/open-land boundaries, settlement land use and roads together.
2. Reservoir loss/storage, groundwater delay and snow energy balance before
   treating supply as real river discharge. Simple snow storage/melt is present.
   Evaporation is a temperature proxy and soil capacity is prescribed, not surveyed.
3. Lake/coastal environment differentiation. Do not manufacture sand beaches,
   mangroves or salinity from an arbitrary colour or temperature alone.
4. Local road alternatives and crossings must continue to use surveyed terrain
   and existing water geometry; the broad resistance layer cannot replace that.
5. Multi-scale and regional-boundary checks. Ground geometry and object locations
   must remain invariant under camera motion and LOD. Memory remains bounded.

## Breadth of references

- HydroATLAS: connected basin/river/lake attributes, including climate, land cover,
  soils and human influence. https://www.hydrosheds.org/hydroatlas
  Linke et al. 2019: https://doi.org/10.1038/s41597-019-0300-6
- ESA WorldCover: distinguish land-cover classes from regional biomes; tree cover,
  shrubland, grassland, cropland, built-up, bare land, snow/ice, water, wetland,
  mangroves, moss/lichen. https://esa-worldcover.org/en/about/about
- InVEST annual/seasonal water yield: water availability and seasonality are
  different questions; annual totals cannot establish dry-season flow.
  https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/annual_water_yield.html
  https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/seasonal_water_yield.html

These inform the separation of data and acceptance cases. The new game rules
are not implementations or validated reproductions of these scientific models.
Modern land-cover/road patterns are references for structure, not literal medieval
settlement templates. No global multi-gigabyte dataset was downloaded.

- Snow-method background: USGS temperature-index snow module documentation.
  https://pubs.usgs.gov/sir/2006/5318/data/snowpck_dpm.htm

## Near-field correction

An actual CPU-rendered settlement exposed trees intersecting saved house/street
footprints. Streamed vegetation now also uses compact footprints from nearby
saved feature recipes, independently of camera cache history. The same clearance
is used by the diagnostic scene. Channel-bank display remains under inspection;
the report does not claim that the preview is visually complete.

## Follow-on integration (verification pending until recorded)

Local tributaries now require positive potential supply from the existing climate
water budget. A single interpolated regional yield is declared per bounded survey;
contributing area determines potential flow. A wet main river does not make the
surrounding dry land produce streams. This still omits local rain shadows,
groundwater-fed springs and within-survey rainfall variation.

New climate-enabled generation also tries the existing terrain-cost corridor
implementation before local tributaries and settlement placement. It retains fixed
graph endpoints, rejects search-edge contact, disallows leaving the original coarse
cell corridor, checks other river centerlines, refits monotone water profiles and
honors the total point budget. Failed alternatives retain the original with an
explicit reason. It is not a meander/sediment model or proof of bank clearance.
The original research entry points now re-export the shared implementation.

Prior checkpoint c5b31fd: frozen 21-path source verified with 1003 passing tests,
0 failures/skips, and build success (124 core / 30 shared entries / 50 globe).
Remote head verified, exact-head check-runs empty. Later edits require their own
whole-suite result; the prior result does not certify them.

## River size and readable navigation

The next integrated generation reserves part of the existing river point budget
for two fixed survey scales: approximately 64 km regions for medium tributaries,
then 8 km receiving-water neighborhoods for small streams. The second tier samples
the first tier's saved physical water. Parent selection is geographically spread
and immutable; camera motion cannot choose new channels. Larger surveys use a
32 m profile step and an explicit 10 m incision limit; local surveys retain the
4 m / 2 m limits. This is partial bounded coverage, not complete global detail.

Low-gradient broad channels may use a width-scaled curving planform when terrain,
fixed endpoints, monotone water profiles and network-centerline checks permit it.
Steep, narrow or confined cases keep their previous route. The empirical width /
wavelength relation is informed by Leopold & Wolman (1957), USGS PP282-B:
https://pubs.usgs.gov/publication/pp282B
The scenario assumes cohesive banks; it does not simulate sediment, braiding,
cutoffs, channel migration or flood flows. Do not call it a reproduction of the
paper's process theory. Fitter budgets withhold candidates rather than throwing.

Navigation now labels main rivers, medium tributaries and small streams separately.
Its initial camera distance scales with actual stored river width, so selecting a
broad river does not place the whole screen inside its water. The generation cache
key is versioned; requesting a new seed generation does not silently return the
old implementation's saved result. Existing saved worlds remain unchanged.

Checkpoint 341ef25: 1007 tests passed with 0 failures/skips, 262.4 s; build passed.
Later planform, nesting and navigation changes are not certified by that count.

## Initial-view correction

A scene audit was accidentally centering the old small construction fixtures,
which have houses and street tests but no full economic/facility context. The
population-catalogue village is a different existing runtime path: its actual
recipe includes household plots, fields, communal facilities, paths and ponds.
New packages now choose an existing catalogue village as their initial focus,
with a bounded search and no relocation or new population. Legacy construction
fixtures remain separately inspectable. Vegetation diagnostics now use the
production geographic landscape descriptors instead of an arbitrary 3x3 tree
window. This corrects the diagnostic's artificial square tree boundary; it is
not a new forest-growth model.

Actual CPU scene: source world
`sha256:2198794e7ae51885d172d11d217095b977b5db516fb1e5b8d5a5e81f693510b5`,
site `pop:795:14`, recipe
`ce12a446449131fa155915254d01a5dcd931254e44dd917a3cb2a6c3748a7dc3`.
At 750 m camera altitude / LOD16, it drew 45,277 triangles and 14,049 trees from
96 bounded vegetation descriptors. These numbers are not whole-world coverage.
This snapshot predates the final generator revision-label update; saved geometry
is used as-is rather than silently regenerated. Browser/WebGL remains unverified:
the cloud browser cannot reach the executor's local server; local Chromium fails
its required socket operation. No security restrictions were bypassed.

Checkpoint 38bbc334: 1013 PASS / 0 FAIL / 0 SKIP, 290.2 s; build passed. All 14
publication blob hashes verified in the remote tree. Exact-head check-runs empty.
The actual bounded nested example contains 49 main reaches, 30 regional-survey
tributaries and 33 local-survey streams, at 32,765 profile points. However its
regional-survey streams are still mostly narrow (largest approximately 2.4 m
wide); the survey scale alone is NOT proof of a convincing medium-river network.

# Earth-reference landscape comparison

Date: 2026-10-12. Runtime baseline: `3bf9f959636c42979c8724337e0d42106bef50c8`.

## What was actually compared

- User-supplied Google Earth image IMG_6350: a tropical landscape around Boundji / Mokana. A square crop is approximately 20 km across, estimated from the screenshot's 10 km scale bar. The screenshot orientation is retained; it is not a georectified map.
- Production terrain, installed water and land-cover classifier: 20 km square centered at latitude 9.120589799055045, longitude 170.8704167956355, sampled on a 129 by 129 grid (156.25 m spacing). This is a diagnostic map, not a browser screenshot. Fine streams were additionally highlighted as centerlines; their drawn thickness is not a measurement. Detailed field parcels, houses, and roads are not shown by this diagnostic.
- GSI seamless aerial photography: a 20 km square centered near Numata, Japan (36.649159, 139.078805), assembled from 132 official zoom-14 tiles. This is modern land use in a different climate. Rectangular photographic color changes are acquisition mosaics, not landscape boundaries.

Cloud Google Earth was opened but reported WebGL unsupported. No successful live Google Earth inspection or browser rendering acceptance is claimed. The reviewed comparison was delivered privately to the user; their original screenshots are not redistributed in this repository.

## Observations and limits

The production sample is dominated by a single forest color, with a main river and small agricultural clearings. Its 16,641 samples comprise 15,162 internal woodland, 865 water, 294 wet meadow, 213 arable, 80 pasture and 27 settlement samples. The internal woodland category includes dense forest and riparian forest; it does not mean every cell is sparse woodland. Seven neighboring settlement records were available to the classifier; only those falling inside the square are plotted.

The supplied tropical image shows larger connected dark and light landscape patches. Their exact ecological identities cannot be inferred from color alone. In particular, dark branching patches must not all be labeled open water. The Numata reference shows the relationship of wooded slopes, valley floors, farming and settlement, but its modern infrastructure and population density are not medieval targets.

A 91% forest sample is not itself a defect. Equally, photographed fine texture is not evidence that equivalent semantic features are missing. The useful comparison is the shape, scale and connectedness of environmental and land-use regions, together with why they occur there.

## Source-level gaps confirmed

1. `environment-cover.mjs` limits the riparian influence to 180 m and relative height to 8 m. `paged-source.mjs` searches only 200 m for that environmental query. This cannot represent a broad river-associated environment outside that band.
2. `regional-landscape.mjs` uses fixed 1,800 m and 220 m noise fields alongside regional climate. They can vary patches but do not themselves establish drainage-connected soil or wetness regions.
3. Farming hinterlands are primarily radial distance envelopes derived from food demand, with slope exclusions and a 450 m mixed-use noise field. This is not an integrated valley/route/parcel allocation model.
4. The comparison does not establish road absence: roads were deliberately not sampled. A separate road overlay is required before judging their connectivity.
5. Individual trees and more detailed textures cannot alone address those distribution rules.

## A useful negative check

Reusing the existing bounded drainage analysis on this 20 km diagnostic produced 485 dry cells with complete interior drainage to sampled water, 6,238 boundary-uncertain cells, 2,468 depression-uncertain cells, 6,585 draining outside the survey and 865 water cells. These are diagnostic classifications, not a world update. This cropped survey does not justify declaring all low ground wetland. Environmental materialization needs upstream/neighbor context or explicitly labeled approximate potential; it must not invent certainty to improve the picture.

## Research informing the next implementation

- Nobre et al. (2011), *Height Above the Nearest Drainage*: https://doi.org/10.1016/j.jhydrol.2011.03.051 . Use the distinction between drainage-connected relative height and simple horizontal proximity. The current nearest-river query is not a HAND implementation.
- Onrust et al. (2017), *Ecologically Sound Procedural Generation of Natural Environments*: https://doi.org/10.1155/2017/7057141 . Separate landscape/ecological distributions from individual plant placement and rendering; coverage and patch structure are useful inputs. The present system has not reproduced or validated that paper's ecosystem model.
- Emilien et al. (2012), *Procedural Generation of Villages on Arbitrary Terrains*: https://perso.liris.cnrs.fr/apeytavi/website/publication/hal-00694525/ . Terrain-sensitive settlement/road growth and parcel organization are relevant to replacing isolated regular layouts. This citation is guidance, not a claim that the paper is implemented.
- GSI imagery catalogue: https://maps.gsi.go.jp/development/ichiran.html ; use guidance: https://maps.gsi.go.jp/help/use.html . Aerial image source credit: Geospatial Information Authority of Japan, processed.

## Next visible acceptance target

Keep the same saved terrain, water and settlements for before/after comparisons. Add a bounded environmental-region representation that explains wet lowlands, valley sides, uplands and agricultural access before scattering individual objects. Unknown drainage stays unknown; potential cover is labeled as a scenario. Do not silently change previously committed worlds when adopting a new policy. Show 20 km regional and village-scale views together, with optional water, land cover, settlement and road layers. Check at least contrasting wet, dry and high-relief environments rather than tuning one tropical screenshot.

Completion of persistence tests is not completion of landscape plausibility. The next acceptance is a visibly coherent distribution and its actual use by the runtime, not an increased test count alone.

## Repeatable production sampling

Run `node --max-old-space-size=256 scripts/sample-landscape-comparison.mjs manifest.json save-directory output.json latitude longitude [width-metres] [grid-size]` with the same manifest, saved-world directory, center and extent before and after changes. Defaults are 20 km and 129 samples per side; limits are 64 km and 255 samples per side. The command may materialize previously unreferenced water/settlement regions in the explicitly supplied save directory, so use the intended world save or a copied comparison save. It never rewrites the world manifest and refuses an existing output path. It reports incomplete regional context instead of silently treating missing settlements as empty land. Output contains actual production categories, surface elevation, water depth, slope, classification reasons, neighboring settlement IDs and explicit omissions. Individual roads and houses require a separate view.

## First implementation resulting from this comparison

A second 20 km sample in the same planet's temperate region (19.6875, 154.6875) exposed a conspicuously angular confluence. This is present in the physical water data, not just a shader. The saved network records show two upstream reaches retained as direct great-circle paths after `confining-terrain`, while the downstream reach uses the previous width-scaled planform. That previous method also suppresses lateral displacement over two wavelengths near each fixed endpoint.

The new `local-taper@2` option in `river-planform.mjs` limits lateral displacement around locally obstructed samples instead of rejecting the entire proposal at the first obstruction. A conservative forward/backward envelope smoothly tapers that displacement; the resulting positions are sampled again. Work is bounded to eight taper passes and the existing point budget. Endpoint transitions use three channel widths. Those choices are explicit procedural scenario parameters, not a calibrated geomorphological law. Existing downhill-profile fitting, incision limits, graph crossing checks and source-cell corridor checks still decide acceptance.

New climate-planned generation selects this option. Existing serialized worlds and materialized local records are not recomputed. Direct callers retain the old option unless explicitly opting in. The empirical width/wavelength relation remains an approximation; sediment, cutoffs, braided channels and confluence relocation are not simulated.

On the actual sampled confluence, the new candidate for `river:730:795` was accepted and all 2,003 fitted centerline points were wet under the production water sampler. The proposal for `river:858:795` remained rejected as `infeasible-monotone-path`; it was not forced into the world to improve its appearance. The before/after diagnostic still shows an angular junction and another straight branch. This is a bounded improvement, not a claim of completed river naturalness.

## Connect existing valley geometry to environment and land use

The next policy, `valley-water-cover@2`, reads the floor width already stored by the alluvial river cross-section model. It extends environmental influence over that floor, then applies the existing relative-height and slope conditions. It does not infer open water from green pixels or add water surfaces. For new-policy worlds the proximity query follows the maximum installed floor width plus its margin, with a minimum of 200 m and maximum of 1 km. Legacy or narrow networks retain the small query; the floor contribution is capped so the complete influence stays inside that bound. Without explicit floor metadata it falls back to the previous narrow river influence. This remains a potential-cover scenario, not HAND, observed soil, flood frequency or a guarantee of safe building land.

The existing alluvial section generator was not selected by normal package generation. Normal new packages now select it by default; an explicit `valleySections: 'legacy'` / `--valley-sections=legacy` still overrides this choice. The UI generation cache changes to version 16 so a newly requested world does not accidentally reuse an older generation package. Existing paths, manifests and saved materializations remain unchanged.

The same regional classifier supplies cover, vegetation and environmental road costs. Its existing wet-meadow exclusion now also applies to agricultural hinterlands on the recognized valley floor. A test with a nearby village verifies that a previously arable classification becomes potential wet meadow while the supplied terrain and water record remains identical. Existing-policy worlds preserve the old classification and query behavior.

In a 20 km prospective alluvial confluence sample, applying the old and new environmental policies to identical physical terrain/water changed 923 of 16,641 cells from woodland to potential wet meadow. Water stayed at 1,861 cells in both. This diagnostic deliberately omits human land use; the farm exclusion is tested separately. It does not represent automatic migration of the user's current saved world.

A first 16-by-8 package test fixture produced no rivers, so it could not prove the connection. The replacement 32-by-16 regional-river fixture verifies that an ordinary generated package contains real river profiles with positive valley-floor widths and publishes the new environmental policy. The intermediate aggregate run was interrupted to finish that package-entrypoint connection; it is not counted as a passing run.

The first completed aggregate attempt for this phase hit its 600-second time limit; no full-suite pass was claimed from it. Inspection found unnecessary 1 km searches even on networks with no valley-floor metadata. The query was bounded by actual installed floor widths, focused checks were rerun, and the same complete single-worker test list was restarted with streaming progress and the same 600-second / 256 MiB limits.

## Village-scale agricultural allocation audit

The same saved tropical world was sampled over a 4 km square at 31.25 m spacing around its 300-person village. The existing radial food hinterland remains conspicuous: 95% of arable/pasture samples lie within 1,126.7 m and the maximum is 1,152.9 m. This is the old saved world, deliberately not migrated to the new valley policy. Detailed strip parcels and buildings are omitted from the diagnostic.

A separate eight-neighbour sampled dry-land route audit found routes to all 2,826 agricultural samples within the window. Therefore this sample does **not** demonstrate inaccessible farms. Its weighted travel cost ranges up to 3,855.6 equivalent metres, despite the roughly 1.15 km radial limit. The diagnostic excludes bridges, fords and boats, forbids diagonal water corner-cutting, and caps sampled edge grade at 0.2. Sub-grid obstacles and paths outside the crop are unresolved. These are diagnostic assumptions, not validated medieval travel times.

The next implementation should rank bounded, reachable land by terrain and access, feed one saved allocation into both regional cover and local parcels, and disclose survey/food-capacity limits. It must not replace the radial pattern merely with decorative noise or eagerly survey every village on the planet. No new farm allocation has been installed by this audit. See `reports/farm-access-audit-2026-10-12.json`.

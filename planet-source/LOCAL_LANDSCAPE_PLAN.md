# Local landscape repair, 2026-10-10

## Acceptance target
A coherent medieval-world analogue of continuous Earth exploration, from planet to an inhabited landscape. Not merely a connected settlement graph or enough repeated houses. User reference screenshots show the required relationship and detail of land parcels, roads, water, vegetation and settlements; they are not permission to reproduce modern Japanese infrastructure or to claim photorealistic satellite imagery.

## Confirmed gaps
- Every urban quarter repeats fixed 400×460 m blocks with 96 identical homes. Local terrain mostly vetoes plots; it does not guide a plausible street network or land division.
- Agriculture begins outside a large square reserved envelope in a 250 m square spiral. Towns/cities emit no agricultural plots. This produces empty rings, broken strips and no credible town–countryside transition.
- No runtime vegetation layer; biome labels/colours are not individual woodland, groves, hedges or meadow structure.
- Public/industrial uses exist as labels and resource checks but share generic boxes. No proper square/churchyard or spatially distinct civic composition.
- Mountains/hills in generator 17 are numerically suppressed by every lake's water level globally. At 500 m the nominal 140 m hill component is capped at about 0.015 m in the inspected world. Merely defining amplitude bands did not implement visible hills.
- Local streams, ponds, wetland margins and irrigated field conditions need genuine ground/water definitions, not blue decoration. Rice paddies require an explicit agricultural/cultural/water regime; a medieval label alone does not imply them everywhere.
- Existing tests certify counts, IDs, route existence and bounded numerical rules, not the product's geographic plausibility. The previous completion/stop wording was incorrect for this goal.

## Work order
1. Fix spatially local shore protection; quantify realized relief and inspect it in actual local views. Preserve saved old worlds; new terrain gets a new generator identity.
2. Generate a coherent regional land-use partition: water and banks, wooded/rocky slopes, usable agricultural ground, settlement footprints and access. Stream stable geographic chunks, not camera-dependent scenery or isolated decorative village rings.
3. Replace repeated residential grids with a terrain/approach-road-led settlement plan: public center and churchyard, primary streets, subsidiary lanes, parcels and peripheral cultivation. Reserve civic and productive land before fitting houses. Variability must follow purpose and terrain, not random jitter.
4. Give facilities distinct actual footprints and necessary yards; add forest/field boundaries and local water features using the shared model. Keep geometry and land use stable across LOD.
5. Inspect multiple real seeds/locations at regional, town and street scales. Save concrete failures and fix them. Regression counts cannot substitute for these views.

## Current work
Generator 18 introduces geographically scoped lake protection. Its first repair is verified on the draft branch; this is not product acceptance. The existing external road audit belongs to its original terrain; it must not be relabeled as acceptance of newly generated relief or newly planned streets.

### First repair evidence
The first local-shore implementation exposed an upstream junction below a receiving lake in one reference seed. Lake protection now follows that lake's own upstream drainage area, with smooth spatial shoulders; unrelated basins do not inherit its level. Five reference river graphs pass again without deleting rejected-route checks or raising the 600 m incision limit.

Generator 18b's actual 30×30 km surveys (500 m samples) show residual-relief ranges of 31.20 m versus 5.01 m around the previous city, 25.55 m versus 1.01 m around settlement 4054, and increases at all six inspected windows. These are realized values, not band amplitudes. `reports/realized-relief-18.json` includes the world IDs and full values. This does not establish that the landscape looks convincing yet.

Core/generator regression at this checkpoint: 696 PASS / 0 fail, build passed. Regional ecology and town layout rework remain in progress and are not covered by that count.

### In-progress landscape checkpoint, 19:56 UTC
- A shared, versioned potential-cover field drives local colours and stable woodland candidates. Geographic streaming slots do not decide feature positions. Tree crowns/trunks are currently visual geometry; tree collision/forestry are NOT implemented.
- Replaced the new-profile farm ring with jittered Voronoi domains and contour-oriented rain-fed strips. Each strip is sampled against actual ground/water and a declared settlement food hinterland. Soil/harvest/history are not inferred. These are still scenario-dependent candidate farms, not a certified agricultural landscape.
- New-profile settlement entry points now reserve commons and churchyards, survey grade/water-aware street paths, and allocate homes along frontage. Institutional chapels have distinct nave/tower geometry. Rear household garden plots are screened against streets, homes and public land. Production facilities retain existing dependency checks and still need better yard morphology.
- Actual restored world `sha256:2e1103b572680ae413973f711fc99d03040b4cd803f2a60c0228b91172f6b33f`: city 3843:0 central quarter houses96/96, has chapel/tower/carpenter/granary/hall/handmill and59rear plots; village3649:25 houses60/60, commons/churchyard and34rear plots; riverbank3392:102 houses60/60 and35rear plots. These counts are NOT visual acceptance.
- Cloud-browser inspection confirms the new streets appear, but also demonstrates that repeated macro quarters remain unnatural. The city-wide topology and density must be revised; completing a neighborhood generator alone does not meet the target.
- Fixed two integration regressions found during validation: blank vegetation overlays lowering house foundations, then oversized visual overlays evicting physical charts. Visual-only landscape pages no longer enter the physical terrain cache. Tests were not waived.
- Always retain streets in coarse feature meshes; the former coarse path omitted them and contributed to the 'houses floating alone' appearance.
- Full suite709PASS/0fail at this checkpoint. Earlier runs in this change failed; only the final rerun passed. Build and actual browser scenes are checked separately.

Unfinished before product acceptance: coherent city-wide morphology; external-road clearances for trees/fields; less approximate settlement clearings and agriculture; actual local ponds/tributaries/wetlands; facility yards and access; tree interaction; multi-site visual review and load-time performance. Do not merge or describe this draft as complete just because regression tests pass.

### Town-wide revision and clearance validation, 20:20 UTC
The first neighborhood-only repair still produced repeated cross-shaped hubs in the real city view. It was not accepted as a city solution. New layout policy `terrain-led-neighborhood@2` uses one terrain-biased Voronoi street graph across a town, with compact240m paging districts that do not define the visible block boundaries. Village frontage layouts remain distinct. Housing is allocated inside actual blocks; streets, foundations and renderer reuse the same geometry. Public market/church land is reserved at the city center, not repeated in every page. This still does not simulate historical growth or fully solve the urban edge.

Actual world18e (`sha256:f4fb0051705130ad7d438787d363db335a17e07d4b0212270786818d8848b9ce`): all105districts of city3843:0 produced10,000/10,000homes. Each district's street graph is connected and the city has one cross-page component (1mm endpoint identification). The bounded pedestrian-access audit found0inaccessible buildings. `reports/urban-landscape-access.json` records the precise scope; this is not product/visual acceptance or all-world verification.

Road clearances now derive from the SAME canonical local road recipes, compacting only redundant horizontal sample points. Woodland crowns and agricultural strips avoid these routes. The compact clearance cache is capped at8MiB. A real temperate woodland page queried257candidate road links, generated400trees in~5.1s initially, and returned identical output in~26ms on repeat; compact route cache was73,688bytes. This is a single CPU/cloud sample, not a global performance guarantee. Camera-obsolete feature jobs now abort rather than blocking two load slots indefinitely.

Actual browser checks also found inward-facing garden triangles rendering black; the winding was corrected and regression-covered. A second physical-cache entry point for visual-only landscape was excluded. Terrain, forest visuals and field patches must not overwrite house foundations or evict all local physical charts.

Still open: natural-looking settlement edges and pasture/orchard/public-space detail; improved facility yards and access; real small ponds/tributaries/wetlands; tree collision/forestry; full regional/planet road acceptance after changed layouts; coarse land-cover transitions; bounded foreground readiness and multi-scene visual acceptance. The draft remains unfinished.

Combined checkpoint after the cache-path corrections: 716 PASS / 0 fail; build passed. The preceding combined run failed one cache-initialization compatibility test; the optional cache write was corrected and the complete suite rerun.

### Communal pond connection (in validation)
A new opt-in `surveyed-communal-pond@1` scenario surveys dry, low-relief land before village streets and homes. A compact continuous excavation and explicit water level use the existing physical surface-water model. The same bed is used during layout and when exported; banks are reserved against streets, dwellings and gardens. Old sites without this policy are unchanged. It is a constructed communal storage feature, NOT natural-lake generation, drinking-water certification, or a simulated sustainable water supply. Seepage, replenishment and seasonal balance remain absent. This does not resolve the broader tributary/wetland requirement.

Pond checkpoint verification: 719 PASS / 0 fail; build passed. Three actual restored villages in world `sha256:1d866c588e96a0d3840ed3f145e90888ec2f1ca5a5a5d91d0a1cf2b8ed0edabe` have 1.495 m center water depth, no center road/building, and retain 60/60 homes each. See `reports/communal-pond-world.json`. Browser inspection still shows overly radial village streets and detached service boxes. These remain morphology failures, not accepted scenery.

### Village street morphology repair (in validation)
The actual pond-world view revealed a second failure: every subsidiary lane radiated from the same centre and several road segments were duplicated. The new opt-in `terrain-led-branches@2` policy grows subsidiary lanes from the nearest feasible existing street network. It keeps explicit settlement boundary gates, uses fewer secondary termini, and checks road centre and both edges at <=1 m longitudinal sample spacing for water, reservations and grade. This is bounded sampled acceptance, not proof against sub-metre obstacles. Existing packages lacking the policy retain their saved layout choice. Detached service plots and settlement-edge land division still need work.
The first road-width survey attempted every candidate lattice edge eagerly. This caused the full suite to exceed its unchanged 180 s timeout and stalled actual-village inspection. It was not accepted. Surveying only proposed paths, caching accepted/rejected edges and replanning at most 16 times per gate reduces a flat village to 6,349 ground queries while retaining the width checks on every emitted segment. No timeout increase or deletion of safety checks was used. Actual three-village generation retains 60/60 homes and the physical ponds; full regression is being rerun after this performance correction.
The corrected branch-policy checkpoint passes 721 tests / 0 fail and the build, under the original 180 s suite limit (108.6 s). Browser inspection confirms side lanes now attach to established streets rather than all radiating from the center. `reports/branched-village-world.json` records actual world samples; broader morphology remains unfinished.

### Service frontage checkpoint
New `frontage-service-parcels@2` villages allocate service parcels along actual streets instead of four remote edge boxes. They survey the plot and access, keep resource/institution requirements, reserve a full parcel before housing, and separate the building footprint, work yard and connecting path. Actual three-village samples retain 60/60 homes and generate 4, 3 and 3 service yards with matching access paths (`reports/service-frontage-world.json`). Churches retain their own public precinct. Existing city blocks and old policies are not silently migrated. Validation: 724 PASS / 0 fail, build passed (113.7 s). This is still a static scenario without production quantities or complete historical growth; coherent countryside edges and secondary drainage remain unfinished.

### Visual-only terrain-bound regression
Although vegetation no longer entered physical terrain caches, the height-bound and certification paths still counted its 25 m visual allowance as uncertain ground displacement. Those paths now exclude visual-only descriptors as well. A regression verifies that adding trees changes neither the ground interval nor its certification; physical features still widen an unknown interval. Full suite: 725 PASS / 0 fail; build passed (110.5 s). CPU-browser streaming remains slow and is still being inspected; this does not certify loading performance.

### Village/countryside transition (in validation)
The village envelope was also excluding every farm from otherwise unused ground. New worlds opt into `village-footprints@1`: landscape generation references compacted actual settlement recipes (homes, roads, public/household/service yards and pond reservations), rather than inventing a second layout. Only fully surveyed small villages can relax the conservative envelope. Missing or over-budget surveys retain the old exclusion. At most 16 district recipes are consulted for a fixed landscape tile, with an 8 MiB compact-land cache. This does not alter houses, terrain, ownership or positions when the camera changes. Urban-edge transitions are still conservative and unresolved.
The actual four village-edge tile comparison changes field-strip counts from 0/3/0/0 to 6/10/10/10 while preserving canonical occupied land. Compact settlement cache used 21,060 bytes of its 8 MiB budget. Cold first tile took 7.26 s including shared road generation, subsequent tiles 0.16–0.30 s; first-load latency is still a limitation. See `reports/parcel-transition-world.json`. Full suite: 727 PASS / 0 fail; build passed (111.7 s). This opens usable land around a village; it is not a complete historical land-use or urban-edge simulation.

### Responsive feature generation checkpoint
The canonical parcel transition exposed UI pauses: synchronous route/parcel/mesh generation was running in the input/render thread. Procedural feature work now runs in one dedicated web worker with a bounded queue and cancellation; the main thread only uploads completed meshes. This is not another AI instance. Existing page/land/road caches remain bounded. An actual isolated-worker regression compares vertex/index arrays and building IDs exactly against direct canonical generation. Browser day/time controls and close-view navigation responded while features loaded; 60/60 homes and seven resolved nearby roads remained visible. This is an observed improvement, not a certified FPS target. Full suite 729 PASS / 0 fail; build passed (116.8 s). CPU terrain streaming still needs broader performance acceptance.

### Physical-feature retention defect (under validation, 21:09 UTC)
An actual level-10 tile took ~9.5 s, of which ~9.4 s was physical-feature preparation. Broad road search corridors caused 35 chart requests; the 8 MiB cache silently evicted the four village charts before sampling. This could remove physical pond/foundation detail even while buildings were visibly present. It is a correctness defect, not just a low-detail art style.
Required charts are now pinned in canonical order while preparing a mesh. Surveyed chart rectangles tighten the broad search bounds in a bounded 128 KiB metadata cache. Coarse over-budget features are explicitly deferred with their displacement uncertainty retained for refinement; physical point queries report unavailability rather than silently returning incomplete ground. The mesh error calculation now includes procedural descriptors, not just saved manifest features. No memory ceiling was increased. Road routing yields via the existing cooperative scheduler rather than browser-clamped repeated timers.
The actual tile retains all four villages, explicitly defers two coarse road charts, and still returns the pond's 1.495 m depth after mesh generation. Repeated mesh buffers are identical and took ~91 ms in the recorded CPU run. `reports/mesh-feature-retention-world.json` records the scope. Three villages from the second seed each retain 60/60 homes, four service yards/accesses and physical ponds (`reports/second-seed-villages.json`). This does not establish varied morphology or complete local drainage.

Physical-retention checkpoint: 734 PASS / 0 fail, build passed (115.6 s). The former broad-road preparation was measured, not inferred only from code. Cold generation and foreground LOD readiness remain unresolved; the cloud CPU view still spends too long on the coarse frontier.

### Foreground LOD starvation (in validation)
The dispatcher also required every distant coarse tile to finish before any nearer, finer tile. In the actual second-seed view at 334.4 m, more than 1,000 generated tiles still left the displayed maximum at L10. Scheduling now propagates the near view's priority through its actual ancestors, sibling groups and 2:1 edge halo. An unrelated opposite-face tile is no longer treated as a prerequisite. Planned/displayed balancing and hard memory limits are unchanged.
Cloud CPU inspection of the same village/height reached L14 at 325 generated tiles, then L15 at 356 tiles with 28.3 MiB of terrain geometry. The physical pond became visible. These are observed readiness samples, not a controlled frame-rate benchmark. Regression coverage preserves complete sibling prerequisites, cross-face halos and immutable geometry. The old opposite-face-first assertion is replaced because it encoded the starvation policy rather than a real adjacency requirement.

Foreground-dispatch checkpoint: 737 PASS / 0 fail, build passed (109.8 s). Full suite includes unchanged 2:1 planning/display checks and bounded-memory rules. Broader landscape acceptance remains open.

### Public destination access (under validation)
New runtime10 village packages opt into `surveyed-public-footpaths@1`. The chapel frontage and communal pond bank receive pedestrian approaches connected to actual streets. Route width, dry known ground, grade and building/land exclusions are sampled before houses and gardens are allocated. Pedestrian paths do not become extra housing frontages. Failed direct approaches remain explicit; this planner does not claim general obstacle-avoiding pedestrian navigation. Saved runtime9 worlds retain their previous layout policy.
Three actual restored villages in the new second-seed package each retain 60 homes. All six public destinations have dry, unobstructed approaches represented in the same physical road recipe as the renderer. Chapel access is 26.75 m in these three samples; pond approaches vary from 3.75 to 64.14 m. Public building siting itself remains too repetitive and is not solved by adding paths. See `reports/public-access-world.json`.
The contour menu now includes 10, 20 and 50 m intervals for modest local relief; the old 100 m minimum could not reveal a hill with only tens of metres of relief. Contours still reflect sampled rendered terrain, not invented topography or a completion claim.

Public-access/contour checkpoint: 741 PASS / 0 fail, build passed (110.8 s). The actual runtime10 village view shows the approaches in the same scene as the church, pond and retained housing. These checks do not close the remaining siting, secondary-watercourse or landscape-diversity tasks.

### Contour and reload verification correction
The first 10 m contour inspection exposed wide black bands on gentle slopes: the CPU renderer used a metre-based width derived from camera altitude. CPU contours now use the perspective-correct screen-space height derivative, matching the GPU's screen-space approach. Both skip flat/undersampled cases and avoid a fixed 1 m minimum. Actual cloud inspection shows narrow lines rather than black land bands; this still does not make the terrain itself more rugged.
A site URL also overrode an already restored camera on reload. A valid same-world history view now takes precedence. Actual reload retained 7.7 km altitude and 70-degree tilt instead of resetting to 100 km. Validation: 742 PASS / 0 fail; build passed (117.1 s).
A further highland survey found that even around the 32 highest source cells, the largest measured relief across a 10 km window was only 169.2 m (1 km sample spacing). High altitude is not the same as a rugged mountain. This is a terrain-generation limitation as well as a viewer problem; it remains open rather than being hidden by height exaggeration.

### Elevation-activated relief and bounded settlement search (under validation)
Generator19 activates 2.5 km / 900 m mountain detail above the lowlands, 900 m / 100 m hills, 180 m / 12 m local relief and the existing 8 m roughness. C1 elevation activation and explicit per-band shore budgets preserve shore-side classification; the renderer and canonical sampler share the same field. Saved generators retain their serialized bands. The controlled uncarved comparison records substantially stronger highland relief, but is not an erosion model or hydraulic acceptance (`reports/elevation-relief-comparison.json`). Actual cloud CPU views confirm visible relief at a highland and a village; the highland remains smooth and the village remains repetitive. This is not landscape acceptance.
The first new profile broke two short polar river reaches. Junction surveys now use the same polar-adaptive sampling step as reach fitting; a third bounded local corridor search can find nearby valleys without raising the 600 m incision limit or 4096-node search cap. Five reference river graphs pass; between-profile hydrology remains unverified.
The first full new world also exposed single-candidate settlement rejection: only 53.61 million of the requested 100 million people received sites. Catalogue@2 searches up to eight points within each slot, at most 1.2 km from its original point, without relaxing water or 6% grade exclusions or consuming later slots' RNG. The new package places 263,335 settlements / 86,456,292 people; 39,463 settlements / 13,543,708 people remain explicitly unplaced. That remainder is a known limitation, not a completed 100-million-world result. Controlled four-region comparisons and whole-package counts are recorded separately.
Actual restored generator19/runtime11 villages 2706:508, 3649:273 and 3392:261 each place 60/60 homes. Two decline the optional pond and one has no chapel; this reveals the overly narrow fixed public-site search, which remains to be repaired. The third has connected chapel/pond approaches. Existing saved worlds are not regenerated in place.

Generator19/runtime11 checkpoint: 749 PASS / 0 fail; build passed (115.0 s). The first full profile run had one stale old-wavelength expectation; it was updated to check the new configured bands and the amplitude bound, then rerun. A proposed six-band compatibility test was invalid because the existing engine supports at most four bands; the corrected four-band round-trip test passes. No test timeout or memory ceiling was raised.

### Public-site selection instead of two fixed offsets (under validation)
New runtime12 packages opt into `surveyed-street-public-sites@1`. Up to 48 deterministic street-front churchyard candidates are ranked by civic proximity, foundation earthwork and verified pedestrian approach. A sloping yard follows terrain and is not rejected merely because the whole yard is not level; the building foundation retains its tighter 1.2 m relief limit. Existing road strips, commons, ponds and known wet/unknown ground remain exclusions. Candidate work stops early only when a nonnegative score lower bound proves remaining candidates cannot improve the choice.
Paired comparisons at the exact saved generator19b sites keep terrain/population fixed and change only the opt-in public-site policy. All three retain 60/60 homes and connected chapels, including the highland village whose two former fixed candidates both failed. Accepted foundation relief is 0.15 / 0.45 / 0.19 m; 21 / 28 / 20 candidates were surveyed. This is recorded as a counterfactual policy audit, not a claim that the old saved world was modified. New-package visual confirmation is separate. Ground/water checks are sampled; this does not prove all continuous geometry or complete historical institutional geography.

Public-site checkpoint: 753 PASS / 0 fail; build passed (121.0 s). New-package inspection remains pending at this checkpoint; paired saved-site tests alone are not visual acceptance.

### Village trunks must have an external destination (under validation)
Runtime12 new-package inspection confirms the selected chapel is present, but also exposes a separate structural problem: every village still builds four cardinal trunks regardless of its actual external links. Runtime13 adds an opt-in street-demand context derived from saved regional road links (including the first leg of lake bypasses). Non-root villages request only those trunk gates. Regional roots retain four reserved interfaces until their global connections are resolved. Subsidiary rural lanes are bounded and terrain-ranked; their agronomic destinations are not yet fully modeled.
A one-access flat fixture initially housed only 45/60 after reducing trunks; it now reserves three subsidiary lanes, while two-or-more-access villages use two, and a 15 m frontage spacing replaces the old18 m spacing only in this new policy. This is a finite layout allocation, not historical growth simulation. Paired actual sites retain60/60 homes and connected public destinations while requiring west / west / west+north trunks rather than the same four-way cross. Wet road-endpoint fallback cannot select a nonexistent saved trunk. New-package visual acceptance and broader regional-road validation remain pending.

Runtime12 actual package `32113196192c...` restores three inspected chapels and all 60 homes per village; the highland church is present in the cloud CPU view. The scene still has repetitive four-way trunks, motivating the separate runtime13 change above. Second generator19 seed `landscape-second-1` (`212ab0ec4e3f...`) has 45 accepted macro river profiles, no rejected graph links and 12 lakes, but only85,249,438 /100,000,000 people placed in259,566 settlements. These are new-world figures; old generator18 route/population results are not transferred.

Network-demand street checkpoint:758 PASS /0 fail; build passed (118.0 s). Saved runtime12 geometry remains unchanged; newly generated runtime13 packages receive the new context. New-package view is still pending at this checkpoint.

### Second-seed housing regression and bounded infill (under validation)
Runtime13 actual second-seed package reveals a failure missed by the first three fixtures: village2990:577 places17/60 homes. The same terrain/site with runtime12's uniform trunks places45/60, so part is a pre-existing steep-frontage limitation and part is a regression from reduced trunks. Other two second-seed villages retain60/60. This is retained in `reports/network-second-world.json`; it is not hidden by the passing suite.
The existing spare-lot allocator is now reused only through a new explicit `surveyed-residential-infill@2` policy. It retains all already allocated home IDs/positions, checks public/work-yard reservations, samples foundation interiors and known-dry ground, and surveys the full1.25m half-width of connecting paths at1m spacing. Unknown water/nonfinite ground are rejected. It does not relax the0.8m foundation relief or12% path-grade limits. New runtime14 paired results at that same site restore60/60 homes (43 surveyed infill lots); the first two remain60/60. The real third-site recipe takes roughly8.7s in the recorded paged CPU run, so loading cost remains significant. No saved runtime13 world is silently modified. Physical/visual new-package verification follows separately.

### Oblique camera orientation defect (under validation)
Actual inspection revealed that nearby houses grew toward the top of the image while distant land fell below them. The camera eye orbited in the positive heading direction while retaining north-up as its up reference; at nonzero tilt its up vector had a negative radial component. The eye now orbits toward the viewer (negative heading direction), keeping local vertical upward and the foreground below the target. At zero tilt the north-up view is unchanged. Heading/latitude regression checks verify an orthogonal basis and positive radial up. This fixes camera geometry only, not world/object placement. The cloud view now shows foreground houses below the village and the horizon above it; ground LOD is still loading and this is not performance acceptance.

### Infill physical audit correction
The first 60-home infill result was not physically correct: some access centerlines entered retaining batters outside building footprints and disappeared under foundation earthwork. The initial failed evidence is preserved in `reports/infill-physical-initial-failure.json`. Strict infill now shares the physical pad transition calculation, rejects new pads that bury existing paths, and surveys paths outside all known foundation transitions (including service buildings). Access endpoints remain outside the foundation transition; doorsteps/steps are not modeled.
The first corrected 24 m candidate grid placed54/60 with no sampled physical failures. An18 m grid, still bounded to the existing district footprint (399 candidates maximum), restores60/60 without relaxing water, slope, foundation or clearance exclusions. Existing17 homes remain byte-identical. The shared physical chart confirms all60 house centers and3,102 path samples (center and ±1.2 m sides), with zero wet/overlaid/missing-road failures. This is a finite sample audit, not a continuous proof or whole-world acceptance. See `reports/infill-physical-width.json`. A fixed flat reserved-land test initially dropped9 homes under the stricter clearance; the bounded denser grid resolves it without changing its expected60 result.

Runtime14/camera checkpoint:764 PASS /0 fail; build passed (109.4 s), unchanged256 MiB test heap and180 s runner limit. The earlier762-pass run preceded the retaining-batter repair and is not substituted for this final run. New immutable runtime14 package inspection follows; old saved worlds keep their recipes.

Runtime14 actual package `6c5dc7d74ff3...` restores60 homes at all three second-seed villages. The cloud CPU view at2990:577 confirms the extra houses and correct oblique orientation; field/forest loading remains slow (still pending after minutes), so this is not readiness/performance acceptance.

### Urban facilities: missing yards and physical approaches
City service allocation passed block centers into the economy planner, disabling its frontage geometry entirely. Facilities existed as boxes but their workyards and approaches were absent. New runtime15 explicitly opts into `surveyed-urban-service-parcels@1`: the existing parcel generator now surveys those centers, reserves yards, adds their paths before residential allocation, and connects the civic church. Saved runtime14 and earlier urban policies retain old geometry.
Initial physical checks found paths buried in house-pad batters and the church's transition. New urban housing checks the shared pad support against sampled road strips, with a4 m setback and12 m frontage spacing. Public approaches select a surveyed endpoint outside foundation transitions; actual steps/doorways remain absent. One block lost a home under its fixed quota; bounded redistribution into another surveyed block restores the household without moving accepted prefix lots or relaxing exclusions.
Two actual source cities, three districts each, now retain96/96 homes and6/1/2 service buildings and workyards. All335 sampled service/public path centerline points remain dry road surfaces without a building overlay. These are same-site counterfactual policy checks, not a claim that an old saved world was mutated or that all city districts are accepted. Initial failures are preserved in `reports/urban-services-initial-failure.json`; repaired results in `reports/urban-services-world.json`. Broader street/facility/continuous acceptance remains open.
A final approach-selection refinement prefers the smallest foundation-clear gap before path length, rather than always choosing the farthest endpoint just because its path is shorter. Legacy public-path behavior is unchanged. The final two-city physical audit was rerun after this refinement; all335 path samples pass.

Runtime15 final code checkpoint:767 PASS /0 fail, build passed (114.7 s). Same heap/time limits. The approach-gap refinement is included in this final run.
The full105-district audit of actual city3841:0 finds one connected district/street network and zero failures in the bounded straight pedestrian-approach test. It places9,818 /10,000 homes. The exact same source city's prior policy places9,718, so the net gain is100, not a completed census. Districts51/61/90 lose11/2/7 homes under the stricter physical clearances; other districts gain. These local shortfalls are not silently filled onto unsafe ground. A city-wide capacity/reallocation strategy remains open. See `reports/urban15-full-city.json` and `reports/urban15-baseline-city.json`. This access audit excludes retaining-batter/continuous-grade proof; the separate335-point shared-physical audit applies only to the six explicitly listed districts.

### Landscape loading: unrelated regional roads blocked fields and woods
A256 m field tile requested every short road from fetched regions and every20 km subsegment of a long accepted regional leg. `regionalRoadSegments` culled only the whole long leg and bypassed bounds entirely for short links. Field clearance then surveyed hundreds of remote roads before showing any land parcels.
Each fixed canonical segment now receives the same conservative local-survey envelope check. Segment numbering and endpoints do not depend on the view; the bound only limits requests. Dateline/polar, subset-identity and actual landscape-page request tests cover the path. No memory ceiling was increased.
Cold diagnostic tile29285:124209: the old path was interrupted after more than180 s,826 nested recipe starts and at least21.2 million ground queries; it had not completed. The repaired path completes in15.24 s with10 nested recipe starts (including a cold village-footprint build), yielding one field strip. Concurrent work means these times are illustrative, not a controlled speedup benchmark. See `reports/landscape-load-culling.json`.
Cloud reload of the same runtime14 village shows surrounding fields and woodland,16.0 MiB selected feature geometry and zero pending feature jobs within roughly80 s; terrain LOD is still loading. This is a real improvement in scenery readiness, not full near-ground performance acceptance or a finished landscape.

Landscape-request checkpoint:770 PASS /0 fail; build passed (124.0 s), unchanged heap/time limits. Runtime15 actual new package `f56d5df73db1...` is now open in the cloud browser at city3841:0. The coarse city appears, but the16 MiB feature budget and detailed parcel/road tessellation still limit complete distant city representation; this is a separate LOD issue under inspection, not solved by request culling.

### Coarse city display budget repair
The actual runtime15 city `pop:3841:0` has 105 district meshes. Before this repair their summed coarse feature buffers were 54,109,620 bytes, exceeding the 16 MiB resident feature budget even before countryside. Straight roads retained every 2 m station and planar yards retained their full grids at coarse LOD.

The display now joins collinear road spans up to 20 m only when inherited cubic error bounds plus endpoint departure remain within 0.1 m. Bridge/ramp and cross-section roads retain their previous geometry. Regular parcel grids reduce to two triangles only when all original 3D vertices lie within 0.1 m of that surface. Full-detail and physical recipes are unchanged. In the same city the summed coarse buffers are 9,358,740 bytes (82.7% less), with every district's building IDs preserved. This is a mesh-byte comparison, not total browser/GPU memory, load-time acceptance, or proof that all surrounding features fit at once. See `reports/city-coarse-mesh.json`.

Coarse-display checkpoint:773 PASS /0 fail; build passed, unchanged256 MiB heap and180 s timeout (124.0 s test run). Cloud city reload at1.6 km reaches98/105 loaded districts and15.9 MiB feature geometry; surrounding scenery still competes for this budget and terrain LOD remains loading. This is not complete visual acceptance.

### Field loss at a road crossing
A road touching any triangle previously deleted the entire accepted cereal strip. The new explicitly saved `roadParcelClipping: surveyed-corridors@1` policy subtracts conservative surveyed road corridors from the existing triangular field surface. It never expands agricultural land outside that surface. Ownership and strip IDs stay fixed; cut surfaces expose sourceBoundary rather than falsely presenting the original uncut perimeter as their boundary. A 12,000-triangle tile limit defers whole over-budget parcels with an explicit count. Older saved configurations keep the old behavior.

Counterfactual comparison on the same runtime14 tile29285:124209 retains5 strips /16,999 m² /435 triangles instead of1 strip /918 m² /15 triangles. All remaining triangles pass the existing road-intersection check; no parcels hit the clipping budget. See `reports/field-road-cutouts.json`. This corrects exaggerated gaps along roads. It does not add irrigation, rice, soil productivity or historical land tenure, and the earlier water/slope/settlement checks can still reject whole strips. Sequential warm-cache timings in the report are not speedup evidence.

Field-cutout checkpoint:776 PASS /0 fail; build passed (117.2 s), same verification limits. New immutable package and visual verification are pending; saved-world counterfactual numbers above are not that visual acceptance.

### Coarse physical-chart work was performed after its budget was exhausted
`enableFeatures` generated a district/road recipe before discovering that pinned charts left no capacity to retain it. The memory bound held, but coarse tiles repeatedly paid for discarded surveys. The admission check now happens before recipe generation; unknown extents remain explicitly deferred, not declared empty or certified. Smaller tiles can admit those same canonical recipes later.

An actual12 km city bound has143 physical descriptors; the repaired request retains16 charts in8 MiB and declares123 deferred, taking19.44 s in a concurrent diagnostic. The remaining descriptors were outside the eventual surveyed bounds. This remains too expensive for a smooth viewer; it is not load-time acceptance. See `reports/early-physical-budget.json`. A regression test verifies that repeatedly deferred recipes are not generated until a finer query can admit them.

The actual new road-cutout package is `3cdee46fd793...` (local-landscape-19h). Cloud view at village2990:577 shows60 homes, woods and field patches at334 m /70° /local noon. Ground still loads atL10 and obscures some roads/houses. This visible defect remains open; the farmland repair is not a finished near-ground scene.

Early-budget checkpoint:777 PASS /0 fail; build passed (124.2 s), unchanged verification limits.

### Refine the display before surveying an entire surrounding region
Terrain meshing now defers new physical chart surveys while its parent-bound radius exceeds1 km. It still fetches the canonical descriptor metadata and retains missing-chart displacement uncertainty; this is explicitly an approximate transitional mesh. Existing loaded charts remain usable. Fine tiles and physical point queries retain the normal survey and memory rules. The12 km city admission check now requests no recipes and reports139 deferred descriptors; its sub-millisecond timing is only that admission check, not complete mesh or page loading.

After a cloud reload of the same19h village, the displayed maximum LOD reaches19 by22:59:44 (reload22:58:20), compared with the previous run remaining aroundL10 after several minutes. At22:59:52 roads, yards and previously buried houses are visibly exposed along with nearby fields and woods. This is illustrative shared-machine/CPU-diagnostic observation, not a controlled load-time benchmark. The terrain queue remains active; distant and neighbouring tiles are not all certified ready. See `reports/wide-survey-deferral.json`.

Local-survey checkpoint:778 PASS /0 fail; build passed (118.6 s), unchanged limits. Progress screenshot delivered to the user; it still shows repetitive settlement form and incomplete landscape/water systems, so is not acceptance.

### Preserve usable land beside settlement reservations
The new saved `fieldSurvey: local-triangle-clearance@1` policy validates individual fixed-world field triangles instead of rejecting every strip touched by a churchyard, pond or dwelling. It requires known-dry finite ground, matching arable ownership at vertices and centroid, a two-dimensional plane grade at most12%, and no intersection with canonical settlement/road reservations. Invalid pieces remain absent; no new land is added outside the planned strip. The original strip domain is preserved as sourceBoundary, not falsely advertised as the cut surface boundary. Legacy saved configurations keep their previous behavior.

Six closest geographic tiles around actual pond village2948:595 retain306,883 m² versus214,522 m² in the paired19h counterfactual, with zero road intersections and no clipping-budget deferrals. Two central tiles improve from1,051→27,924 m² and12,840→56,088 m². One fully usable tile is unchanged. See `reports/partial-field-survey.json`. This is sampled surface suitability and fixed reservation clearance, not continuous hydrology/soil productivity or visual acceptance. Existing triangle resolution can still leave angular boundaries and overlay/terrain disagreement; that remains a rendering issue to inspect.

Partial-field checkpoint:780 PASS /0 fail; build passed (119.6 s), unchanged memory/time limits. New saved-world visual inspection is pending.

Partial-field physical samples at2948:595:2,238 distinct vertices and3,258 triangle centroids inside the actual village physical chart have no sampled water overlap or burial below−0.01 m. Vertex lift is0.045 m; centroid gaps range0.0130–0.0764 m. This finite audit does not prove all triangles or all worlds. See `reports/partial-field-physical-samples.json`.
The new saved package19i has canonical identity36dc278278b024ec96f6ef75852be85089302f0e531178aa542efc02e191e374; older world/config identities remain unchanged.

The local solar-time slider now follows the actual displayed local hour after moving or reloading, rather than retaining an unrelated12:00 thumb while the text/light show night. This updates the control only; moving the camera still does not change global solar time.
Solar-control verification: moving within the same19i world from longitude13.533886° to129.698797° changes local time text12.0→19.7 hours; slider now reads19.75 (its quarter-hour step). Global illumination is preserved. Full780 tests and build pass again (118.9 s). Actual19i lowland view shows field fragments filling the previous broad empty area while keeping the pond/churchyard clear. Distant field/ground overlay artifacts still require investigation.

A separate5,796-point barycentric interior sample in an outer field tile found no canonical-ground burial (gap0.0128–0.0698 m). See `reports/field-interior-samples.json`. Distant dotted overlay artifacts therefore remain a displayed-LOD issue in the inspected scene, not evidence that the field area data was absent. Do not hide them by moving canonical parcels or raising the physical ground.

## Next structural gap: local natural drainage
Global generation currently has45 accepted coarse river profiles in the second reference seed. The filled global128×64 source grid does not provide town-scale catchments. Constructed communal ponds and rain-fed field areas do not fill this gap.

The next bounded investigation uses the existing physical terrain and known river/sea water as receiving conditions. A finite local drainage grid must distinguish a verified receiving river from an open analysis boundary. Boundary cuts must not be called oceans, lakes or complete catchments. Only tributary paths whose contributing area and receiving connection fit the surveyed domain may become candidates. Closed depressions require an explicit pond/spill model; no blue decorative stream or unexplained flow uphill. Regional keys, grid ownership, outlet references and seeds must be independent of camera/LOD. This investigation is not yet an integrated water generator or a new completion claim.

### Bounded local drainage trial, not installed water
New `analyzeLocalDrainage` and `compileLocalChannels` modules provide a bounded static catchment survey and conversion to the existing shared physical river contract. Survey edges and depression-dependent basins remain withheld. Compilation rejects an entire catchment when profile limits, unknown water or incision constraints fail; no orphan channel nodes are published. These are currently explicit analysis tools, not camera-triggered world edits.

Four fixed 8.192 km windows in canonical19i produced 23 trial reaches in two windows, and none in two others. At17,990 centerline/interior profile samples, shared physical sampling found no dry point or incision beyond2 m; maximum measured incision was0.762 m. This is finite sampled validation, not proof of discharge, watershed completeness beyond the chosen grid, or a production global water network. The full survey and all withheld counts are in `reports/local-drainage-trials.json`. Stream depth0.3 m and area-dependent widths are declared scenario parameters; rainfall is not inferred.

Before integration: assign immutable regional ownership; prevent duplicate overlapping windows; apply natural water before roads/buildings/farms; keep paged/resident terrain and canonical identity consistent; preserve regional work/point budgets. Simply installing these trials after settlement placement would be incorrect. Local natural streams still do not appear in the viewer at this checkpoint.

Drainage trial checkpoint:786 tests PASS /0 fail; build passed (116.0 s), unchanged verification limits. Regional world installation is still pending.

### New-world integration checkpoint (not full water coverage)
An explicit `--local-tributaries` generation option compiles fixed, non-overlapping receiving-river survey regions before climate, population and settlement selection. Saved generator20-local-tributaries terrain, Core queries, paged queries and settlement foundations use the same resulting river network. Older generator19 worlds are untouched. Regions and stream IDs depend on the saved macro river network, not camera visits or LOD. The total river point limit remains32768; rejected catchments remain listed rather than partially installing their upstream reaches.

Actual20a canonical6de3521667bae499e278dcf1629ca080285de4c514feab9d8450c43c6b682d54 contains269 local reaches plus45 coarse reaches,32685 profile points,45 surveyed windows.5,992 saved resident/paged point comparisons give exactly equal ground and water, no dry centerline sample, minimum depth0.295 m. See `reports/integrated-local-water.json`. Population placement remains partial. This is not a complete watershed model:6,262 window-boundary basins,132 depression-dependent basins and10 profile/budget rejected basins remain withheld. The nearest of the inspected existing villages is6.16 km from these tributaries; this sparse coverage does not yet provide town-side streams generally.

The viewer now has destinations for saved rivers/streams and explicitly states surveyed/withheld coverage. Small tributaries are generated as shared water/ground, not blue decorative lines. Visual acceptance is pending: the first150 m highland view is still refining and does not yet demonstrate a continuous visible channel.

Mixed long and short river profiles previously shared one large Cartesian bucket width. A multi-resolution sparse index retains conservative whole-bank/arc bounds and original segment evaluation order. Actual3,038 point queries improve2,099→155 ms with identical numerical checksum; this is a microbenchmark, not browser FPS. Index entries retain the2M cap. See `reports/multiscale-river-index.json`.

Regional integration/index/view checkpoint:793 tests PASS /0 fail; build passed (122.4 s), unchanged limits. Actual cloud view reachesL17 and exposes a thin stream, still broken at transitional mesh resolution; no visual acceptance claimed.

### Narrow-water display seam and grid-route failures
At the highland stream the 64 MiB display reachesL21; the near centerline becomes continuous, but far detail remains limited. A second lowland view shows a real continuous stream beside woodland, with conspicuous right-angle survey-grid bends. This is a confirmed plausibility failure, not accepted natural river morphology. New-world rounded paths are being fitted to the same ground/incision constraints; they are not yet visually verified.

Internal display skirts checked wet endpoints but could still erect a wall across a sub-metre stream when both endpoints were dry. The same conservative river-domain intersection now guards internal and external skirts. A real0.7 m half-width channel regression covers the dry-ended crossing. Checkpoint794 tests PASS /0 fail, build passed119.5 s; rounded-path work is separate and pending.

The integrated20a extra-incision audit compares3,611 centerline points against the previous main-river-only physical ground: no raised point, no extra incision above2.02 m, sampled maximum1.715 m. This does not establish bank-wide or between-sample bounds. See `reports/local-water-extra-incision.json`.

### Rounded surveyed-channel geometry
Generator21's explicit tributary option rounds grid bends inside their adjacent cells, preserving shared endpoints and then re-running the physical monotone profile fit. No noise or camera state is used. Unsafe curves are rejected rather than raised above ground or allowed to flow uphill. Saved20a/19i worlds retain their original geometry; this is a new world identity and `tributary-region@2` IDs.

Actual21a canonicalb356a7010c6ebf24f6c35c2b89567b4e2285e4e152b3586e3c41a9e2ce9d1e89 has237 local reaches plus45 coarse reaches;32,768 points reaches the unchanged cap.39 windows surveyed,6 withheld;5,232 boundary-dependent and113 depression-dependent basins plus10 fitting/budget rejects remain. This is LESS coverage than20a's269 reaches because curved routes consume more points.5,302 resident/paged samples match exactly with no dry centerline. See `reports/rounded-local-water.json`. Visual verification remains pending, so numerical success is not a natural-stream acceptance.

Rounded-profile checkpoint796 tests PASS /0 fail, build passed118.1 s. An explicit local-noon button is being added to make inspecting distant locations simpler; moving the camera still preserves global time.

Cloud visual check at23:53:54 UTC: same lowland reach now has visibly rounded bends and a continuous near stream beside woodland. The terrain remains refining at maximumL21, with56.4 MiB reported shape data; CPU diagnostic image is not GPU/art-quality or performance acceptance. Explicit local-noon button confirms12.0 hours. Final796 tests and build pass118.2 s after that UI change. See `reports/rounded-channel-visual.json`.

### 2026-10-11: river access begins to influence settlement locations
`river-access-siting@1` is an explicit new-world landscape policy, enabled with local tributaries. A shared bounded index proposes sites beside saved rivers, with fixed 180/350/800 m scenario setbacks for villages/towns/cities. Candidates must remain inside their original equal-area slot, with space at slot edges; relocation is limited to 20 km. Dry ground, local grade, anchors and a finite natural-ground approach to the named river are checked. Four water proposals maximum are separate from the original eight local fallback attempts. Nothing is moved while viewing; older saved catalogues remain immutable.

Actual saved 21a geography: 4,056 river stations / 24,336 candidates, below the 32,768 cap. In 23 indexed populated regions, 784 slot proposals produced 84 accepted approaches (80 villages, 3 towns, 1 city); 518 tried proposals were rejected. Four accepted settlements are beside the newly generated small streams. The first implementation incorrectly consumed fallback attempts and lost two villages; this was measured and corrected. Final comparison keeps all 6,962 previously placed sites and 2,281,173 people in those regions. See `reports/water-led-settlement-siting.json`.

Saved 22b canonical `99142d617ea5130ebdd186d2e196ea317bcd0106f592ad5c48c9e4e1db3310e9` contains 259,952 sites and 85,503,702 people; 42,919 requested slots / 14,496,298 people remain unplaced. This is not universal access to water: wells, springs, lakes, potability, seasonal yield and flood safety remain unmodeled. A measured approach is not yet an engineered footpath. The viewer lists the 84 evidence-backed destinations, bounded to 128 UI entries, and discloses incomplete coverage.

Actual local recipes at five selected river sites have no sampled road center inside a building rectangle and no local-chart wet road center. However, seven nominal boundary samples fall just outside the chart after geographic round-trip, and six samples intersect foundation influence. These are follow-up defects, not hidden passes. Two town/city samples cover only one district each. Local-chart water does not itself prove agreement with all base-world river water. The early cloud view at 500 m shows the village but still has coarse, conspicuous field patterns and slow LOD refinement; natural landscape visual acceptance has NOT passed.

Final checkpoint: 803 tests PASS / 0 fail, build passed in 131.5 s with a 256 MiB heap. Five saved sites were checked at 3,232 road center samples: zero sampled base-plus-local wet road centers and zero centers inside building rectangles, excluding the seven reported chart-boundary nulls. Six foundation-influence contacts remain. Cloud CPU view reached L19 at 500 m after several minutes; sparse near water appears, but this is not acceptable load latency or a finished landscape.

### Foundation and chart-boundary correction (runtime16)
The explicit `surveyed-frontage-pads@1` policy applies the same foundation clearance already used in urban frontage to village housing. Public church siting/paths now use foundation-aware margins before housing allocation. Original saved economic policies retain their geometry. New saved23a `sha256:6d6229ec0df5b9887331f6ae8febc38688100407be8877f50fe14905dd94b995` records this policy without changing settlement positions. The chart's spherical round-trip tolerance is bounded to128 machine epsilons times radius; real exterior points remain outside.

All five earlier locations now have zero sampled pad contacts, zero chart-boundary nulls and zero combined base/local wet road centers. This removes the six/seven known failures. However, safe housing capacity falls59→55 and60→57 at two villages; this is explicitly unplaced demand, not a full-capacity pass. `reports/riverside-foundation-clearance.json` preserves those outcomes. Full805 tests PASS /0fail, build120.5s256MiB.

Cold-load diagnostics exposed another cause: the equatorial terrain slope bound is about46 m/m because lake-shore bounds use polar longitude scaling everywhere. Actual sampled local slopes are much smaller; the conservative but excessively broad bound spends the fixed LOD budget refining large amounts of irrelevant ground. A latitude-scoped analytic bound is the next performance task, retaining conservative validation rather than simply relaxing the target.

### Latitude-scoped conservative detail bounds (807 checkpoint)
Interior latitude rows now use their own worst-case longitude metric for anchored noise and lake-shore derivatives; polar rows retain the global cap bound. Physical samples and canonical world identity remain unchanged. On saved23a/23b the equatorial row bound falls46.0800→3.1441 m/m;867 physical samples remain identical and inside both intervals. Two new tests include504 finite-difference witnesses in addition to analytic bound construction.

This is NOT a completed performance fix. The isolated L16 mesh benchmark was6519ms before /7225ms after (sequential and order-confounded), so per-tile speedup is unproven. At00:31 UTC the actual software browser view,500m/60°, still hit the fixed budget:436 drawn tiles,1261 generated,70.2MiB combined shape buffers,387/387 planned leaves over target. Ground intervals remain far too broad; fields also look repetitive. No natural-landscape acceptance is claimed. Full807 PASS /0fail, build124.4s256MiB. Evidence: reports/latitude-scoped-terrain-bounds.json.

### Mixed hinterland and stable varied furlongs (811 checkpoint)
The former food-radius rule converted every eligible point to cereal land. New saved `mixed-rainfed-hinterland@1` keeps explicit grazing and fuelwood reserves on a450m spherical spatial field; arable area is a planning scenario, not validated crop yield or livestock capacity. Its food-radius allowance assumes70% usable land and does not certify that measured share. `surveyed-furlongs@2` replaces correlated FNV placement with an avalanched hash, stronger stable domain jitter, varying strip widths, and independent crop-colour scenarios. Contour orientation, water/grade survey and road/reservation cutouts remain. Pasture gets a surveyed green parcel, not cereal strips. Old saved policies remain byte-identical at three diverse parcel fixtures.

Actual3km-square audits: village4048:78 changes761→559 arable /0→138 pasture /144→208 woodland points out of961; village4048:65 changes792→646 arable /0→127 pasture /144→163 woodland. Water and civic points unchanged. Unsuitable2699:12 stays heath/water/settlement, rather than getting painted farms. Physical base and saved settlement positions are identical in23a and24a; new landscape policy intentionally changes world identity. Surveyed examples include partial polygons and still do not prove all land has a route, legal tenure, annual production or irrigation. First focused test failed due an overbroad usable-kind condition and an incorrect radius expectation; both fixed before full811 PASS /0fail, build127.2s256MiB. Cloud visual audit ongoing; no completed natural-landscape claim.

### Early local-cell certificates (in verification)
The viewer previously delayed per-grid-cell ground intervals until level18. A real saved23b level16 tile therefore carried a535.32m whole-tile error even though the same rigorous cell method certifies17.54m. Enabling the existing method at level14 keeps vertex/index hashes identical and does not relax the2px target or memory limit. Benchmark7489/6660ms is sequential, not controlled speed evidence. Global previews below14 retain bounded query cost. Browser cold-load verification is still running.

### Civic-space defect found
All three audited villages4048:65,4048:78,2699:12 have a churchyard but no village green. The common-land test wrongly requires a40x32m ungraded outdoor green to fit a1.2m building-pad relief limit. A mild5% hill fails despite being usable open land. Next change must survey the actual sloping surface and retain water/occupancy/grade limits instead of inventing a flat square. Public spaces cannot be called present just because the generator contains code for them.

Early-cell full checkpoint:813 PASS /0fail, build122.9s256MiB. The cloud view is still being observed; neither a target-compliant full view nor acceptable cold-load time has been established.

### Sloping commons correction (815 checkpoint)
New saved `surveyed-sloping-commons@1` separates ungraded village greens from building-pad flatness. Three bounded candidate sizes use known dry/finite terrain, existing reservations and a4m two-dimensional grade survey capped at12%. Accepted land follows actual ground; no flattening is fabricated. All three audited villages now retain both commons and churchyard. Known foundation/wet-road/boundary failures remain zero. Housing capacity is52/60,60/60,55/60: civic land displaces some houses, so district completion remains false where appropriate. Larger market squares keep their stricter existing rule; no citywide market acceptance claimed. Full815 PASS /0fail, build123.8s256MiB.

At00:47:15 the early-cell cloud cold load still ended budget-limited:1501 generated meshes,552 drawn,L17,76.2MiB total shape buffers,0 pending loads. It has NOT solved load latency or full-view accuracy. The cached whole-tile height hull still uses the very broad pre-cell interval despite already calculating256 tighter covering intervals. Next investigate conservative cell-union hulls while retaining every fine/coarse rendered vertex and water/bridge culling.

### Cell-union height hulls (816 checkpoint)
The union of256 conservative covering-cell intervals now narrows the cached whole-tile height hull. The hull additionally encloses every Float32 fine/coarse vertex, including skirts. One fixed-direction projection bounds the norm of all convex triangle interiors from below, maximum vertex norm bounds from above, and a double-precision rounding margin is retained. Thus morph and edge-stitch endpoints are not silently clipped; water/bridge visibility expansion remains separate. Actual saved23b L16 bounds396.13–931.45m become644.68–684.45m, with identical vertex/index hashes. This is a certificate/culling change, not a changed mountain or water surface. Full816 PASS /0fail, build133.9s256MiB; new test includes actual fine/coarse vertices and triangle interiors at three morph weights. Cloud reload at00:51:58 is still under observation.

Saved25a village4048:78 at500m/noon visibly has a common green beside the churchyard and crossing streets. Overly linear housing, distant landscape cutoffs, incomplete irrigation/natural ponds and cold-load performance remain open.

### Regional ground cover and detailed parcel connection (818 checkpoint)
Base ground colouring previously queried potential vegetation with no settlement context, while nearby detailed field overlays used actual settlement food hinterlands. This made distant farmland abruptly become forest-coloured when overlay pages stopped. `landCoverNeighbors` now loads all influencing sites for a bounded parent tile, independently of whichever physical/visual recipes were loaded first. The catalogue records its maximum settlement extent; old catalogues use a conservative46km candidate-search fallback. Actual inclusion uses each site's extent or7km hinterland. More than24 pages, oversized pages or8192 sites yields explicit incomplete cover, never a partial ownership claim.

Paged samples report `regional-settlement-influences` or `potential-vegetation-only`; the latter remains a coarse fallback. Roads/building footprints still use their precise local overlays. At20 actual points500–2500m from saved25a village4048:78, complete context produces2 arable,5 pasture,12 woodland and1 water classification. All20 outputs remain identical after page eviction and changed tile bounds. This does not certify detailed parcel ownership, crop yield or natural scenery. Full818 PASS /0fail, build129.2s256MiB.

The00:56:38 cloud check of the preceding hull change still ended budget-limited:1745 generated,341 drawn,L17,79MiB total shape buffers,41 evictions,0 active loads. Do not report that the cold-load/performance problem is solved.

### New-world UI route, 01:12 UTC
The revised local-tributary/water-led settlement option was previously CLI-only. The new-generation form now explicitly offers it (checked initially), passes a validated boolean, and uses a separate immutable cache identity. Existing saved worlds are not silently regenerated. Actual cloud-browser submission of `landscape-second-1`,100M people,128 trunk sites,4 upfront detailed settlements completed within the180-second deadline; its link opened the saved world. It contains39 surveyed local-water windows/237 tributary profiles,84 accepted river approaches,259,952 placed settlement sites/85,503,702 people.42,919 slots/14,496,298 people remain unplaced, and neither this count nor820PASS/0fail constitutes landscape acceptance. Full suite and build passed (110.1s,256MiB). Evidence: `reports/local-water-generation-ui.json`.

### Woodland stand structure, 01:17 UTC
The original woodland uses400 jittered grid candidates per256m geographic tile; its short-suffix FNV hashes correlate neighboring offsets. A new saved `patchy-woodland-stands@1` policy uses independently mixed hashes, wider in-cell offsets, and a fixed48m canopy-gap field modulated by the existing woodland cover. Actual25a terrain stand samples change400/400/400 stems to261/267/290 with exact repeated output. Wet/steep/settlement/road exclusion remains in the same recipe pipeline. Three old-policy fixture outputs remain byte-identical. This is a declared density scenario, not forest-age, species or forestry simulation. Full822PASS/0fail, build passed112.4s/256MiB. The new26a save is for visual inspection; appearance acceptance is still pending.
The separate browser new-world flow also exposed a worker120-second deadline on an initial global-to-local flight. Recovery and cold-load behavior need further correction; a successful generation does not establish a usable near-ground viewer.

### Wide river-index queries, 01:26 UTC
CPU profiling of an actual coarse mesh identified river sampling and spatial lookup as the largest costs. The sparse index formerly returned every segment at a size level whenever a query covered more than4096 hash cells. It now filters each segment's already-conservative occupied-cell box rather than evaluating distant tributaries. The extra bounded storage is48bytes/segment. Same actualL5 mesh before/after retains exact vertex and index hashes, with isolated times1093→80ms without prior local context and2678→1950ms with context. These are sequential isolated measurements, not end-to-end browser guarantees. The subsequent cloud26a reload has so far shown zero worker restarts and reached localL17, but remains budget-limited; acceptance stays open. Worker diagnostics now identify the active tile/point and timeout target. Full824PASS/0fail, build passed128.7s/256MiB.

### Household frontage checkpoint, 01:36 UTC (828 tests)
New saved `surveyed-household-frontages@2` gives each side of an existing surveyed road an independent, deterministic sequence of household frontages (15–20m), dwelling dimensions (8–12m by6–8.5m), and setbacks (4–6m). This is an explicit household-size scenario, not a claim of simulated wealth or medieval property history. Candidate interiors must be known, dry and unoccupied. New compact infill uses10×8m instead of the legacy12×12m foundation, retaining grade, access and earthwork avoidance checks. Old unflagged recipes remain unchanged.

Two first attempts were rejected because they reduced capacity to33/60,60/60,45/60 and then46/60,60/60,51/60 at the three fixed villages. The corrected version reaches60/60 at all three; both sampled town districts retain96/96. Sampled pad contacts, building collisions, wet road points and outside-chart points remain zero. These finite checks do not establish every continuous footprint or citywide acceptance. Actual inputs, outputs and rejected attempts: `reports/household-frontage-audit.json`.

Full828 PASS /0fail, build succeeded (126.0s,256MiB). New27a saved world opened in the cloud CPU viewer at500m/noon. House dimensions and side offsets vary and the central church/commons remain visible, but long straight rows, coarse fields, sparse landscape transitions and slow local loading remain visibly inadequate. This is NOT final visual acceptance or completion. No natural ponds, rice irrigation, ownership history, or fully completed urban morphology are claimed.

### Adaptive communal storage ponds, 01:45 UTC (831 tests)
Four fixed54×40m sites with a0.7m relief limit almost always rejected gentle hills. New opt-in `surveyed-communal-pond@2` surveys a bounded65–145m belt near village streets, ranks known dry low-earthwork sites, and tries three physical pond sizes. A2m support survey must keep required incision below2.9m (shared continuous bed cap3m); every boundary remains outside the bed support. This is a maintained communal storage-water scenario, NOT natural-lake inference or a water balance.

An initial wider search produced unconnected public ponds at two villages and was rejected. The near-village search produces ponds and surveyed pedestrian access at all three fixed villages, retains60/60 housing, and keeps sampled road/foundation/water failures zero. Shared exported physical terrain has sampled maximum depths1.295/1.495/0.995m, zero wet rim samples and maximum incision2.370/2.301/1.796m. Two sampled urban districts remain unchanged; no town-pond claim. Evidence: `reports/adaptive-communal-pond-audit.json`.

Full831PASS/0fail and build succeeded129.4s/256MiB. Actual new28a cloud viewer at500m/noon displays a pond among the houses and adjacent to the public path. Natural ponds/wetlands, water supply and more varied settlement geography remain unimplemented. Near-ground loading still takes minutes and is budget-limited; the16MiB feature budget needs separate diagnosis. World28a canonical ID: `sha256:5f3e843e2dbb6a39d480f1969f8d6bb5ce8ac513dde74282cdf9fc9ea5f6028c`.

### Surface LOD and feature-budget admission, 01:51 UTC (835 tests)
At an overview camera above200m or a feature distance above600m, roads and yards can now use the existing0.1m-bounded surface reductions independently of house/roof detail. Building positions and full wall/roof vertices remain unchanged. Worker and direct generation agree, and cache keys include both detail choices. The actual4048:78 recipe falls from9792 to3882 vertices,724608 to287268 bytes including height lifts; this isolated mesh result is not a browser-FPS promise.

A full16MiB feature budget formerly led to repeated generation of lower-priority geometry every10seconds. Rejected candidates now wait until the current priority/capacity can admit their known size or the view/detail changes. Useful geometry is not evicted for an admission that still cannot succeed. Fixed memory limits remain unchanged. UI separately reports displayed/loading/budget-deferred feature counts; underlying objects are not deleted or moved.

Focused15 tests pass after correcting a new test's height-lift accounting (24bytes/vertex, not4). Full835PASS/0fail and build succeeded134.1s/256MiB. At01:50:33 the actual28a cloud500m view reports67 loaded of76 wanted,9 budget-deferred,16,713,048 uploaded bytes,76 builds,0 pending,0 errors. Terrain loading/LOD remains budget-limited; this does not solve the whole viewer or missing natural scenery. Evidence: `reports/feature-surface-lod-audit.json`.


### Surveyed residential branch destinations (837 checkpoint, 02:07 UTC)
New saves use `surveyed-residential-catchments@1`: secondary village lanes target dry, low-relief patches away from existing streets rather than fixed diagonal corners. The bounded existing survey lattice supplies candidates; actual road grade/wet-width checks and each house's separate survey still apply. External cardinal gates remain the regional connection contract; no arbitrary decorative bends were added. Legacy saves keep their old policy. Runtime20 separates new cache identities.

Three real village sites retain60/60 dwellings and connected chapel/pond paths; two town quarters remain96/96. Finite checks found no pad/road contact, road/building collision or sampled wet road. Evidence: `reports/residential-catchment-audit.json`. Full837PASS/0fail and build succeeded116.1s/256MiB. New29a save ID `sha256:a7d7fa85889f00e1b8685b7553c112d635d7cedfd3ddb5bbfb1df547d6f69bf2`. The cloud500m/noon view at02:07 shows changed housing clusters, but still has coarse surrounding ground and visible regularity; appearance is not accepted. Large generated inspection saves are ignored and not shipped. The default repository example is an older immutable save, so delivery of current source must also clearly identify how to generate the new policies without silently moving existing objects.


### Saved-world delivery notice (840 checkpoint, 02:14 UTC)
The tracked default example is generator16 without landscape policies or a settlement catalogue. Installing new code cannot silently change that immutable world. The UI now lists missing saved policies and opens the explicit new-generation form; current29a is identified as having the policies without claiming acceptance. Generator labels now recognize suffixes such as `@21-rounded-tributaries`. A previous generation job was also misleadingly described as “the same seed” even after editing the form; the status/link now name the server's actual returned seed. Cloud-browser checks covered the old default notice, opening the form without a POST, and current29a's different notice plus previous-job identity. Full840PASS/0fail and build passed118.2s256MiB. No large generated inspection fixtures were pushed and no saved objects moved.


### Natural hollow ponds and wet-season margins (848 checkpoint, 02:31 UTC)
`planet-local-ponds@1` surveys actual ground without excavating it. Fixed saved river neighbourhoods are filtered by an explicit >=500model-mm/year and >0C annual-mean climate scenario. Coarse priority-flood hollows receive bounded33x33/8m refinement and4m rim checks; low/open rims, existing water, excessive depth/area and overlapping supports are withheld. Water is a constant partial-fill level below the surveyed spill, clipped against the unchanged real bed. Up to128 schema bodies/64 default generated ponds; no per-view creation. A16m/max0.6m-above-water saved wet-cell margin gives wet-meadow classification and excludes ordinary cereal/woodland placement. This is a static wet-season assumption, NOT a perennial lake or simulated water balance.

Resident terrain, restored worlds, page sampling, physical placement, packaging and water visibility share the same saved model. New UI seeds use a new cache identity. Old snapshots without the optional model remain unchanged. Generation22 produces a separate saved world before settlements are placed; canonical climate/population references are recomputed after its base identity changes. The lake menu includes the measured pond focus and labels the rain-season assumption.

Actual seed landscape-second-1,100Mpeople/128trunk sites/4upfront settlements produces19 ponds from39 regions:14 climate-eligible surveys,24 refinements,5 geometric rejections. All19 checked at8m beds/4m rims:4287wet samples,1582dry margin samples,0wet rims,0land-cover mismatches,0resident/paged differences at95 sample points,3274tree candidates with0wet trees. New31a world ID `sha256:d2dccb6f38b50c89441ebe88b44356ab36be13dcf2154b00f37717db23f94c46`. Pond13 visibly shows water and wet-meadow rim at500m/noon in the cloud CPU browser.

There were no actual saved village centres within1km of these19 ponds, so that search provides NO actual-house acceptance evidence. A separate nonempty synthetic pond-village fixture checks house/road samples and cereal-triangle vertices/centroids against the same water. Full848PASS/0fail and build passed121.1s256MiB. The first actual audit failed because its300m exterior point exceeded a200m projection; corrected to190m outside the128m pond support and rerun. Evidence: `reports/natural-pond-audit.json`. The generated world has259685placed/43186unplaced settlement slots,85,526,365represented people, not complete100Mplacement. Flood regimes, seepage, groundwater, continuous rim proof, full footprints and visual/performance acceptance remain open.


### Measured relief navigation (2026-10-11)
Saved packaging now includes a bounded, read-only landform inspection: at most64 source candidates per category and33 surface samples each; three spaced hill and mountain inspection destinations. Altitude alone cannot qualify a target: dry finite surface samples must show30–250m hill relief within1km, or at least250m relief within2.5km. These are navigation categories, not exhaustive landform classification, summit detection, or geomorphological proof. Empty targets explicitly mean unmeasured/unselected, not absent terrain. Camera use never creates or moves terrain.

Actual31a needed231 surface samples for six destinations: hill ranges37.76–48.12m, mountain ranges545.98–597.46m. The viewer shows measured extent/count/range and lets users fly there at1x or their chosen exaggeration. Existing saves without metadata remain unchanged. A separate local inspection manifest reuses31a immutable pages rather than regenerating another world. Evidence: reports/landform-inspection-audit.json. Forest-covered gentle hills are visible with10m contours in the cloud CPU diagnostic; this does not resolve overall landscape quality or cold-load latency. The earlier31a settlement totals in the pond paragraph were copied from30a; corrected against31a's saved catalogue to259685placed/43186unplaced and85,526,365represented people. Pond measurements and world ID were already31a.

Full851PASS/0fail, build112core/45globe passed125.4s256MiB. Mountain1 shows rounded snow-covered relief and100m contours atL17; still loading2/2. This is evidence of elevation variation, not plausible rugged mountains, and not a completed local scene.


### Village ground-cover footprint connection
Found a real mismatch: trees/farm parcels used canonical village footprint clearances, but the ground mesh colour still used the entire settlement envelope. Local tiles(radius<=300m) now pass the same bounded clearance into regional classification. Only eligible village-footprints@1 villages are surveyed, existing16-district cap and8MiB compact cache retained; coarse tiles and towns keep explicitly labelled envelope approximation. No buildings, roads, water or saved positions change.

Actual31a village4048:78:277 previously settlement-coloured sample points become57settlement/217arable/3pasture. Village4048:65 becomes54settlement/156arable/52pasture/15woodland. Town4174:0 stays256settlement/21woodland as intended. Clearing the compact cache and regenerating changes0classifications. Cold village preparation6.4–6.6seconds remains a performance cost. Evidence: reports/village-ground-cover-audit.json. This fixes inconsistent land classification, not farmland ownership, irrigation, every village, or completed visual acceptance.

Full852PASS/0fail, build passed123.1s256MiB. Cloud CPU village4048:65 inspected at350m/55degrees/noon; geometry placement remains unchanged. Transitional coarse colours persist until local tiles load; complete scene/performance acceptance remains open.


### Reuse measured ground grade for land cover
A second mismatch was found: paged ground cover classified fields without passing a slope, although the mesh had already measured that slope for lighting. Local meshes now reuse the existing normal to supply grade; point probes reuse their existing derivative calculation. No additional terrain queries, positions or random decisions are introduced. Coarse tiles still do not invent a measured zero slope.

Actual31a:404 dry-grid points each around two villages and one town. Corrected23 arable samples and6pasture samples to woodland on grade>0.12;12woodland samples become exposed ground on grade>0.65. No arable sample remains above0.12 in these finite checks. Actual tile3/17/299/67913:289 classifications applied, identical1156ground/289surface queries,353vertices and0position/coarse-position/normal differences;894colour components changed. A single timing comparison1.62s before/1.55s after is not a benchmark claim. Evidence: reports/land-cover-grade-audit.json. These finite sample rules do not substitute for local agriculture, soil, forestry or continuous slope guarantees.

Full853PASS/0fail and build passed121.9s256MiB. Actual mesh comparison validates the display connection, not only the classifier helper.


### Repeated settlement recipe work
The footprint fix exposed repeated6second generation of the same village for cover, collision and geometry inside one source instance. Reuse serialized immutable recipes keyed by full site input and district, scoped to the already immutable world source. Return new parsed copies, preserve cancellation, and skip retention for oversized entries. Split the previous8MiB compact-settlement budget into6MiB compact footprints +2MiB recipe strings rather than raising the combined retained budget. This is approximate retained-byte accounting, not a total heap guarantee.

Actual31a villages4048:78 and4048:65: cold6.33/6.04s, repeated1.05/1.28ms; after eviction6.0/6.33s. Serialized hashes are identical for cold/repeated/regenerated results. Entries464426/396774estimatedbytes. These isolated repeat-call times do not mean first-load, cross-worker or whole-scene latency is solved. Evidence: reports/settlement-recipe-cache-audit.json. Normal WebGL path was also checked in this cloud browser: explicit WebGL2-unavailable alert; CPU diagnostics remain the available visual path, not GPU-device acceptance.

Final unchanged-code full857PASS/0fail and build129.2s256MiB. Earlier pass during the cancellation edit was not used as the final verification.


### Inspection was still attached to old demonstration data
The placement inspector only found manifest.settlements/featureCharts by upfront index and only understood settlementPlan. Most population-generated villages were absent and their current economy, public parcels, gardens and ponds were invisible to this inspector. Replaced lookup with exact catalogue site/district resolution using the same PagedSource/featureRecipe as the globe. Current economy placement IDs and legacy parcel IDs both resolve. No fallback to a different village. Catalogue-only worlds no longer require upfront generated demo settlements or a full world snapshot merely to inspect one district.

One existing bounded feature worker returns an inspection-only recipe, not a mesh or the entire town. Explicit district-number selection supports large towns without enumerating all districts. Cache reuse, cancellation/page teardown and response identity are preserved. The SVG includes shared roads, oriented buildings, grid-corner parcel outlines, water and reason selection. It shows production dependencies as plans, not stock or proven output. Fixed the long-ID selector's horizontal overflow; unknown district clears stale geometry and can recover.

Cloud UI actual31a village4048:65 shows66building objects/25land-water entries; granary road24m/supply-plan38m. Town4174:0 has7districts:central103buildings/50land-water;district6 has74/44;invalid7rejected,return0restores103/50. Full860PASS/0fail and112core/46globe build128.3s256MiB. Evidence: reports/settlement-inspection-audit.json. This is an honest view into actual data, not additional completed town morphology, regional scenery, production or GPU acceptance.


### Bearing-led village boundary portals
Previously small villages forced connecting roads to cardinal boundary midpoints. New landscape worlds now save deterministic bearing-led boundary portals for eligible non-root single-district villages. Local streets and regional road routing consume the same saved coordinates. Historical saves, root settlements and multi-district towns retain their existing contract. The policy is a bounded layout scenario, not a claim about historical settlement evolution.

Actual new world32a retains the physical base of31a. Region4048 has154sites,152with portals,0moved centres. Three sampled villages each place60/60homes, all saved gates and public accesses connect;792base-water corner samples are dry. Two actual regional roads (24.4km and13.7km) return surveyed-local-route, with endpoint differences below1e-8m. This is finite evidence, not full-road coverage or full-footprint water clearance. Cloud CPU display of4048:78 shows the new layout; grid stair-stepping and limited terrain display remain visible. WebGL2 device acceptance remains unavailable.

Full863PASS/0fail119.9s with256MiB, build113core/46globe. Evidence:reports/village-portal-audit.json. Full city morphology, agricultural systems, rugged mountain landforms, first-load performance and scene plausibility remain unfinished.


### Household approaches, not only primary street smoothing
The actual scene retained numerous grey, right-angled paths. Infill housing always generated two orthogonal turns and left its surface material unspecified. New worlds now explicitly opt into surveyed direct household approaches: test direct and diagonal candidates as well as the existing obstacle-avoiding right-angle fallbacks, rank by length, retain full-width water, grade, reservation and foundation-batter checks, and use compacted earth. Existing saved policies retain their former paths. This does not add a full pedestrian navigation/doorstep model.

A separate bounded postplanning lattice refinement preserves every shared junction and endpoint, allows at most5m lateral deviation/60m shortcut, checks intervening full-width terrain and other street crossings, and samples the resulting elevation every5m. Alone it shortened the three measured village skeletons by only0/1.78/1.78m. Do not attribute the meaningful improvement to this small effect.

With direct household approaches, total road bends above about8degrees change49→15,48→16,31→13 in actual sites4048:65,78,2; total road lengths1701→1493m,1527→1513m,1104→1065m. Each retains60/60homes and connected public destinations. Actual newly packaged34a repeats this capacity, keeps site centres unchanged and has0wet corners in792base-water corner samples. Two town districts4174:0/0 and/6 retain96/96and74/74 but their main morphology and bend counts do not improve: the macro-quarter structure remains a separate gap.

Full867PASS/0fail122.2s256MiB; build114core/46globe. Evidence:reports/household-access-audit.json. Finite corner and route checks are not landscape acceptance or a full-footprint water proof. New village layouts should not be confused with completed city planning.


### Correlated urban block candidate axes
The existing FNV hash converted directly to a fraction made the x/y candidate offsets differ by only about0.117m. In three flat survey towns,80/80noncentral block seeds lay within1m of the diagonal. The advertised two-dimensional variation was effectively one-dimensional. New saved worlds opt into terrain-ranked-block-seeds@2, using an avalanched hash for independent axis proposals. Candidate count4, offset bounds±15m, water/grade scoring, central block and paging contracts are unchanged. This fixes a concrete correlation; it does not replace settlement history with a claim that arbitrary randomness is realistic.

Actual generated35a town4174:0:all7districts retain650/650homes (six96-home districts and one74-home district), central chapel access connected. Cloud placement inspector shows103buildings and42land/water entries in district0 using the actual source. Two adjacent pages still share road identities and boundaries; old policy remains unchanged. Full869PASS/0fail120.9s256MiB; build114core/46globe. Evidence:reports/urban-seed-axis-audit.json. Historical growth, urban edge/land use, full-scene naturalness and GPU-device performance remain open.

### Mountain experiment rejected rather than called complete
A bounded C1 ridge transform of the existing massif band passed5new numerical/restore/paging/bound tests (temporary full suite874PASS), and increased three measured mountain windows' relief. Actual contour maps and the cloud view nevertheless retained broad rounded closed hollows. This is not the drainage-shaped mountain/valley structure required by the goal. The prototype was not adopted, and its source changes were reverted before publication; the production code remains the869-test checkpoint. Report:reports/unadopted-ridge-experiment.json. Do not present the private36-ridges fixture as a supported world or the874temporary test count as shipped progress. Further mountain work needs coherent ridges, valleys and water paths, not repeated amplitude tuning or a claim that more noise completes terrain.


### Shared road material in the ground overlay
The dedicated road mesh used saved compacted-earth material, but the terrain overlay painted every road grey. Geographic feature samples now carry the winning recipe road's optional surfaceMaterial; the ground overlay uses the same earth colour. Unknown/legacy materials retain the previous fallback. No road geometry, physical profile hash or layout is modified.
Actual35a village4048:78 road tile3/21/5824/1080590:431material-bearing samples,605surface queries in both runs,353ground vertices and288overlay vertices. Ground/index arrays identical,0geometry/normal differences and864overlay colour components corrected. Evidence:reports/road-material-world-audit.json. This repairs a data/display disagreement, not landscape completion. Full871PASS/0fail131.8s256MiB and build114core/46globe.


### Planned town block boundaries replace square outer cover
The village footprint connection still left towns with a rectangular district-plus-40m ground clearing, although streets/housing already used town-wide polygons. New worlds opt into planned-block-boundaries@1. Cover and woodland/field rejection now reuse the existing planner's actual block polygons plus a conservative20m gate/plot margin. Vacant block interiors remain urban; this does not insert trees into every unbuilt courtyard. District ownership is inverted arithmetically without enumerating a metropolis. At most8nearby towns,128cached polygons per town and512planner seeds; no household generation is required for town cover. Runtime25 preserves prior saved policies.

Actual35a large town4174:0 was inspected with an explicit in-memory proposed-policy override, not relabelled as a modified saved world:3721points,162square-buffer samples returned to woodland. Across all7districts,5003road samples,658building centres and8727parcel points remain reserved, with0exceptions. Separately, an actual newly generated and published32x16source-grid world2d74c1c49dab6bc9128cf2982927aa39ee0ce439e48548e26e6a7f8a6d53a187 retained the new policy without an override. Its largest town225:0 has346people;50cover samples returned to meadow/woodland,811road samples,76building centres and995parcel points remain reserved. This small-world package validates propagation, not the full-resolution planetary landscape. Evidence:reports/urban-land-edge-audit.json.

Final unchanged-code875PASS/0fail122.8s256MiB, build115core/46globe. Finite point checks are not continuous-footprint or whole-scene visual acceptance. Historical town growth, agricultural capacity/irrigation, realistic mountain drainage, first-load latency and GPU-device verification remain unfinished.


### Do not hide a detail-budget limit behind a loading message
Actual small-world town266:0 at350m/55degrees/noon/1x exposed another misleading status:64MiB mode said only “loading” while the plan was already budget-limited, with121ground tiles above the2pixel target (maximum17.53pixels). Budget limitation now stays visible even when planning/upload work is queued; remaining work is labelled separately. The63loaded geometry chunks in that view include trees and roads and are no longer called63town districts.

Cloud UI confirms the corrected message and chunk label. An explicitly selected128MiB comparison reached nearbyL19/renderedL20 but was still loading; this is not a performance success or a recommendation to increase all users’ memory. The view still has oversized empty block interiors and repeated housing morphology. Full876PASS/0fail126.5s256MiB and build115core/46globe; report:reports/local-detail-status-audit.json.


### Bounded household backland instead of identical tiny rear plots
Actual town views still showed large empty block interiors. New urban sites opt into bounded-backland-gardens@1: try30/24/18/14m rear depth at8m width inside the home's own canonical block, keeping roads, buildings, public/service reservations, sampled dry ground and12%grade limit. No field extends into a neighbor district through a guessed rectangular page bound. First reserve eligible14m household plots; only then expand into remaining space. The first greedy prototype removed88otherwise eligible gardens and was rejected. Old worlds and village gardens remain unchanged. This is declared household land allocation, not invented fertile soil or crop output.

Actual35a seven-district comparative policy override keeps650homes, all building/pad/road data identical. Gardens342→343; area38304→57056m². All15965garden points tested against658buildings are outside their bounds. This is a finite check, not a continuous-water/occupation proof. Separately published32x16worldd103b8885d1bd405b35cb8d61447119eba82563b827f6290942b6676723b7ef9 saves runtime26 and the site policy. Cloud inspector266:0 displays71buildings/52land-water entries, including49actual household gardens. It still has no chapel because the old fixed central chapel orientation/site fails its foundation criterion; that public-siting gap remains.

Full final unchanged-code880PASS/0fail123.0s256MiB and build115core/46globe. Report:reports/urban-backland-garden-audit.json. Separately the128MiB CPU comparison reached idle but remains budget-limited:nearbyL19,max ground bound2.893pixels,279tiles over the2pixel target. It is not scene/performance acceptance.


### Survey civic chapel sites instead of testing one fixed rectangle
Actual town266:0 had no chapel because the old urban path tried one fixed12x24m location/orientation and stopped when its foundation relief exceeded1.2m. New opt-in surveyed-civic-chapel@1 reuses the existing street-led public-site survey inside the central civic block, excluding the market. It tries a civic yard then a compact yard, with up to96candidate sites total. Nave size/orientation must fit the surveyed yard; the1.2m foundation-relief limit is not relaxed. Religious-community policy remains required. Rejected placements stay explicit. A churchyard and independently surveyed connection become actual recipe geometry. Legacy worlds and village sampling remain unchanged.

Actual38 town266:0 comparative site-policy override:69homes retained, chapel0→1, one churchyard,8.01m connected access,0.638m foundation relief,47candidates across two profiles. Actual35a central4174:0 retains96homes and one chapel, gains its yard,9.13m access,0.691m relief,41candidates. Initial broad-yard attempts found no feasible site; the compact-yard alternative is explicit, not reported as a successful broad-yard fit.

Newly published32x16worlddfab22621aeaa3a43172d3d38e09046ccccafb0f7401ca681d797cb0170ad02d saves runtime27 and the new policy. Its actual inspector shows73buildings/53land-water entries for266:0, with chapel, tower and yard. Fixed a trace display bug where an empty facility-survey array hid the civic-site evidence; both traces are now shown. Full unchanged-code882PASS/0fail115.6s256MiB/build115core46globe. Report:reports/urban-civic-chapel-audit.json. This is communal chapel siting, not cathedral/parish history, religion capacity, full landscape naturalness or GPU acceptance.

## Research-led revision, 2026-10-11 (after PR #7 integration)

PR #7 is merged as main `05156cf7f4d2c96a1474fab1614ab5df0b034730`. Its 882-test checkpoint does not complete this plan. The user now explicitly requires published research to guide terrain and local landscape implementation. The following is a method-selection record, not a claim that those methods already run in the viewer.

### Reviewed methods and their limits

- **Génevaux et al., 2013, hydrology-led procedural terrain**: Sections 3–7 and limitations reviewed: grow from supplied outlets, classify drainage, derive watershed crests, then reconstruct terrain and river primitives. Its greedy growth can create unnatural hills and weak plain/mountain transitions; large articulated mountain valleys and downstream splitting are limitations. These are reasons to validate morphology, not assume that a connected graph proves natural terrain. The full method is not implemented. [Author laboratory publication](https://cgvlab.github.io/cgvlab/www/publications/Genevaux13ToG/).
- **Gaillard et al., 2019, Dendry**, Sections 3–5 and limitations: hierarchical branches can be reconstructed locally with deterministic key points; terrain is reconstructed around the branch structure. This is relevant to bounded, repeatable detail generation. The paper also acknowledges regular branch density, repeated calculation and possible segment crossings. Its publicly linked implementation is GPL-3.0; no implementation source is being copied or bundled. A paper-based adaptation still needs its own geometric and hydrological validation. [Author's paper](https://www.mgaillard.fr/content/publications/pdfs/Gaillard19I3D.pdf), [author's repository/license](https://github.com/mgaillard/Noise).
- **Tzathas et al., 2024, analytical erosion**, Sections 4.3–6 and 7.4: terrain height and drainage ordering are coupled. The method includes stored random routing choices, slope correction, multigrid/optimization and hillslope treatment. Its analytical formulation is not an independent per-camera noise function; changing geological time can relocate valleys. Thus it is a candidate for generation-time regional shaping, not a clock-driven runtime update. Sediment deposition and the general nonlinear slope law are not supplied by the method. [Author paper](https://www-sop.inria.fr/reves/Basilic/2024/TGSC24/Analytical_Terrains_EG.pdf).
- **Emilien et al., 2012, villages**, Sections 4–7: incrementally alternate building placement and road connection, update suitability as roads grow, then allocate parcels influenced by frontage, slope and obstacles. This explains a structural weakness in planning the complete street skeleton before actual demand. The paper targets European village examples; its 150 parameters per village type and minute-scale parcel computation are not a suitable default runtime budget here. It does not establish medieval agricultural production or global settlement realism. [Author paper](https://perso.liris.cnrs.fr/egalin/Articles/2012-villages.pdf).
- **Galin et al., 2010, roads**: weighted, direction-sensitive path cost accounts for terrain and obstacles; richer connectivity reduces grid-direction artifacts. Our existing routing can be retained and improved rather than replaced with random bends. [Author paper](https://perso.liris.cnrs.fr/egalin/Articles/2010-roads.pdf).
- **Losasso and Hoppe, 2004, geometry clipmaps**, introduction and limitations: nested cached terrain resolutions, incremental updates and transition regions offer a bounded rendering reference. They do not generate the geological or settlement content. We will retain the current sphere renderer initially; changing render resolution must not change geographic objects. [Author paper](https://hhoppe.com/geomclipmap.pdf).

### Project decisions (our adaptation, not claims from the papers)

1. **Separate geographic generation from display requests.** World seed, generator version, parent catchment and stable geographic coordinates determine content. Viewing direction, request order and eviction do not.
2. **Refine from a connected parent.** Regional outlet IDs, positions, bed levels and parent connections are inputs. A window boundary is not implicitly a sea or lake. A region whose downstream relationship is unknown remains explicitly unresolved.
3. **Prototype connected regions, not a single attractive square.** The first terrain experiment must include one shared drainage structure observed through two neighboring windows. Compare an expanded window and reversed request order; common samples and junctions must agree.
4. **Evaluate two distinct approaches.** Use a graph-led hierarchical construction for stable fine-scale branching, and an analytical/erosion-based regional solve as a morphology reference. Do not stack both blindly or label a simplified probe as a reproduction of either paper.
5. **Do not confuse dry valleys and water.** Terrain generation supplies valleys and divides. A separate water model supplies discharge assumptions, channels, lake level and wetness. Keep actual receiving water levels and channel continuity constraints.
6. **Use the same ground everywhere.** New terrain must reach `global-field-evaluator`, resident and `PagedSource` sampling, water, road fitting, foundation surveys, farm suitability and mesh error bounds. A rendering-only displacement cannot pass acceptance.
7. **Grow local settlement demand against that ground.** Reuse existing portals, road surveys, public-site checks, facility prerequisites and building access. Replace arbitrary empty-block filling with a bounded sequence of purpose-driven sites, links and frontage parcels. Do not delete already accepted households as the paper's corner-conquest example can do.
8. **Keep land-use claims narrow.** Irrigated rice needs a supplied cultural/agricultural regime, water and level control; forest composition needs ecological inputs. European village examples do not authorize putting every crop/facility in every settlement. Research on agriculture/ecology remains to be selected before claiming those systems.

### Concrete implementation/acceptance order

A. A bounded, fixed-parent regional terrain experiment that produces an inspectable heightfield and drainage graph. Record runtime, retained bytes, crossings, drainage endpoints, discontinuities and actual image defects. Reject attractive-but-disconnected output.

B. Connect the accepted evaluator to a NEW generation identity, preserve old saved policies, then inspect two neighboring regions at regional and ground scales. Rendering detail and physical terrain must use identical values.

C. Apply incremental settlement/road and frontage-parcel ideas to valley, hillside and river-crossing settlements. Inspect complete public space, houses, gardens, production yards, outlying agriculture and forest edges together, not only individual objects.

D. Check close/distant return, save/reload and cache eviction; no moved objects, new random shapes or missing physical surfaces. Keep work/cache limits explicit and skip/defer expensive checks when memory is insufficient.

No paper supplies the whole requested product. Numerical tests, publication names and plausible isolated images are supporting evidence only. The acceptance target remains a coherent, useful medieval landscape from planet to local scale.

### Bounded research comparison, 2026-10-11 08:10 UTC

Reproducible, isolated scripts now live in `scripts/experiments/`; no production
source or saved world is changed. `run-relief-comparison.mjs` regenerates the
actual `planet-1` terrain, reads river `river:2156:2285`, and compares two methods
on its 8.192 km window. It writes real input provenance, scalar fields, SVG views
and diagnostics. The six focused checks pass; the 882-test production suite was
not rerun for these isolated experiments.

The graph-led proposal has 151 segments with no sampled crossings or uphill bed
steps; its reconstruction matches sampled bed heights within floating-point
precision. But its region edge differs from the old world by up to 360.03 m.
It cannot be inserted as a seamless replacement. The numerical comparison
preserves edge heights exactly, but does not preserve the actual internal river.
Its fixed-point iteration is not converged, and visible grid-direction artifacts
remain even after the fixed-network objective decreases. Neither is adopted.

These comparisons narrow the implementation problem: all accepted terrain must
share the existing parent's outlet and boundary constraints, not just contain a
plausible isolated drainage tree. The graph's reproducibility test covers one
canonical region viewed in different orders; it does not prove independently
generated neighboring catchments agree. Follow-up is constraint-compatible
regional construction and morphology, before any new runtime terrain policy.
Evidence: `reports/research-relief-2026-10-11.json`. The executable README gives
reproduction commands and the differences from the published algorithms.

### Constraint-compatible follow-up, 2026-10-11 08:35 UTC

The next prototype preserves a boundary collar and the original river's full
bed/bank corridor. It uses compact curve influences and interval-constrained
profiles; the unchanged route across the river bank must also remain downhill.
Four real neighborhoods from one saved planet yield 0, 4, 11 and 1 accepted dry
valleys. The zero-output case is explicitly a no-op, not a generation success.
At the sampled locations, boundary/corridor displacement and uphill bed/connector
steps are zero; rejected uphill bank connections remain rejected. Ten focused
checks pass. This does not establish continuous proofs or neighboring-catchment
compatibility. It is still not adopted into the production sampler or viewer.

The outstanding structural problem is proposal selection: nearest hierarchical
straight branches ignore much of the actual terrain. Acceptance guards can stop
bad proposals, but cannot manufacture useful landforms. The next candidate must
use the actual terrain/catchment to choose its path, with the unchanged boundary
and receiver constraints retained. Existing bounded drainage and channel code
will be examined for reuse before another independent implementation is added.
Evidence: `reports/research-constrained-relief-2026-10-11.json`.

Hnaidi et al. 2010, *Feature based terrain generation using diffusion equation*,
Sections 3–5, was also reviewed as a constraint reconstruction reference:
https://perso.liris.cnrs.fr/eric.galin/Articles/2010-terrain.pdf . It combines
height and gradient constraints via Laplace/gradient relaxation and multigrid;
it is not merely an unconstrained smoothing filter. No implementation of that
solver is claimed here, and its GPU timings do not transfer to this CPU runtime.

### 2026-10-11 08:58 UTC — additional research and terrain-route checkpoint

The literature search continues across independent approaches rather than
selecting one or two papers in advance. Current additional candidates:

- Schott et al. (2024), *Terrain Amplification using Multi-Scale Erosion*,
  DOI 10.1145/3658200, author page https://h-schott.github.io/p/mserosion/.
  Primary abstract and project description checked; full text is not yet read
  (HAL returned a bot page). Promising macro-to-micro erosion/deposition detail;
  GPU implementation and regional boundary consistency need evaluation.
- Paris et al. (2023), *Authoring and Simulating Meandering Rivers*,
  DOI 10.1145/3618350,
  https://aparis69.github.io/public_html/projects/paris2023_Meanders.html.
  Primary abstract checked, full paper not yet available here. Curvature-based
  migration with topographic constraints is a candidate for lowland channels;
  adding arbitrary sine waves is not an implementation of this method.
- Argudo et al. (2025), *Terrain descriptors for landscape synthesis, analysis
  and simulation*, DOI 10.1111/cgf.70080, https://h-schott.github.io/p/desc/.
  Primary abstract checked. Candidate metrics can help distinguish ridge,
  valley, relative height and land-use suitability. It is not itself a generator.
- Holata & Malina (2024), *The location and layout of medieval field systems in
  respect to the sloping and verticality of terrain: from assumptions to evidence*,
  DOI 10.5817/AH2024-2-7,
  https://digilib.phil.muni.cz/sites/default/files/pdf/AH2024-2-07.pdf.
  Primary English abstract checked: 33 Czech abandoned-village field systems
  include slopes exceeding 20 degrees and do not support universal contour-line
  field boundaries. Do not encode "medieval fields must be flat / contour-aligned"
  as a historical law. This regional evidence does not imply universal steep-slope
  suitability, nor does it remove soil, erosion, access and technology costs.
- Chen et al. (2008), *Interactive Procedural Street Modeling*,
  https://www2.cs.uh.edu/~chengu/Publications/streetModeling/street_modeling.html.
  Primary project abstract checked. Tensor-field road guidance is a comparison
  candidate; it does not establish medieval settlement history or household demand.

Already deeper-reviewed alternatives remain hydrology-first terrain (2013),
Dendry (2019), analytical erosion (2024), feature curves (2010), incremental
villages (2012), terrain-cost roads (2010), and clipmap rendering (2004).
No external research source code has been copied or executed.

Implementation: new isolated terrain-cost corridor and rounded-path comparison
with fixed shared endpoints, global monotone height fitting, bounded work and
separate search/validation spacing. Thirteen focused experiment tests pass.
Actual-source report: `reports/research-terrain-routing-2026-10-11.json`.
Two of three actual profiles get lower sampled scores; the third retains direct
routing. Visual inspection still finds corridor-boundary-following artifacts.
A numerically cheaper artificial channel is not an accepted natural river.
Next: topology/crossing checks and terrain/drainage-led alternatives, then
physical sampler integration under a new generator identity only if acceptable.
Existing saved worlds and production main are unchanged by these experiments.

### Google Earth reference / territorial scope (user 2026-10-11 08:59 UTC)

Eight supplied screenshots were viewed. Acceptance reference: the same place
must remain identifiable from continent-scale boundaries and regional labels,
through connected villages/roads, to buildings, yards and minor paths. Woodland
has varying canopy density, clearings and exposed rock. Satellite imagery of
modern settlements is a scale/structural reference, not a mandate to reproduce
modern architecture or present-day national boundaries in a medieval world.
Do not distribute these supplied images in the source repository.

Requested addition: provisional territorial control with stable IDs. Initial
implementation is an optional coarse regional scenario from saved climate and
population: deterministic capitals and connected dry-land access partitions,
fixed world-derived IDs, ocean barriers, explicit unassigned islands. It does
not claim historical states, individual property, or a surveyed local border.
Viewer integration adds a selectable ownership layer and bounded ID labels.
Future accepted generation should persist the scenario alongside the world;
viewing must never advance political time or move borders. Land use, territorial
control, legal ownership and disputed claims must remain distinct concepts.

Territorial checkpoint: actual 8192-cell planet audit gives 24 provisional
territories in about 64 ms, 99,597,867 assigned people out of 100,000,000; 498 dry
cells remain unassigned (no invented sea transport). New climate/population
world packages now save a hashed territories.json alongside their immutable
manifest. The viewer prefers this saved dataset; old worlds can explicitly view
a deterministic provisional scenario without altering their physical snapshot.

Verification disclosure: build imports/syntax pass, 17 focused territory/map/
population tests pass. The first full npm test hit its 180-second wrapper limit;
a sequential, streaming full-suite diagnosis is in progress, not a pass claim.
A local Chromium launch failed on restricted sockets, including the approved
escalated retry. The supported cloud browser could not reach the local preview
server (connection refused). Actual browser acceptance remains unverified;
no screenshot of successful territorial UI has been produced.

Further primary reading: Peytavie et al., *Procedural Riverscapes* (2019),
https://cs.purdue.edu/homes/bbenes/papers/Peytavie19CGF.pdf, sections 3–5 and 7.4.
Terrain-derived drainage networks, spline trajectories and river-type-dependent
cross-sections are relevant alternatives to universal straight capsules. Their
empirical drainage-area-to-flow model and surface-animation primitives are not
a mass-conserving hydrological solver; blind depression filling would conflict
with our explicit lake/unknown-water contracts. Consider topology/geometry
ideas while retaining those contracts. Kapp et al., *Data-driven Authoring of
Large-scale Ecosystems* (2020), https://people.cs.uct.ac.za/~jgain/wp-content/papercite-data/pdf/kapp2020.pdf,
abstract/introduction checked: canopy, undergrowth and forest floor separation
is relevant to the reference screenshots, but its learned canopy model and
source datasets are not present in this project and are not claimed implemented.

09:16 UTC verification update: 19 final focused tests PASS (territory, publication,
map annotations and population). Fixed an availability-list ordering regression
found by the existing test; the original entries keep their order. New-world
territory-save test is bounded to 10,000 scenario population rather than packaging
an unnecessary 100-million-person catalogue. The streaming full suite ended
822 PASS / 14 failures, all in missing saved-example fixtures or files importing
them. This is not a full pass. Original GitHub fixtures are now being restored
with Git blob SHA and size verification; they are not being regenerated to make
tests pass. UI browser verification remains blocked as described above.

09:24 UTC: the author-released MultiScaleErosion shaders were read, not copied
or executed (https://github.com/H-Schott/MultiScaleErosion, erosion.glsl,
thermal.glsl, deposition.glsl). The reference uses iterative weighted neighbour
flow, stream-power lowering, thermal redistribution and deposition stages. It
is a promising multi-scale authoring method, but the supplied implementation
has its own domain/scaling and boundary assumptions; its deposition stage is
not a drop-in proof of sediment mass conservation for our world. Distinguish
physically inspired appearance from our explicit runtime water contracts.

Added an isolated spherical centerline topology audit to the terrain-route
comparison: fixed endpoints, declared confluences, crossing/collinear-overlap
rejection, antimeridian handling, indexed bounded candidate pairs. Fifteen
focused experiment tests pass. Three real profiles / three route variants each
have no detected unregistered centerline crossing. This does not certify bank
width overlap or natural shape, and does not change the non-adoption decision.

09:26 UTC: after restoring the first fixture dependency set, full npm test
completed in 267.9 seconds: 838 PASS / 2 failed test files. Both remaining files
fail at import because demo/reference.snapshot.json was not listed by the demo
manifest. That exact upstream 3.48 MB snapshot is now being restored and hash
verified. The aggregate runner timeout is extended from 180 to 600 seconds for
this slower cloud CPU; concurrency remains one and child heap remains 256 MiB.
No checks have been removed or assertions weakened.

09:34 UTC: the complete fixture check reached 888 PASS / 1 failure; the last
failure needed real-a/real-b manifests and their exact original sample pages.
All 24 remaining files were restored with upstream Git blob SHA and byte-size
verification. The affected globe test file now passes 21/21. Full npm test is
being rerun; this is not yet an aggregate pass.

Additional primary-source comparison: Barnes, Lehman & Mulla (2014),
Priority-Flood, https://rbarnes.org/sci/2014_depressions.pdf,
DOI 10.1016/j.cageo.2013.04.024. Background and algorithm section inspected:
priority-ordered outward-boundary flooding establishes drainage, with a FIFO
optimization for depressions. This is useful for drainage preprocessing, not
permission to erase physically meaningful closed basins or claim water-volume
conservation. Preserve the distinction between a routing surface and ground.
Cortial et al. (2020), Real-Time Hyper-Amplification of Planets,
https://perso.liris.cnrs.fr/apeytavi/website/publication/hal-02967067/,
DOI 10.1007/s00371-020-01923-4: author abstract and released repository README
checked; full paper remains unavailable through HAL's access page. Controlled
subdivision couples landform/hydrosphere detail across scales. Its GPU/Qt
implementation is a research reference, not yet ported or run here. Neither
source has been substituted for actual evaluation on our saved worlds.

Fastscapelib author documentation provides a separate geoscience comparison:
https://fastscapelib.readthedocs.io/en/latest/examples/planetary_py.html
and https://fastscapelib.readthedocs.io/en/latest/guide_eroders.html.
The spherical example uses HEALPix, prescribed uplift, routed drainage and
bedrock incision with an explicit ocean mask. It is not a lake/river/settlement
solution; that example omits hillslope diffusion. The documented C++ library's
erosion terms are limited, and its HEALPix package support is Linux/macOS on
conda-forge. It is a useful future offline benchmark, not a dependency silently
added to the browser application. Braun & Willett (2013),
DOI 10.1016/j.geomorph.2012.10.008, is the underlying implicit stream-power
reference; publisher abstract checked, full article not inspected here.

### Reading the provisional territory layer

「地図レイヤー → 領有」で広域の仮勢力を色分けします。ラベルは固定IDです。
新規生成世界は領有データも保存し、旧世界では保存済みの気候・人口から
同じ規則で算出します。カメラや拡大率は算出に入りません。
境界は広域セル精度です。接近すると精密な境界に変化する機能は未実装です。
この領有は国家・勢力の仮の支配範囲です。既存の畑の ownerId は近隣集落の
農業圏を指す旧フィールドであり、国家ID・地主・法的所有権ではありません。
地主、耕作者、税を受け取る主体、実効支配、対立する領有主張を同一視しません。

09:37 UTC final aggregate checkpoint: full `npm test` PASS 889 / FAIL 0 /
SKIP 0, 211.05 seconds, single worker / 256 MiB child heap. All missing sample
inputs restored byte-identically from main; no fixture regeneration or excluded
tests. Separate research suite PASS 15 / FAIL 0. Build verification PASS
(116 core modules, 47 globe modules). Browser UI acceptance remains blocked;
these checks do not certify visual naturalness or complete the terrain roadmap.

09:42 UTC: added public `territoryAt(scenario, geographicPoint)` so a game or
settlement inspector can resolve the same saved regional ID without generating
buildings or a second political map. The globe point probe and selected village
summary use this read-only lookup. Geographic bounds, longitude wrapping, poles,
missing membership and public exports have eight focused tests passing.

The isolated route experiment now checks 20/40/80 km corridor half-widths while
retaining 2.5 km lateral sample spacing (16,384-cell cap). The first actual river
still hugs the outer limit at 80 km; the second clears the limit at 40 km; the
third keeps the direct candidate. All selected centerlines pass the existing
crossing audit. Seventeen experiment tests pass. This is a negative adoption
result for the first profile, not a reason to expand the search without bound.
Its parent drainage/terrain relationship needs a better model. Production river
positions remain unchanged.

09:43–09:44 UTC scope and verification: the user explicitly keeps territory at
regional scale and prioritizes realistic near-field landscapes with continuous
cross-LOD/world identity. No local land-register expansion is planned. The
read-only regional lookup checkpoint passes full npm test 891/0 (219.02 s),
separate research tests 17/0, and build checks. Browser visual acceptance remains
unverified. Next work is the concrete near-field gap audit against the eight
Earth references and primary terrain/settlement research, followed by fixes.

### 2026-10-11 10:00 UTC — concrete near-field gap audit

The eight Earth references show nested structure: relief and drainage at regional
scale; roads, woodland edges and agricultural patches at village scale; actual
house frontages, yards, small paths and canopy gaps close up. Their modern
architecture/political geography is not copied into the medieval scenario.

Current-source sample: planet-1, generator22/local tributaries enabled, climate
and 100-million-person allocation, no prebuilt settlement recipes, 12 macro
candidates. Canonical world ID 9f77ea6d556fc7ea385502457a7091c8a25adeb7392db867368bbea2fc1f3a74.
Generation took 22.99 seconds / approximately 380 MB observed process RSS at the
recorded checkpoint. Three 97x97 ground/cover windows cover 3.2 km each.

- Two selected lowland windows have only 0.029 m and 0.307 m ground relief.
  Their actual detail ranges are correspondingly small. The local hill band is
  disabled below 30 m and shore attenuation further suppresses the residuals.
  This identifies an implementation/model effect, not missing UI relief alone.
  It does not prove all plains should be hilly or all lowlands share this result.
- The river window has 120.06 m relief, dominated by the broad, straight cut.
  Parent drainage/terrain coupling and landform control are higher priority than
  another noise-amplitude increase or a wider route search corridor.
- A bounded transient incision experiment (19 research tests pass) lowers the
  three windows by at most 0.825 m, 0.0024 m and 0.0439 m. Its comparison images
  do not show the missing structural improvement; it is NOT adopted.
- The checked main standard example manifest has no climate, population,
  landscape or settlement catalogue fields. That saved dataset predates the
  corresponding runtime facilities. Keep old worlds fixed and label missing
  content honestly; source-code presence cannot certify an old sample's scene.
- Existing code already has frontage-aligned houses and patchy woodland options.
  Do not misreport these as absent. Their complete scene integration, macro
  block structure, terrain/field/road interaction and visual acceptance remain
  separate issues; this ground-only diagnostic does not audit all of them.

Evidence: reports/research-nearfield-incision-2026-10-11.json. The input snapshot
was generated separately in cloud diagnostics, not substituted into any saved
user world. Both resident ground and all future LODs must share a versioned
canonical evaluator; a cosmetic height/mesh-only fix is not acceptable.

Publication correction: commit fadc6524 accidentally truncated this document at
90,000 characters during transfer. Commit d63258f restores the complete file;
remote/local full text and Git blob hash were checked (121,778 bytes at repair).
Future transfers require actual-length completion and file-hash verification,
not a guessed character ceiling. Code and saved worlds were unaffected.

10:01 UTC: author-released Cortial shader source inspected (edgeSplit.comp,
faceSplit_river.comp, profiles.comp in Arches-Team/Real-Time-Hyper-Amplification-of-Planets).
It carries terrain and hydrologic attributes through subdivision, including
nearest-river elevation/distance, tectonic elevation/age and landform controls.
It also contains explicitly heuristic profile shaping and documented special
cases. This is evidence for coupled multiscale structure, not proof that copying
its GPU refinement would meet our immutable-world, exact water and CPU budgets.
No author code was copied or executed. The next design must separate stable
world refinement decisions from camera-driven rendering refinement.

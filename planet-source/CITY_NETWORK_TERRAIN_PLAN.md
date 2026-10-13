# Complete settlement scale and local landforms: implementation contract

User request (2026-10-10): finish full large-city districts, industries, routes serving every village, and local mountains/hills/rivers. PR6 is a baseline, not completion.

## Acceptance gates

1. Population allocates every household to an immutable district/lot ID. No silently discarded households beyond a 96-house rendering budget. Each district is independently loadable. Rejected terrain lots report the missing housing; they do not count as completed construction.
2. Primary/secondary/tertiary uses share the existing facility catalogue and source/placement reasons. Industry cannot receive free invented ore/water/legal privileges merely because a template requests a factory. Scenario assumptions must be saved as inputs, separate from surveyed conditions.
3. Every placed village has a stable network membership and either a route to its regional network or an explicit infeasibility result. No 300k×300k search, and no straight road across sea. Inter-region trunks and local access routes are separate scales but use the same IDs and endpoints.
4. Local landforms are actual elevations/water geometry sampled by Core, physics and rendering. Zooming reveals the same fixed terrain. Macro catchments and local water must agree at joins; decorative unrelated river meshes do not satisfy this gate.
5. All generated data is bounded/paged. Repeated visits, reload and different request orders yield identical coordinates and identities. Original saved worlds are not silently regenerated.
6. Actual generated examples and browser observations accompany unit tests. Report missing/infeasible results explicitly, including urban housing capacity, facilities without inputs, isolated components and unresolved water outlets.

## Order

A. District planning and streaming, including shared street connections.
B. Facility demand, resource/source conditions, siting and visible inspection.
C. Hierarchical every-village network and terrain-following route pages.
D. Multiscale landform/water integration, then revalidate siting/routes against it.
E. End-to-end populated world audit, memory, persistence, final full suite and GitHub.

No gate is complete just because types, counts or static labels exist.

## Implemented extension and measured boundary (2026-10-10)

- Every household is assigned to one fixed district/lot. Districts share one settlement coordinate frame so neighboring street endpoints coincide exactly. 96 is a district size, no longer a whole-city cap.
- Building meshes retain all house IDs in coarse and detailed LOD. Demand is bounded to 256 closest feature pages, two concurrent loads, 16 MiB uploaded and 16 MiB retained mesh budgets. A budget is a rendering limit, not removal of distant houses. Regional pages use an 8 MiB estimated-retention LRU per consumer. These are not total-browser limits.
- Additional service plots invoke the existing facility dependency/siting planner. Regional cereal and forest supply are explicit scenario assumptions. No invented ore, potable groundwater or institutional rights are added to force the remaining catalogue to pass.
- Cereal fields are fixed land parcels outside village residential land. Required area follows food requirements and net yield. Cities/towns rely on their regional rural hinterland rather than drawing their entire food demand over neighboring villages. Today's dryness and sampled slope do not prove flood safety or soil suitability.
- Each regional page includes an all-site desired-link tree. Regional roots are joined by a dry, grade-screened source-grid forest, with ocean-separated components explicit. Canonical 20 km trunk sections are independent of view LOD.
- Local road geometry uses the shared physical terrain, direct sampling first, then a bounded grid detour. Streets, foundations and road profiles feed both the render mesh and surface queries. Missing paths remain reported; an unvalidated link is never called a built road.
- New terrain recipes contain 38 km / 8 km / 1.8 km / 8 m wavelength bands. A four-band shore-distance budget preserves water-side classifications without deleting small-scale roughness. Old snapshots retain their original detail method.
- River junction levels now account for upstream local hollows before fitting reaches. One shared node level propagates downstream in topological order within the existing incision budget.

### Actual world audit

Command: `node --max-old-space-size=256 scripts/audit-populated-world.mjs <manifest.json> pop:3843:0`.

Seed `city-landforms-1`, 128×64, requested population 100,000,000, four legacy survey anchors:

- 302,798 requested settlement slots, 287,877 placed, 14,921 unplaced.
- 94,769,987 people placed, 5,230,013 unplaced; no claim of a fully supported requested census.
- 765 region pages, 279,989,158 serialized bytes in the audited package. Later scenario fields can change package size.
- Audited 50,000-person city: 105 districts, 10,000/10,000 houses on its actual generated terrain.
- 416 service buildings: 104 each of carpentry, granary, handmill and warehouse. 319 requested facility placements were rejected. This is not evidence that every industry operates or has sufficient capacity.
- Two incident routes surveyed successfully: approximately 9.68 km and 13.07 km. This sample is not proof of completion of every road in the world.
- Regional road forest: three separate components. 104 river reaches accepted, zero rejected in this example, after the shared-node correction.
- Selected-city audit took 5.66 seconds, 110.5 MiB Node heap at completion, before the direct-road fast path. Neither figure is a browser or peak-memory guarantee.
- Cloud CPU browser displayed multiple contiguous city districts; GPU verification remains unavailable.

### Still open — not a completion report

- Verify all regional and trunk links, including blocked local connections, rather than treating desired links as traversable. Bounded named-policy river and narrow inland-lake crossings are now implemented; sea and unknown water stay excluded.
- Deterministic neighboring-settlement reservations and rural field ownership are implemented. Production capacity, stock and a complete transport-supply simulation remain outside the current static placement model.
- Urban growth morphology, specialized districts beyond the current regular street/service grid, and institution generation remain limited.
- Local roads use finite spacing; unmodeled sub-probe obstacles, earthwork drainage and bridge foundations require additional treatment.
- Save/restore embedding API still requires deferred pages; a legacy synchronous snapshot sampler does not automatically materialize an entire populated planet.
- Final regression/build and broader road audit remain in progress after the 669-test published checkpoint.

### Verified checkpoint before crossing work

669 tests passed / 0 failed; build imported 83 Core modules and syntax-checked 40 globe modules. Cloud CPU browser read `105/105 districts, 10000/10000 houses` for `pop:3843:0` at about 2.1 km altitude, and one nearby route completed its terrain survey. These results cover this checkpoint, not the unimplemented items above.


### Crossing / ownership / connectivity follow-through

- Named-policy river crossings create actual bridge decks, piers and graded approaches using the shared bridge model. Water IDs must name modeled river reaches or explicitly enabled narrow inland lakes; sea and unknown water are refused. Deck/road consistency and input-model beam assessment are checked. Foundations/scour are still explicitly unresolved.
- Road obstacle lookup preserves public street corridors while excluding housing blocks. Canonical geographic neighbor selection replaces camera-dependent neighbor lists. Rural field corners must remain within their ownership catchment.
- Road feature culling now tests the full geographic extent, not just a distant midpoint. Sparse-region long links are split into fixed 20 km sections rather than omitted above a 60 km local survey budget.
- Region 3843 was fully audited: 622 settlements, 621 desired links, 621 successful local surveys, one connected component, approximately 9.43 seconds. Raw outputs and derived graph check: `reports/city-region-3843.json`. This is one complete region, not a full-world certificate.
- Catalogue-only upgrade compared all 287,877 site IDs, coordinates and population values; their SHA-256 stream matched exactly. Evidence: `reports/catalogue-upgrade-stability.json`.
- Actual cloud CPU view of village `pop:3843:25` displayed 60/60 houses and both its local and regional-trunk road as surveyed, after correcting the trunk's settlement entrance metadata.
- Package exports and `POPULATED_WORLD_API.md` describe game embedding without a renderer or DOM. Full-world deferred pages are intentionally not loaded by the legacy synchronous snapshot API.
- Existing-world catalogue update is available when its runtime contract is older. It writes a separate saved version. New hills/mountains require a new terrain generation; upgrading a catalogue never secretly changes old terrain.

### Broader-audit corrections and current city functions

The initial all-region pass found 18 unresolved links (19 individual sections) by region 231. All 19 failed sections now pass a canonical paged-source recheck after the following corrections: bounded approach-fill grade envelopes, dry-bank abutments, route search for a shorter crossing, an approximately isotropic search grid, a bounded 10 km detour fallback, and deterministic dry section anchors / alternate existing street gates. This is a repair sample, not the final global audit. Narrow lake crossings use the same 160 m total crossing and 15 m water-depth limits; ocean crossings remain forbidden. The static pier/beam model is not a foundation or hydraulic certificate.

A new independent all-region run uses `city-landforms-qa4` and implementation digests on checkpoints. Changing the implementation invalidates resume, instead of silently mixing test generations. All 765 regions and the inter-region trunks remain under inspection.

The medieval communal scenario now explicitly generates local-government / religious-community institutions, market rights for towns and literacy institutions for cities. These are named fictional-world cultural inputs, not deductions from physical terrain. The central district receives public functions; designated craft quarters request workshops; ordinary residential quarters no longer duplicate four service buildings everywhere. Missing ore, yarn, potable water and disposal remain explicit rejection reasons, not invented resources.

Actual updated 50,000-person city: 105 districts, 10,000/10,000 houses, 71 placed facilities across eight types: carpenter 14, chapel 1, granary 26, hall 1, handmill 20, market 1, school 1, warehouse 7. There are 80 unfulfilled workshop requests. Evidence: `reports/city-districts-current.json`. The previous 416-facility count is historical, not the current city result.

A riverbank village checked in the CPU browser had 14 surveyed nearby roads and no unresolved displayed routes, but only 12/60 homes could occupy its fixed district footprint. The remaining 48 are disclosed as unsuitable lots. This demonstrates why all allocated census population must not be described as housed. Further terrain-adaptive residential placement is still required for such sites.

Validation after these corrections: full suite 685 PASS / 0 fail; build imports and all 40 globe module syntax checks passed. Full-world road acceptance remains in progress.

### Full-display memory and broad-lake corrections

- Actual updated CPU browser: 105/105 city districts, 10,000/10,000 homes, 8.6 MiB building/road geometry at approximately 3.1 km altitude. Distant road meshes now use a bounded lower-detail tessellation; incoming residential districts can evict lower-priority road geometry instead of being permanently starved by the 16 MiB feature budget. Physical road profiles and positions do not change with LOD.
- Fixed the published v2 crossing policy adapter: both supported policy revisions now reach the actual paged bridge builder. Added an entry-path regression test, not only a Core test.
- Large inland lakes are bypassed before canonical local sections are created. Previously, a long straight line could create section endpoints in the middle of a lake, making every local section impossible. Region 3716's two actual broad-lake failures now have fully surveyed bypasses (62 and 38 local sections). Coarse corridors remain subject to local physical checks.
- A final failure-only search permits shallow-angle approaches to steep banks; ordinary successful routes retain the earlier search. Cost lower bounds skip edges that cannot improve the current route.
- Artificial section boundaries inside reserved housing now choose a shared open point, not an inaccessible narrow internal street. Both failed sections of `road:pop:3723:327|pop:3723:329` now pass canonical paged rechecks.
- Initial qa4 whole-world survey remains running; qa5/qa6 share the same upgraded world identity. Incremental acceptance explicitly distinguishes inherited unchanged successful routes from changed/previously failed routes executed again. Terrain identity and every settlement's position/population/kind must match. This reuse applies to the documented failure-only routing extension, not arbitrary future algorithm changes.
- Latest completed full regression at this checkpoint: 691 PASS / 0 fail. Build imports and all 40 globe syntax checks passed. No full-world completion claim yet.

### Terrain-adaptive housing follow-through (runtime 5)

- The riverbank village above now houses 60/60 households, including 48 deterministic infill lots. Existing 12 homes retain identical IDs and coordinates. Candidate lots remain inside the already reserved district, exclude water, neighboring ownership, other buildings and service plots, and require a dry, grade-checked alley to an existing street.
- The runtime policy is opt-in on newly published catalogues; existing saved worlds do not silently move buildings. Catalogue update qa6 → qa7 retains every external-road input, terrain/water page content and settlement reservation. `reports/housing-upgrade-road-equivalence.json` records that comparison separately; it does not relabel the original route audit.
- `reports/housing-infill-acceptance.json` uses the actual canonical PagedSource with neighboring settlement reservations, checks all existing homes unchanged, no building overlaps and identical fresh reload. The cloud CPU browser also reports 1/1 district and 60/60 homes. This is a representative village acceptance, not a guarantee that all requested population fits every terrain.
- Full suite: 693 PASS / 0 fail. Build verification passed. All 765 regional audits are complete (287,112 links, zero unresolved after 27 changed/failed-link rechecks and 287,085 explicitly inherited unchanged successes). The 766 inter-region trunk survey remains running.

### Completed external world-road acceptance

All 765 regional pages and all 766 trunks are now accounted for: 287,881 nodes (287,877 census sites plus four legacy anchors), 287,878 accepted links, zero unresolved links and zero isolated nodes. The three planned dryland components remain three connected road components; no ocean-crossing road is invented. Total surveyed route length is approximately 4,336,519 km, with 325 bridge structures. See `reports/world-road-acceptance.json` and `scripts/summarize-world-roads.mjs`.

The regional evidence explicitly reuses 287,085 unchanged baseline successes and executes 27 changed/previously failed links anew. All 766 trunks were freshly executed through the canonical paged source. This is external connectivity, not universal internal street reachability or foundation/hydraulic certification. The housing-only successor world has a separate route-input equivalence receipt.

### Internal access sample acceptance

`reports/settlement-access-sample.json` covers 30 actual settlements / 134 districts / 12,668 homes. This includes every district of the 50,000-person city. Every inspected district's street centerlines form one connected component; matching actual street endpoints join the city's 105 districts into one component. No inspected building lacked an exterior-to-street path under a 60 m limit, 2 m dry-ground samples, 30% maximum pedestrian grade and other-building exclusion. This is a pedestrian finite-survey sample, not certification of all 287,877 settlements, vehicle access, every obstacle or street grade. Reproduce with `node scripts/audit-settlement-access.mjs <manifest> [city-id]`.

Current requested feature implementation and its bounded acceptance are now recorded. Remaining product-level work is near-ground loading/performance on real GPU hardware, additional terrain/site diversity and richer resource/production modeling; these are not covered by a zero-failure external-road graph.

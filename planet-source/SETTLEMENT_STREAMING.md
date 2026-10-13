# Current extension

See CITY_NETWORK_TERRAIN_PLAN.md for the ongoing full-district, facility, agricultural land, hierarchical road and multiscale-relief implementation. The measurements below are the earlier PR6 baseline, not the latest capacity or cache settings.

# Population-sited settlements and demand-built residential layouts

## What changed

- Left drag grabs the ground: a right/down pointer motion moves the ground right/down. Tests project a fixed ground marker at four camera headings, rather than merely asserting camera longitude signs.
- The old maximum of 32 applies only to the up-front, expensive legacy detailed-survey examples. It no longer represents the number of inhabited locations in a generated world.
- Population's regional village/town/city allocations now produce immutable positions and IDs. Pages are saved by source region; one page is bounded to 2,048 siting attempts.
- Water, local grade, and proximity to existing detailed examples reject unsuitable positions. Rejected people and slots remain explicitly unplaced. No claim that 100% of the requested population has been sited.
- Global labels show regional representatives. Closer views load regional pages. There are at most 64 decluttered labels and 128 visible-place choices, not one DOM element per settlement.
- Approaching a placed settlement generates its residential layout. The mesh and terrain foundation use the same `createSettlementLayout` function and `createGlobeFeatureChart`. Leaving/revisiting does not move buildings.

## Existing worlds

After pulling the code, restart `npm start`. In a world with climate/population data, choose **この保存世界に集落配置を追加**, then open the generated-world link. This creates another saved version; the original terrain, detailed settlements and saved files are not overwritten. A world without population data must first be generated with the climate/population generation UI.

CLI equivalent:

```sh
node --max-old-space-size=256 scripts/populate-saved-world.mjs path/to/manifest.json examples/planet/seeds/new-directory
```

New seed generations automatically include the catalogue. `先に詳細検証する集落数` and `広域幹線の拠点数` are NOT total world settlement count.

## Measured cost (cloud CPU, one example; not a universal bound)

Existing seed `integrated-climate-1`, 128×64 source cells, population scenario 100 million:

- Requested settlement slots: 303,033
- Placed: 288,529
- Unplaced: 14,504
- People assigned to placed sites: 94,769,556
- People not assigned to a placed site: 5,230,444
- Regional pages: 889
- Serialized pages: 66,059,960 bytes, stored on disk, not loaded together
- Siting and writing these pages: 7.61 seconds (excludes original terrain generation and full publication)
- Node heap at the end of that measurement: 119.6 MiB; this is not a peak-memory measurement
- Demand layout for `pop:3005:0`: 96 houses, approximately 31 ms including required field loads through a local-file fetcher; browser/network timings differ

Thus the former 32-site limit was an architectural/eager-generation restriction, not evidence that a planet can support only 32 settlements.

## Memory and persistence

- Generation child heap limit: 256 MiB; generation queue remains one child at a time.
- Regional page cache (baseline): 2 MiB estimated retained bytes per consumer, with LRU eviction. Consumers include labels, active feature rendering and existing terrain workers; this is NOT a whole-browser RAM limit.
- At most two closest settlements have feature meshes uploaded concurrently. Feature upload/cache budgets remain 1 MiB each. Distant settlements retain positions, not meshes.
- Existing terrain streaming budget remains enforced separately.
- IDs derive from region and slot, positions from base-world identity and a versioned method. They do not depend on camera, query order, cache eviction or which other slots succeed.
- Pages carry byte counts and SHA-256. World snapshot identity includes catalogue metadata and hashes. Keep the whole published package, including the regional pages, when copying a world.
- A snapshot does not embed every regional page or every generated building. Embedders load the required page and use the exported core layout function; the old synchronous `restorePlanetWorld().sampleAt` still covers its explicitly saved recipes, not automatically every deferred catalogue layout.

## Baseline limits (superseded where the extension explicitly verifies replacements)

This change is an initial scalable population-to-location-to-residential-layout connection, NOT a finished medieval settlement/economy generator.

- A generated neighbourhood represents at most 96 households, using a provisional five-person household assumption. Normal small villages can fit; towns/cities are explicitly incomplete. `layoutStatus` reports requested and placed houses and represented population. It does not claim a 50,000-person city is represented by 96 houses.
- Layout is a simple residential street grid. It does not yet reuse the richer institution/industry planning rules from `settlement-plan` and `village-economy`.
- Local wet/steep lots can reduce even a village's actual housing count. No fabricated bridge is inserted when a street meets water.
- No new inter-settlement roads for all 288,529 sites. The old bounded macro-route planning remains a separate sparse network. Hierarchical roads and connections to every village remain to be implemented.
- Source-region populations are agricultural scenario estimates. Real soils, potable water, urban economies, resource access, political history and local flood hazards are not fully represented.
- Up-front detailed legacy examples remain additional survey anchors, not additional census population. Siting excludes their immediate surroundings to prevent overlapping layouts.
- Cloud visual checks use the software renderer; GPU live verification is unavailable in this cloud browser.

## Verification

- 655 tests passed / 0 failed in the final full-suite run. Build verification passed: 77 Core modules and 39 globe modules.
- Actual browser: upgraded an existing saved world through the new button, opened the resulting world, selected `pop:3005:0`, and saw its generated houses/streets. CPU renderer.
- Actual right/down mouse drag: the fixed settlement label and ground moved right/down. Camera latitude rose and longitude fell, as required by grab navigation.
- Real paged-source recipe for `pop:3005:0` exactly matched Core generation; its sampled foundation returned the same building ID and base elevation as rendering.
- Automated checks include fixed IDs, rejection accounting, partial-city disclosure, regional file corruption rejection, byte-bounded page cache, Core/paged agreement, revisit regeneration, and upgrade path/symlink containment.

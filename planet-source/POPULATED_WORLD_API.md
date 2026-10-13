# Using a populated saved world in another game

The source is dependency-free ESM. A saved world consists of its manifest, immutable snapshot and referenced region/terrain pages. Keep all referenced files together. Generated worlds are not bundled into the source checkout.

## Canonical deferred terrain / collision queries

`PagedSource` does not need a canvas, renderer, DOM or GPU. Supply `fetch` in a browser, or an adapter returning `text()` and `arrayBuffer()` in a native/Node host.

```js
import { PagedSource } from 'minimal-world-continuous-terrain-adapter/paged-world';
import { sphereBasis } from './src/core/spherical.mjs';

const source = new PagedSource(manifest, manifestURL, fetcher);
const point = {latDeg: 5.460198, lonDeg: 8.491298};
const radius = manifest.base.frame.radiusM;
await source.prepareSettlements({center:sphereBasis(point).up, angular:500/radius});
await source.enableFeaturesAt(point);
const surface = await source.ready(() => source.sample(point.latDeg,point.lonDeg));
// surface: physical ground, water, building ID and road/deck surface.
// Height exaggeration is a renderer setting, not part of these values.
```

For a larger moving actor, prepare a bounded neighborhood and query the support points, rather than loading a continent. Cache eviction changes which data is resident, never the canonical coordinates. Do not assume an unknown/unloaded ground height is zero.

Use `source.settlementPages.getSite('pop:3843:25')` to resolve a stable settlement ID. `source.featureRecipe(descriptor)` supplies the exact saved-input-derived district, field or road recipe used by the viewer. Its structured status retains failed lots, missing industrial inputs and blocked routes.

## Pure planning entry points

Package exports expose district planning, layout, agricultural allocation, local route/crossing construction, and regional road connectivity. `createSettlementLayout(base, site, {districtIndex, nearbySettlements})` must receive the same canonical neighboring settlements when enforcing land reservations. Do not choose neighbors based on camera visibility. The paged source resolves them from fixed geographic bounds.

A 50,000-person city is 105 demand-loadable districts under the explicit five-person-household / 96-household-district assumptions. Calling only district zero does not create the entire city. `planSettlementDistricts` describes all districts without allocating their geometry.

## Assumptions and limits

- Regional food/woodland supplies are scenario inputs, not current inventory or a production simulation.
- River bridges use the named fictional timber/load policy. Their deck and piers are geometry and physical road surfaces; foundation bearing, scour and hydraulic obstruction are not certified.
- Finite road surveys reject unresolved paths rather than creating roads through sea or cliffs. Regional source-grid connectivity alone is not proof of a locally traversable connection.
- Legacy `restorePlanetWorld().sampleAt()` remains synchronous over explicitly saved recipes. It does not implicitly read every deferred population page. Use the asynchronous paged source for the inhabited world.
- Separate consumers have separate bounded caches. Their configured limits do not equal whole-process or whole-browser RAM.

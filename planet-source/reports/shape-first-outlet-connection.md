# Shape-first outlet connection

The regional draft can connect its authored outlet to a real saved-planet river instead of terminating at its rectangular edge.

## Scope and identity

- Core: `src/core/shape-first-outlet-connection.mjs`
- Serializable descriptor: `shape-first-outlet-connection@1`. Contains absolute outlet/receiver cross sections, saved receiver ID/profile point, regional extent and route recipe. Its SHA-256 identity changes with geometry or datum.
- Receiver search scans existing coarse river profile points only, limited to 30 km by default, with a hard 100 km ceiling. The point must be downstream-facing and outside the entire region plus its transition collar and a safety margin.
- Geometry is designed first. A cubic corridor matches approach directions. If it would cross the authored region, a bounded six-node exterior visibility graph and rounded 500 m perimeter route preserve the native shape. Sampling is capped at 512 vertices and 100 km.
- Water levels decline monotonically to the saved receiving datum. Ground and wet widths use the same path and cross-section field as rendered water geometry. The connector applies after terrain collar blending.
- Its last few metres overlap verified existing wet river, blend to its actual sampled bed/water and leave the receiver authoritative. No sink or extra static lake is introduced.

## Actual saved-world receiver

For the bundled source A at the default geographic placement, receiver `river:2640:2769`, profile point 45, is at latitude 30.826437875204128°, longitude −132.04839511275225°. Its saved and sampled water level is 556.0602967784469 m and water depth is 2.213007565979904 m. The straight distance from the authored outlet is approximately 9.58 km. Point 44 was excluded because it lies inside the terrain transition collar.

## Verification

`node --test test/shape-first-outlet-connection.test.mjs` passes 6 tests:

1. Continuous wet bed and downstream-monotone datum, exact unchanged exterior.
2. Gap-free receiving-water overlap through the terminal blend.
3. Stable reload identity and conservative interval bounds that converge at fine scale.
4. Real saved receiver identification beyond the full collar, with bounded-search rejection.
5. Entire route and terminal overlap against actual saved `PagedSource` samples.
6. North, south, east and west outlet geometry stays outside the authored rectangle, including exterior route fallbacks.

## Honest limits

This establishes designed geometric and sampled water continuity. Regional supply is provisional. It does not merge regional discharge into the saved planet's global runoff ledger or prove the receiver's hydraulic capacity, transport response or mass balance. No storage-balance claim is made. The original saved world remains unchanged outside the draft footprint.

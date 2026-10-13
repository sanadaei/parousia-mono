# Shape-first sphere integration verification

## Actual runtime

`src/globe/index.html?terrain=shape-first` uses the existing globe application, spherical terrain mesh, paged provider, worker pipeline, and camera ground queries. The companion `terrain=shape-first-inspect` remains a separate planar inspection view.

The source field is preserved unchanged. The normal sphere field adds an explicitly designed channel stage, with ground, water elevation, wet depth, and camera support derived from the same evaluator. Design widths/depths are provisional supply-scaled choices, not hydraulic certification. Bright 48 m river symbols are a separate drawing convention and can be disabled with `sfSymbols=off`.

A bounded exterior terrain blend connects the selected rectangle to the saved planet. A separately designed outlet channel connects to a verified wet saved river beyond that blend. The added supply is not propagated through a global receiving-flow simulation.

## Automated checks

The dedicated provider suite covers:

- Separate stable draft identity and unchanged saved-world manifest
- Native coordinates, spherical projection, dateline placement, and uniform elevation offset
- Ground and camera agreement
- Canonical sphere mesh vertices and symbol geometry
- Designed wet ground/water/camera and exact-width water strips
- Explicit below-sea placement consistently represented as water
- A verified receiving river, wet connector centerline, and exact unchanged receiver endpoint
- Seed-generated fields using the same runtime

The final targeted provider/channel/legacy-sample run passed 20 tests. Its log is `sphere-channel-tests.log`. Earlier globe regression coverage passed 141 tests before outlet integration; the final aggregate suite is reported separately.

Additional actual-provider connector checks:

| Source | Elevation offset (m) | Designed route (m) | Dry route centers |
|---|---:|---:|---:|
| Saved A | 491.9507129474463 | 9740.416168999414 | 0 |
| qa-region-20261013 | 522.2637058906604 | 12634.346246781179 | 0 |
| 42 | 473.2197916151156 | 13262.03849748088 | 0 |
| another-region | 504.60606998687706 | 10708.72669220917 | 0 |

All used existing `river:2640:2769`, profile point 45. At its endpoint, the draft and unchanged legacy provider returned identical ground and water elevations.

## Browser evidence and limitations

The browser environment lacked WebGL2. Visual validation therefore used the application's explicitly labeled CPU diagnostic renderer, not a verified GPU rendering run. Normal controls reached the source river, regional outlet, connector midpoint, and existing receiving river. Source switching and pinned placement reload were exercised.

The final browser receiving-point probe reported ground 553.847289 m and water depth 2.213008 m. Nearfield physical water was continuous with river symbols disabled.

Remaining limitations:

- A settled seed-42 nearfield CPU view used 326 visible tiles, maximum LOD 27, and about 55.2 MiB. The scene completed, but refinement efficiency still needs improvement.
- Small dark shoreline/bank-edge pixels remain in CPU diagnostic screenshots. These are not a claim of flawless GPU rendering or natural-terrain visual acceptance.
- The probe's existing interior label says it refers to the original shape even where the explicitly described post-shape channel stage modifies the bed. Interpret the reported numeric ground as the selected shape plus designed channels, not the unmodified candidate array.
- No claim is made of hydraulic equilibrium, flood capacity, sediment transport, global water balance, or receiving-flow response.

## Stable reload and export

The current model versions are `shape-first-sphere@2` and `shape-first-designed-channels@2`. The draft identity binds source, native design metadata, water annotations, parent world, projection, offset, transition, and complete outlet specification. The URL additionally pins a SHA-256 of the connector specification and routed geometry. Version, parent, and connection mismatches fail explicitly.

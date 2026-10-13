# Next local 2× layer: experimental, not adopted

The explicit experiment CLI is:

```sh
node --max-old-space-size=256 scripts/experiments/review-next-local-layer.mjs \
  /path/to/selected/fine-local-layer.json /tmp/next-local-review
node --max-old-space-size=256 scripts/experiments/review-next-local-layer.mjs \
  /path/to/selected/fine-local-layer.json /tmp/next-local-review --reload
node --test test/next-local-layer.test.mjs test/fine-local-layer.test.mjs
```

The CLI never selects a crop for its appearance. It enumerates all aligned
36×26-parent-interval rectangles in fixed row-major order and stops at the first
positive-import, positive-local-supply, non-reentrant, single-outlet cut.
For the selected 55.297×76.351 m parent this is x=117, y=0. Its physical footprint
is 1990.70456×1985.13892 m. One adjacent 2× step gives 73×53 points at
27.648674×38.175748 m. A **new** versioned 27.5 m native generated source supplies
quarter-strength anchored residuals. The previous 55 m native source cannot
support this step and is not reused as finer evidence. Neither source is a DEM.

The 2026-10-12 candidate preserves all 999 parent anchors and 69 imported source
identities, volumes and exact nodes. Every crossing is represented, all outgoing
external destinations remain unchanged, and the sole outlet identity, location
and level remain exact. Export delta is floating-point residual only (relative
6.27e-16). Source replay and a separate fresh-process read-only reload pass.
Its atomic record is 1,386,148 bytes within the unchanged 16 MiB limit. Actual
new residual occurs at 2,870 points, RMS 0.23734 m; no excavation is applied.

## Separate gates, not a single conservation claim

- **Accounting/continuity:** pass for the bounded experiment.
- **Routing-correction screen:** candidate minimum-head maximum 8.47701 m,
  parent preserved graph 8.20775 m, equal-resolution interpolation 8.17231 m.
  The explicit screen allows at most max(0.5 m, 10%) above the smaller baseline.
  Passing this screen alone never permits adoption or certifies a physical river.
- **Fixed-endpoint dry-bed feasibility:** FAIL. Of 69 positive inlet source IDs
  at 58 nodes, 43 IDs at 41 nodes lie below the fixed outlet ground and required
  level of 44.26281144 m. They carry 13,605,843.77 m³/year. The worst unavoidable
  endpoint rise is 8.17231161 m. No rerouting, finer noise, or intermediate
  excavation can make a dry nonascending bed connect those fixed endpoints.
- **Hydraulic feasibility:** UNKNOWN. Inlet water stages, available energy,
  backwater/storage and hydraulic geometry are not supplied. The deficit is a
  necessary head bound, not an invented water depth or proof of viable backwater.
- **Independent all-open terrain screen:** FAIL. Maximum fill rises from 1.1810
  to 1.4492 m, positive-fill fraction from 4.50% to 11.32%, and interior nodes
  without a lower D8 neighbor from 1.26% to 3.92%. This ignores inherited ports
  deliberately and is not interchangeable with constrained routing correction.

The reusable fixed-endpoint helper also reports the original selected parent's
4.21952 m imported-endpoint contradiction. This is an inherited model-contract
problem, not evidence that another amplitude tuning pass will repair it.
Progress requires either an explicitly revised upstream terrain/outlet contract
or an explicit, independently tested hydraulic/backwater/storage model. Existing
adopted points and ledgers must not silently move to conceal the contradiction.

`experiment-status.json` and `summary.json` are the decision-bearing reports;
the candidate is **experimental only, not world-adopted**. The reused generic
`fine-local-layer.json` field `adopted-boundary-preserving-detail` describes its
unchanged inherited boundary budget, not approval of the new terrain's realism
or a new global-world adoption. No default/core algorithm or globe renderer is
switched. The compact reproducible same-scale USGS comparison is in
`scripts/experiments/next-layer-reference/`; it references the retained source
DEM without duplicating it. Full generated experiment/save artifacts stay
outside the repository.

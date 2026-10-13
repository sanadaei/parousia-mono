# Post-shape provisional water annotation

This experiment accepts the chosen terrain and designed river tree unchanged, then attaches a transparent supply explanation. It does not choose terrain from budget constraints, reference old ledgers, adjust river paths, or certify hydrology.

Run with Node 22+, no additional JS dependencies:

```sh
node fit-river-water.mjs candidate.json terrain.json scenario.json output-directory
node --test fit-river-water.test.mjs
```

`candidate.json` uses north-first heights and southward Y; `terrain.json` supplies matching native south-first heights and northward Y river metadata. Every river requires a unique ID, parent ID or null, and `direction: "downstream_to_upstream"`. Matching heights and geometry are checked before annotation. The candidate and native source data are SHA-256 hashed before and after; neither is modified. The CLI writes only `water-annotation.json` and `water-preview.svg`.

Example scenario (synthetic demonstration only):

```json
{
  "kind": "synthetic-demonstration",
  "name": "Illustrative uniform net runoff, no external supply",
  "runoffMmPerYear": 400,
  "externalInputs": []
}
```

Optional external supply entries require `name`, an existing `riverId`, and nonnegative `m3PerSecond`, for example `{"name":"fictional upstream spring","riverId":"western_fork","m3PerSecond":0.1}`. These enter the named river's uppermost segment and propagate downstream. This is explicit hypothetical supply, not evidence that a real spring exists. No value is calibrated to an earlier ledger.

## Accounting and visualization

- Partition the exact rectangular footprint into `(columns-1)*(rows-1)` cells. Allocate each cell once to the nearest designed river segment in metric XY, using the cell centre. Ties use river input order then segment order. This is a provisional nearest-path catchment assignment, **not a topographically validated watershed**.
- Convert net runoff to conceptual annual-mean flow using cell area, mm-to-m, and a 365.25-day year. It is net supply, not precipitation requiring a second runoff coefficient.
- Accumulate each path from its upstream end toward its downstream end. Add tributary outlet flow at its nearest parent confluence segment; reject gaps over 1 cm. Outputs retain per-segment flow, so parent headwaters do not carry the entire outlet total.
- Sum all root outlets and compare against local runoff plus named external inputs. Cycles, duplicate or missing IDs, negative/nonfinite inputs, disconnected joins, mismatched source geometry and overflow are rejected.
- Width is `0.6 + 5.4 * sqrt(segmentFlow / largestOutletFlow)` display pixels. It shows relative conceptual supply only, never hydraulic channel width. Zero-supply lines remain minimally visible.

## Selected A demonstration

40 rivers, 20,480 allocated cells, 86.467284 km². Synthetic 400 mm/year net runoff with no external inputs gives 1.0959931577437232 m³/s at the main outlet. Floating-point closure residual: −1.33e−15 m³/s. Original height hash: `2f1fea3f5c4d3d2182b5604c835faa568f75dcfc906f1b9bc16eda04d7de7db6`; river-geometry hash: `7eca764b8b205c72bb8688b1dded63110af0c80a062913a303462e85eb2292a5`. Before/after hashes are identical.

Assignment ignores slopes, divides, depressions and groundwater. There is no seasonal dynamics, storage, transmission loss, hydraulic capacity, erosion or flood prediction. Inputs and confluences are quantized to existing segments. Closure verifies arithmetic only. Existing global adopted ledgers and barriers are untouched.

## Repository reproduction

From the repository root:

```sh
node scripts/experiments/shape-first/fit-river-water.mjs \
  fixtures/shape-first/river-first-candidate.json \
  fixtures/shape-first/river-first-terrain.json \
  scripts/experiments/shape-first/synthetic-water-scenario.json \
  reports/shape-first-water
node --test scripts/experiments/shape-first/fit-river-water.test.mjs
```

The native fixture retains source heights, designed beds and river IDs/parent metadata together (~333 KB), allowing exact source consistency checks without an external workspace dependency. `water-preview.svg` is the dependency-free CLI rendering. `water-preview.png` is the separately rendered hillshade review image of the same segment weights.

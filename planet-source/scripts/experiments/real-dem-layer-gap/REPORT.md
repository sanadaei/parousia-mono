# Real DEM layer-scale gap benchmark

## Decision
Use adjacent **2× layers as the provisional default**. Treat4× as an explicitly evaluated experiment with genuine fine terrain and adequate outlet boundary context. This test does not support8× as a general-purpose transition. This is a conservative engineering choice from one region, not a universal validated maximum.

Select the **joint fine-terrain solve with weak inherited-destination preference (0.15)** for further investigation. It preserves nearly all direct fine-DEM routing while avoiding extra head correction caused by hard masks. Changed downstream budgets must be reconciled before committing a context. This candidate does not solve missing boundary exits, physical rivers, depression hydrology, or seamless independently generated tiles.

## Controlled design
- Source: NOAA NCEI ETOPO2022 15 arcsecond terrain. Native source DEM values, not interpolated coarse elevations, form every fine target. ETOPO itself is a compiled elevation product; these are not claimed to be independent field measurements.
- Five predetermined65×65 windows: NW,NE,SW,SE and center of bundled121×121 source domain. They overlap and are not independent samples. No outcome-based crop selection.
- Every crop and factor has21.597×29.652km extent and337.452×463.312m fine spacing. Parent grids33×33,17×17,9×9 produce adjacent gaps2,4,8. Exact latitudes, longitudes, source hashes and grid definitions are bundled.
- Parent elevations are nested native-source decimations. Coarse bilinear interpolation is an explicit **no-new-information control**, never the fine truth. Decimation rather than coarse block averaging was chosen to retain exact parent anchors; aggregation sensitivity remains untested.
- Compare all methods at each gap with identical fine elevations where indicated, inherited endpoint locations/levels, and local source supplies. Endpoint density changes across gaps, so a separate fully open fine-boundary reference measures that confound.
- Reference routing is the same deterministic priority-flood/steepest-descent solver on the actual fine DEM. It is an algorithmic terrain reference, not observed river validation. Joint solve agreement with that reference is tautological; the nontrivial tests concern inheritance restrictions, missing terrain information, source budget changes, and boundary endpoints.
- Imported original core is commit43d0afaa9e18aff36ca8605cc77ab3881f59276b. Only the separately named experimental baseline copy extends the factor guard4→8. Official original file is unchanged. Candidate implementation is a separate local snapshot.

## Main results
Mean across five crops. Interior destination and maximum added correction exclude4 fine-node boundary rings (~1.35km east-west,1.85km north-south). Corridors use upstream area≥5km² and agreement within one fine-grid cell; all-domain corridor results include edges. Fill is routing-head correction, never excavation or physical water depth.

| Gap | Fine-data missing in interpolated control (RMSE m) | Hard-mask corridor recall | Interpolation-only corridor recall | Soft0.15 corridor recall | Soft0.15 interior destination agreement | Hard-mask worst added head m | Soft0.15 volume reassigned |
|---|---:|---:|---:|---:|---:|---:|---:|
| 2× | 16.2 | 93.7% | 86.8% | 99.9% | 99.0% | 69.8 | 39.1% |
| 4× | 30.2 | 85.2% | 67.8% | 99.8% | 99.3% | 150.0 | 37.9% |
| 8× | 48.6 | 73.0% | 40.0% | 99.9% | 99.4% | 189.0 | 39.3% |

Soft0.15 adds zero routing-head correction relative to the same-endpoint fine reference in all15 cases. All105 tested routing graphs terminate at declared destinations, contain no cycles/nonadjacent edges, and conserve total water supply. This is routing continuity, not evidence of continuous visible natural channels or a physical erosion process.

Destination agreement is not monotonically worse with larger gaps because fewer coarse endpoints merge destination classes. Do not interpret the exact-destination score alone as a scale-quality ranking. Corridor loss and missing relief/slope information tell a clearer story. Summary JSON includes exact/tolerant corridor precision and recall at5km² and20km², relief, slopes, fill distributions, destination-distance distributions, timing, and heap/RSS deltas.

Soft0.05 changes almost nothing relative to unrestricted fine routing. Soft0.5 favors parent budgets more strongly but gap2 interior destination agreement falls to80.3%, compared with99.0% for0.15. The0.15 choice is a measured compromise, not a universal optimum. Its substantial38–39% volume reassignment cannot be silently described as inherited-budget conservation.

## Boundary sensitivity: the major remaining failure
An unrestricted solve with only inherited sparse endpoints can already be wrong relative to fully open fine edges. Its worst interior added routing head is23.0m at2×,23.0m at4× and137.0m at8×. Therefore the excellent soft-vs-joint scores do not establish boundary correctness.

For ordinary open-edge cropping, the five crop solutions agree with the full121×121 source-domain local receivers by99.0–100% after4 fine rings are removed. Sparse inherited endpoints are therefore a separate, material artifact in this test. Full-domain routing also has unresolved exterior boundary conditions; no global watershed certification is implied.

## Repeated refinement versus new information
Repeated2× steps are also tested from initial gap4 and8. The real variants reveal native intermediate source samples at every stage. The interpolation variant repeatedly subdivides the original coarse surface and adds no source information. Candidate draft contexts are propagated only inside this isolated benchmark; no production reconciliation or persistence is performed.

| Initial gap bridged by2× steps | Method | Final interior destination agreement | Worst added head m | Final terrain RMSE m |
|---|---|---:|---:|---:|
| 4× | hard-mask-real | 58.5% | 178.7 | 0.0 |
| 4× | soft-divide-real | 99.2% | 0.0 | 0.0 |
| 4× | soft-divide-interpolation | 56.7% | 71.2 | 30.2 |
| 8× | hard-mask-real | 55.4% | 228.4 | 0.0 |
| 8× | soft-divide-real | 99.4% | 0.0 | 0.0 |
| 8× | soft-divide-interpolation | 59.7% | 53.4 | 48.6 |

Repeated smaller steps alone do not repair hard inherited divides. The soft+real sequence retains~99% destination agreement while repeated interpolation remains~57–60%. Actual newly supplied terrain information is essential. Sequential local source distributions can differ from direct refinement although their total volume is equal; supply-dependent corridor metrics are deliberately not compared in this sequential experiment. Initial sparse endpoint identities remain in every sequence and missing exits are not recovered.

## Compute and scope
Single-process wall times and observed heap/RSS deltas are included per run. They are noisy diagnostic measurements, not controlled performance benchmarks or worst-case memory bounds. No evidence here establishes a planet-scale feasible grid or production latency. Each target has4225 nodes. More independent terrain regions, aggregation choices, geographic scales, measured hydrography, and explicit exterior water constraints are required before a universal gap limit can be claimed.

The original isolated benchmark did not change production code. This reproducible snapshot is now included with the implementation; later production changes are documented separately. No physical river validation or terrain below native 15 arcsecond source resolution was claimed.

## Reproduce
Run from this directory with Python3, Node.js and (only for the figure) NumPy/Matplotlib:

    python prepare.py
    node --expose-gc benchmark.mjs
    python validate.py
    node sequential.mjs
    python report.py

Raw input and per-case routing arrays are bundled. candidate code defaults to the bundled local snapshot; CANDIDATE_MODULE can explicitly override it for further experiments. Source-file SHA256 values are recorded in file-manifest.json.

Source attribution: NOAA NCEI2022 ETOPO2022 15arcsecond Global Relief Model, DOI10.25921/fd45-gt74, distributed by NOAA CoastWatch ERDDAP. Acquisition URL:
https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.csv?z%5B%2843%29%3A1%3A%2843.5%29%5D%5B%2811%29%3A1%3A%2811.5%29%5D

Raw CSV SHA256: eb3784fb884aeeddee74fd3f46abfeddf2c355db3c7c894d003b0d753e6a5dd1


## Third candidate: explicitly provisional boundary corridors
A bounded follow-on test adds fine exit samples only where the corresponding coarse boundary is explicitly open and still provisional. Hard/adopted ports cannot move. New samples use actual fine DEM elevations; their volume is aggregated into parent corridor identities for mandatory reconciliation.

All15 cases exactly reproduce the fine-open reference receivers, destinations and routing heads; routed amounts agree within1e-6m³/year. It removes the sparse-boundary extra interior head of23.0/23.0/137.0m at gaps2/4/8. Mean volume redistributed across original parent corridor IDs is32.9/40.8/50.0%. Every candidate remains pending and uncommitted.

This is the selected next experiment for **unresolved provisional boundaries**. Keep the weak inherited preference candidate for already specified fixed endpoints; never use provisional exit refinement to move adopted hard receiving ports. The perfect all-open score is expected by construction because every coarse edge sample in this dataset is provisional/open. It verifies that implementation removes artificial obstruction, not that real world water may leave anywhere. The rising corridor-budget reassignment further argues against a blind8× jump.

Additional reproduction command: node provisional-boundary.mjs. Results: results/provisional-boundary.json.

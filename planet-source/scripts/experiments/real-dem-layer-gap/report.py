import json,statistics as st,hashlib
from pathlib import Path
p=Path(__file__).parent;s=json.loads((p/'results/summary.json').read_text());seq=json.loads((p/'results/sequential.json').read_text());lines=[]
lines.append('''# Real DEM layer-scale gap benchmark

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
|---|---:|---:|---:|---:|---:|---:|---:|''')
for f in [2,4,8]:
 a=[r for r in s['results'] if r['factor']==f];method=lambda n:[next(m for m in r['methods'] if m['method']==n) for r in a];hard=method('hard-mask-real');inter=method('interpolation-only');soft=method('soft-divide-0.15')
 lines.append(f"| {f}× | {st.mean(r['terrain']['interpolationRMSEM'] for r in a):.1f} | {st.mean(m['corridor'][0]['recallWithinOneFineCell'] for m in hard):.1%} | {st.mean(m['corridor'][0]['recallWithinOneFineCell'] for m in inter):.1%} | {st.mean(m['corridor'][0]['recallWithinOneFineCell'] for m in soft):.1%} | {st.mean(m['rings'][2]['destinationExact'] for m in soft):.1%} | {max(m['rings'][2]['addedFillM']['max'] for m in hard):.1f} | {st.mean(m['budgetRedistributionFraction'] for m in soft):.1%} |")
lines.append('''
Soft0.15 adds zero routing-head correction relative to the same-endpoint fine reference in all15 cases. All105 tested routing graphs terminate at declared destinations, contain no cycles/nonadjacent edges, and conserve total water supply. This is routing continuity, not evidence of continuous visible natural channels or a physical erosion process.

Destination agreement is not monotonically worse with larger gaps because fewer coarse endpoints merge destination classes. Do not interpret the exact-destination score alone as a scale-quality ranking. Corridor loss and missing relief/slope information tell a clearer story. Summary JSON includes exact/tolerant corridor precision and recall at5km² and20km², relief, slopes, fill distributions, destination-distance distributions, timing, and heap/RSS deltas.

Soft0.05 changes almost nothing relative to unrestricted fine routing. Soft0.5 favors parent budgets more strongly but gap2 interior destination agreement falls to80.3%, compared with99.0% for0.15. The0.15 choice is a measured compromise, not a universal optimum. Its substantial38–39% volume reassignment cannot be silently described as inherited-budget conservation.

## Boundary sensitivity: the major remaining failure
An unrestricted solve with only inherited sparse endpoints can already be wrong relative to fully open fine edges. Its worst interior added routing head is23.0m at2×,23.0m at4× and137.0m at8×. Therefore the excellent soft-vs-joint scores do not establish boundary correctness.

For ordinary open-edge cropping, the five crop solutions agree with the full121×121 source-domain local receivers by99.0–100% after4 fine rings are removed. Sparse inherited endpoints are therefore a separate, material artifact in this test. Full-domain routing also has unresolved exterior boundary conditions; no global watershed certification is implied.

## Repeated refinement versus new information
Repeated2× steps are also tested from initial gap4 and8. The real variants reveal native intermediate source samples at every stage. The interpolation variant repeatedly subdivides the original coarse surface and adds no source information. Candidate draft contexts are propagated only inside this isolated benchmark; no production reconciliation or persistence is performed.

| Initial gap bridged by2× steps | Method | Final interior destination agreement | Worst added head m | Final terrain RMSE m |
|---|---|---:|---:|---:|''')
for f in [4,8]:
 for name in ['hard-mask-real','soft-divide-real','soft-divide-interpolation']:
  a=[r for r in seq['results'] if r['initialGap']==f and r['method']==name]
  lines.append(f"| {f}× | {name} | {st.mean(r['finalInteriorDestinationAgreement'] for r in a):.1%} | {max(r['finalMaxAddedFillM'] for r in a):.1f} | {st.mean(r['finalTerrainRMSEM'] for r in a):.1f} |")
lines.append('''
Repeated smaller steps alone do not repair hard inherited divides. The soft+real sequence retains~99% destination agreement while repeated interpolation remains~57–60%. Actual newly supplied terrain information is essential. Sequential local source distributions can differ from direct refinement although their total volume is equal; supply-dependent corridor metrics are deliberately not compared in this sequential experiment. Initial sparse endpoint identities remain in every sequence and missing exits are not recovered.

## Compute and scope
Single-process wall times and observed heap/RSS deltas are included per run. They are noisy diagnostic measurements, not controlled performance benchmarks or worst-case memory bounds. No evidence here establishes a planet-scale feasible grid or production latency. Each target has4225 nodes. More independent terrain regions, aggregation choices, geographic scales, measured hydrography, and explicit exterior water constraints are required before a universal gap limit can be claimed.

No repository was changed. No physical river validation or terrain below native15arcsecond source resolution was claimed.

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
''')
lines.append("""
## Third candidate: explicitly provisional boundary corridors
A bounded follow-on test adds fine exit samples only where the corresponding coarse boundary is explicitly open and still provisional. Hard/adopted ports cannot move. New samples use actual fine DEM elevations; their volume is aggregated into parent corridor identities for mandatory reconciliation.

All15 cases exactly reproduce the fine-open reference receivers, destinations and routing heads; routed amounts agree within1e-6m³/year. It removes the sparse-boundary extra interior head of23.0/23.0/137.0m at gaps2/4/8. Mean volume redistributed across original parent corridor IDs is32.9/40.8/50.0%. Every candidate remains pending and uncommitted.

This is the selected next experiment for **unresolved provisional boundaries**. Keep the weak inherited preference candidate for already specified fixed endpoints; never use provisional exit refinement to move adopted hard receiving ports. The perfect all-open score is expected by construction because every coarse edge sample in this dataset is provisional/open. It verifies that implementation removes artificial obstruction, not that real world water may leave anywhere. The rising corridor-budget reassignment further argues against a blind8× jump.

Additional reproduction command: node provisional-boundary.mjs. Results: results/provisional-boundary.json.
""")
(p/'REPORT.md').write_text('\n'.join(lines))
manifest={str(f.relative_to(p)):hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(p.rglob('*')) if f.is_file() and f.suffix in ['.py','.mjs','.csv']}
(p/'file-manifest.json').write_text(json.dumps(manifest,indent=2))
try:
 import matplotlib;matplotlib.use('Agg');import matplotlib.pyplot as plt
 fig,axs=plt.subplots(1,3,figsize=(14,4.5));factors=[2,4,8]
 for crop in ['NW','NE','SW','SE','C']:
  a=[next(r for r in s['results'] if r['factor']==f and r['crop']==crop) for f in factors];axs[0].plot(factors,[r['terrain']['interpolationRMSEM'] for r in a],'o-',label=crop)
 axs[0].set(title='Interpolation loses actual source detail',ylabel='Fine-source RMSE (m)',xlabel='Adjacent scale gap');axs[0].legend(fontsize=8)
 for name,label in [('hard-mask-real','Hard inherited masks + real DEM'),('interpolation-only','Interpolation only'),('soft-divide-0.15','Weak preference + real DEM')]:
  vals=[st.mean(next(m for m in r['methods'] if m['method']==name)['corridor'][0]['recallWithinOneFineCell'] for r in s['results'] if r['factor']==f) for f in factors];axs[1].plot(factors,vals,'o-',label=label)
 axs[1].set(title='Computed corridor retention',ylabel='Recall within one fine cell',xlabel='Adjacent scale gap',ylim=(0,1.05));axs[1].legend(fontsize=7)
 for kind,label in [('hard','Hard masks vs same-endpoint fine'),('boundary','Sparse vs fully open fine endpoints')]:
  vals=[max((next(m for m in r['methods'] if m['method']=='hard-mask-real') if kind=='hard' else r['sparseOutletEffect'])['rings'][2]['addedFillM']['max'] for r in s['results'] if r['factor']==f) for f in factors];axs[2].plot(factors,vals,'o-',label=label)
 axs[2].set(title='Interior extra routing-head correction',ylabel='Worst across five crops (m)',xlabel='Adjacent scale gap');axs[2].legend(fontsize=7)
 for ax in axs:ax.set_xticks(factors);ax.grid(alpha=.2)
 fig.suptitle('Same 21.6 × 29.7 km extent, real 337 × 463 m DEM target • 5 overlapping Tuscany crops',fontsize=12)
 fig.text(.5,.015,'Calculated terrain drainage, not observed rivers. Crop selection fixed; local metric approximation. Soft method requires changed-budget reconciliation.',ha='center',fontsize=8)
 fig.tight_layout(rect=(0,.04,1,.93));fig.savefig(p/'results/scale-gap-summary.png',dpi=180);plt.close(fig)
except ImportError:pass

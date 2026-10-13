# Same-scale real reference: broad → local bridge

## Finding, with landform context

The saved generated patch is low-relief terrain. Comparing it only with the mountainous Apennines would confound landform class with quality. Two transparent contexts are provided, without tuning the generator, changing seed, moving either crop, matching relief, or ranking “naturalness”:

- Fixed Tuscany/Apennines center 43.6° N, 12° E, selected before acquisition/rendering. The exact footprint includes an Adriatic edge: 631 / 16,641 finest nodes are at or below zero elevation (3.79%). This is not an exclusively inland crop. Elevation ≤0 is a bathymetry/coastal warning, not a precise coastline classification.
- One fixed Paris Basin lowland-context center 49° N, 2.5° E, requested after seeing the mountainous mismatch. It is an explicitly post-hoc contextual reference, not a pre-registered test or a relief-matched selection. No finest nodes are ≤0. A broad lowland context is still not a fully matched climate, geology, erosion history, elevation distribution, or coast-distance class.

At the common finest grid (129 × 129 nodes):

| Context | Relief m | Median slope ° | 95th slope ° | D8 proxy length km | Largest proxy catchment km² |
|---|---:|---:|---:|---:|---:|
| Generated bridge | 154.18 | 0.165 | 0.689 | 1121.55 | 6589.67 |
| Paris Basin reference | 209.98 | 0.520 | 1.713 | 1186.31 | 9882.60 |
| Apennines reference | 1545.12 | 2.682 | 8.346 | 1250.18 | 4451.27 |

The Paris reference brings relief much closer to the generated patch than the mountainous reference does. The generated patch still has lower sampled slopes than this particular lowland reference. These numbers describe these exact crops; they neither require matching this DEM nor establish a universal defect or success.

Drainage proxy lengths are of similar magnitude despite strongly different relief; this is a useful warning that stream length alone cannot establish geomorphic plausibility. Inspection shows a broad NW–SE mountain belt in the Apennines reference; the lowland pair needs its own color window to inspect modest relief. Rivers are computed proxies, not observed mapped channels, and are not the bridge's constrained inherited water network.

## Physical support and sampling

- Exact common rectangle: 113,908.421896 m E–W × 156,367.865594 m N–S, 17,811.616805 km².
- Generated L1 center is 43.2421875° latitude; its true anisotropic metric support is preserved. Real crop center may differ while physical support remains identical. No horizontal stretch, vertical exaggeration, height fitting, or independent normalization.
- Stages: 3, 5, 9, 17, 33, 65, 129 nodes per side. Presented stages: 3, 17, 129. Spacings are respectively 56.954 × 78.184 km, 7.119 × 9.773 km, 0.890 × 1.222 km. “~78 km → ~10 km → ~1 km” refers to approximate north–south spacing, not square cells.
- The raw source is NOAA ETOPO2022 nominal 15 arc-second data queried with stride 3 (45 arc-seconds). Returned source arrays are 121 × 169, about 0.955 MB per reference. Nominal native spacing is not an accuracy guarantee.
- Queried sample spacing: Apennines 1006.55 × 1389.94 m; Paris about 911.9 × 1389.94 m. Actual precise values are in each provenance file. Target-grid bilinear interpolation adds no surveyed detail, and the target is somewhat finer than the retained source sampling, especially north–south. Effective reference detail is limited by source data and this stride, not by the target-grid spacing.
- Coarse stages are point-sampled from the same bilinear DEM interpolator, preserving nested anchors. They are not anti-aliased area averages and may miss peaks/valleys. Coarse drainage is severely under-resolved.
- Coordinate conversion is a local spherical tangent approximation (R=6371000 m, longitude distance at each reference's center latitude). Across the rectangle, latitude-dependent east-west scale variation is ~1–1.5%; this is an explicitly approximate geographic projection, not terrain fitted to the picture.
- Rendered nodal cells use nearest shading, clipped to the true physical endpoints; half-width boundary support is represented consistently. The cross-context figures share the absolute −100 to 1700 m color range. The primary lowland stage figure uses a shared 0–250 m range for both rows. Paris `lowland-detail.png` uses one explicitly shared 0–250 m range for the pair, with unchanged heights and dimensions.

## Drainage diagnostic

A standalone deterministic D8 priority-flood algorithm is applied identically to both actual arrays. Every outer node is an open boundary outlet; the diagnostic supplies no external inflow. Interior depressions are raised for routing, steepest strictly descending filled-head neighbors are preferred, and flat ties use the priority-flood tree. Contributing area uses trapezoidal nodal weights (half on edges, quarter at corners). The common stream threshold is 100 km². Slope is atan of the metric finite-difference gradient, not shaded-relief estimation.

This is only a matched terrain diagnostic. It does not validate the generator's inherited outlet budgets, coastal treatment, lake physics, real river courses, or cross-tile drainage. Apennines submarine nodes remain in the diagnostic domain. Boundary truncation can alter outlets and catchments substantially. Reported fill is an algorithmic routing correction, not water depth or excavation. D8 grid orientation and resolution bias channel length and branching. No unsupported naturalness score is calculated.

## Files and reproduction

- `primary-lowland-stages.png`: primary comparison, real/generated rows and coarse/mid/fine columns.
- `apennines/` and `paris/`: comparison arrays, numerical summaries, provenance, shared-scale stage and drainage figures.
- `paris/lowland-detail.png`: readable lowland pair using a common lower color window.
- `raw/`: unchanged downloaded CSV bytes and predeclared acquisition metadata.
- `generated-bridge.json.gz.part000` through `part003`: byte chunks (each ≤512 KiB) of deterministic gzip storing the immutable captured bridge input. `generated-bridge-storage.json` records ordered part hashes, compressed hash and original uncompressed hash. Both readers verify every hash, concatenate in manifest order and decompress transparently. Provenance retains the logical original filename `generated-bridge.json` and hashes its original uncompressed bytes.
- `compare.py`: recompute both references and diagnostic figures without network or generator execution.
- `validate.py` / `validation.json`: independent checks of input byte hashes, physical support, exact generated source arrays, finite values, grid adjacency, area conservation, and preserved nested nodes.

Run with Python + NumPy, SciPy, Matplotlib:

    MPLCONFIGDIR=/tmp/real-mpl XDG_CACHE_HOME=/tmp/real-cache python compare.py apennines
    MPLCONFIGDIR=/tmp/real-mpl XDG_CACHE_HOME=/tmp/real-cache python compare.py paris
    python render-primary.py
    python validate.py

## Source and reproducibility

NOAA NCEI (2022), ETOPO2022 15 Arc-Second Global Relief Model. DOI: https://doi.org/10.25921/fd45-gt74 . Official NOAA CoastWatch distribution metadata: https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.html . Metadata identifies topography relative to EGM2008. The generated model's zero level is not geodetically calibrated; no absolute datum equivalence is implied.

The exact ERDDAP queries, source and crop bounds, raw SHA256 hashes, metric conversion, returned source sample spacings and captured generated-input hash are bundled. NOAA source data are publicly redistributable with no warranty; see official dataset license. No large global data download was used. This folder changes no generator code and makes no claim of full project or browser validation.

To reconstruct the exact original outside the repository: concatenate part000 through part003 in order, then gzip-decompress. Original size: 9,196,749 bytes; compressed total: 2,028,151 bytes. SHA256 of the original bytes: `84543e06bf60dc046ca9c031e4473ec87c3cde290bdd62839671a028a61c9804`. Packaging changes no values or scientific outputs.

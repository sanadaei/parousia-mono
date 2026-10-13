# Seeded constructive regions

The browser-safe `src/core/seeded-river-region.mjs` plans a connected river tree,
then builds a heightfield around its graded beds. It does not read an existing
candidate or any DEM. Existing A remains a separately authored reference option.

## Contract

`generateSeededRiverRegion({seed, widthM, heightM, columns, rows, reliefScale,
valleyWidthScale, hints: {outlet: {side, position}}})` returns
`shape-first-candidate@1`, directly accepted by the existing pyramid and neighbor
partition modules. Default extent: 8847.575822166944 × 9772.99159961942 metres;
default native grid: 161 × 129; all heights are metres. Increasing raster density
does not change geometry or shared-node elevations.

- `seed`: finite number or string; same version/config produces the same result.
- `widthM`, `heightM`: explicit physical dimensions, 1–100 km per side.
- `reliefScale`: 0.2–3, default 1; scales elevation differences/grades coherently.
- `valleyWidthScale`: 0.2–3, default 1; scales floodplain widths without moving rivers.
- Outlet `side`: north/east/south/west. `position`: fraction 0.1–0.9 along that edge,
  from west for horizontal edges, north for vertical edges. These are initial
  design choices, not immutable boundary requirements or validated hydraulic facts.
- Candidate `riverDesign.rivers` matches `candidate.rivers` by index; contains
  `id`, `parentId`, `order`, per-point `designBedElevationM`, and `lengthM`.
  Every path runs downstream → upstream. Tributaries begin exactly at a parent
  vertex and matching design-bed elevation. Parents precede their children.

`createSeededRiverDesign(options)` exports the geometry-first plan independently
of raster resolution; `sampleSeededRiverElevation(design,xM,yM)` evaluates that
same continuous metre-space design. Raster and polyline coordinates use NW origin,
x east, y south. No Node APIs or external packages are used by the runtime module.

## Reproduce and inspect

    node scripts/experiments/shape-first/seeded/generate.mjs /tmp/seeded-river-regions
    MPLCONFIGDIR=/tmp/mpl python scripts/experiments/shape-first/seeded/render.py /tmp/seeded-river-regions
    node --test test/seeded-river-region.test.mjs test/shape-first-seeded-adjacency.test.mjs

Three seeds (271828, 314159, 161803) vary main bends, outlet side, unequal tributary
spacing, branches, valley width, and coherent upland texture. The render retains
an actual Maryland DEM comparison at the same extent, node count, hillshade,
and relative-height color range. That renderer alone reads the DEM. Blue lines
on the real reference are inferred drainage; blue lines on candidates are designed
river geometry, not an equivalent measurement.

## Honest limits

This is a shape prototype: broad curves and spurs can still look constructed.
The compared seeds are hillier than the actual reference; use reliefScale for
lowland designs instead of stretching horizontal units. Designed beds are
monotonic but gridded drainage and bank elevations are not hydraulic certification.
No supplied rainfall, discharge, erosion budget, or water-budget acceptance gate.
Any provisional runtime water annotation must remain explicitly labeled as such.

# Predetermined fine-local real DEM reference

One reference centered at 39.1°N, 77.1°W (Maryland Piedmont), selected before downloading or inspecting elevations. No terrain-fit search. Raw USGS DEM is retained for reproducibility.

## Source and permission

USGS 3DEP 1/3 arc-second n40w078, publication 2026-05-12, NAVD88 metres. The service catalog explicitly reports native angular spacing 0.00009259259269°; native spacing at center is 8.0097 × 10.2794 m. The global service's advertised 1 m resolution is NOT treated as this source's resolution. Export locks raster OBJECTID 5276, requests the None raster function and Float32 TIFF, and downloads just a bounded 10 m UTM support window (3,671,584 bytes). It does not fetch a full degree tile.

Official USGS documentation says 3DEP products are free of charge and without use restrictions: https://www.usgs.gov/3d-elevation-program/about-3dep-products-services . Full source URLs, catalog attributes and footprint are in provenance.json. The export is a resampled extract, not an untouched native grid.

## Physical grid

Target is exactly 161 × 129 point nodes, spacing 55.2973488885 × 76.3514968720 projected metres, point extent 8847.575822 × 9772.991600 m, EPSG:32618. The upper and left geodesic edges differ from those projected lengths by 0.0543 m and 0.2550 m. Source support extends at least 36.21 m beyond every target node; all exported pixels are valid. Bilinear sampling uses actual GeoTIFF pixel centers, with extrapolation forbidden. Native and export resolutions are comfortably finer than target spacing. There is no vertical shift, amplitude fit, synthetic detail or missing-data fill.

## Interpretation

Regional Piedmont setting is supported by Maryland Geological Survey, but exact local landform class and equality to the fictional generator's class are not verified. This is a suburban reference and bare-earth DEMs can retain roads, embankments, grading and engineered drainage. Absolute real elevations use NAVD88; the generated datum is fictional. Therefore do not rank morphology or claim realism certification from closeness of metrics.

Same D8/priority-flood diagnostic, all perimeter nodes open on BOTH fields, uniform runoff, no climate field or imported upstream flow is used on both actual height arrays. It reports contributing area and depression-fill burden, not surveyed rivers. The reference's 86.4673 km² area exactly matches the candidate. Bilinear point downsampling can alias subgrid features; it is not anti-aliased area averaging.

## Reproduction

Use system Python with numpy, scipy, matplotlib, pyproj and GDAL:

    MPLCONFIGDIR=/tmp/mpl-fine /usr/bin/python3 compare.py
    /usr/bin/python3 validate.py

Each output contains the actual arrays, metrics at all five stages, candidate hash and a common-scale image. acquire.py records/repeats the bounded network request (service IDs/content can change; use retained raw bytes and hashes for exact reproduction). actual-target-grid.npz contains the final target X/Y coordinates and real heights. Validation checks raw SHA256, grid geometry, finite pixels, source-window support, interpolation and area accounting.

selected-input.json is a compact exact extraction of all compared candidate height arrays. input-provenance.json links its hash to the original full candidate. Default reproduction writes reproduced/ and intentionally hashes that compact input, whereas selected/comparison.json retains the full original candidate hash. Original baseline summary is provided separately.

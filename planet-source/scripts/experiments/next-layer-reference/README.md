# Next local layer: predetermined real reference

This comparison is separate from generator implementation. One reference center, 39.1° N / 77.1° W, was retained from the previous comparison before sampling this child domain. No location search, elevation injection, vertical fit, or terrain-class matching was performed.

## Exact scope

The parent crop and child cover 1990.7045599875626 × 1985.1389186726947 projected metres (3.95182509761051 km²). The parent has 37×27 point nodes; child has 73×53, spaced 27.648674444271702 × 38.17574843601336 m. Row index points down. Generated axes are fictional domain coordinates; real DEM axes are EPSG:32618.

Raw source is the retained official USGS 3DEP 1/3-arcsecond n40w078 export, locked OBJECTID 5276. Native spacing at reference center is approximately 8.01×10.28 m, finer than the child. This is a service-resampled 10 m UTM export, not an untouched native raster. Native raster origin/indices are unavailable in the retained data and are explicitly not claimed. Exact target UTM coordinates and actual export pixel-center indices are saved in comparison-arrays.npz; target export indices span columns 346.464772–545.535228 and rows 393.243054–591.756946. The source pixel-center support margins are 3464.65 m east/west and 3932.43 m north/south. All raw pixels and sampled values are finite/valid; no extrapolation or NoData filling occurs. Source footprint containment is checked against the retained catalog polygon.

## Results

At child resolution, real versus generated relief is 50.784 versus 16.095 m; slope median/p95 is 2.890°/8.280° versus 0.546°/1.176°. The generated crop is much gentler than this particular reference; this alone does not establish the correct fictional terrain class or certify realism.

The identical independent priority-flood / D8 diagnostic uses all perimeter nodes open and area-weighted uniform unit runoff for every field. No inherited outlet constraints, upstream imports, climate field, or generator routing head enters it. Parent-to-child generated max fill rises 1.181→1.449 m; filled-node fraction rises 4.50%→11.32%; interior raw D8 no-lower-neighbor fraction rises 1.26%→3.92%. Real child-grid filled-node fraction is 0.569%. These diagnostics describe surface pits/flat handling and contributing area, not observed streams or inherited-water validity. Boundary node quadrature assigns half area to edge points and quarter to corners, so outlet sums close to the exact point extent.

Outcome: the child fails a parent-relative non-regression gate for surface pits under this independent all-open diagnostic: filled-node fraction and interior no-lower-neighbor fraction both increase. This is not a terrain-class verdict from reference closeness.

The parent and child are measured at their actual different resolutions on the same physical extent. The real DEM is sampled separately on both corresponding exact grids; real child coincidence at parent nodes is exact. The image shows real at child resolution, actual parent, and actual child, with common 30–150 m absolute elevation and 0–20° slope bounds. Real NAVD88 and fictional generated vertical datums differ, so colors must not be treated as fitted morphology.

## Reproduction

System Python requires numpy, scipy, matplotlib, GDAL, pyproj. No network access is needed.

    MPLCONFIGDIR=/tmp/mpl-next /usr/bin/python3 compare.py
    /usr/bin/python3 validate.py

compared-input.json preserves only the exact compared parent/child grid geometry and height arrays. input-provenance.json separately records the original full candidate byte SHA256, canonical content hash, and compact input SHA256. Compact extraction was verified array-for-array against the original full candidate; the original full file is not duplicated here. provenance.json records both input identities and source identity; summary.json holds metrics. comparison-arrays.npz retains every height, slope, D8 receiver, contributing area, target coordinate, and export pixel coordinate array. validation.json and independent-validation.json check geometry, source identity/support, array identity, and exact recalculation. diagnostic.py contains the identical independent implementation used by the preceding fine-reference comparison. The sibling ../fine-real-reference/provenance.json and request.json retain catalog/source links and acquisition metadata. Source TIFF, catalog, service, and export response remain in ../fine-real-reference/raw/ and are not duplicated. Reproduction requires that sibling tracked package.

## Limits

One suburban Maryland Piedmont reference is not an ensemble or verified local class match. Bare-earth data can retain roads, grading, embankments and engineered drainage. Bilinear point sampling is not anti-aliased area averaging. Service overview selection is not separately documented. The figure and metrics cannot validate the generator's geological history or inherited water ledger.

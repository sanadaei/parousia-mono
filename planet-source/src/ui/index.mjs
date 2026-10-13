// Public surface of the Stage 5 visualizer. Every module here is safe to
// import in Node (no DOM access at import time); the classes need a browser
// canvas/DOM only when constructed.

export { MapViewer, TerrainTile, DEFAULT_LAYERS, TILE_SIZE, levelForScale, contourInterval } from './map-viewer.mjs';
export { ProfileChart, annotateLineProfile, nearestSampleIndex, profileExtent } from './profile-chart.mjs';
export { Inspector, inspectPoint, inspectionRows, drainageRows, junctionRows, waterStatus } from './inspector.mjs';
export { DRAINAGE_SETTINGS, TRAPPED_BASIN_STATUSES, basinKey, hashBasinKey, hslToRgb, basinPalette, basinColor, basinColorFromHash,
  basinStatusOf, isTrappedFlow, flowBearingDeg, compassPoint, formatFlowDirection, isLocalMinimum, chartBoundaryPolygon,
  formatChartLabel, greatCircle, chartSeamMarkers, describeWaterCharts, sceneWaterCharts } from './drainage.mjs';
export { CrossingPanel, summarizeCrossings, STATUS_LABELS } from './crossing-panel.mjs';
export { JUNCTION_SETTINGS, JUNCTION_STATUSES, JUNCTION_STATUS_LABELS, JUNCTION_STATUS_COLORS, CULVERT_COLOR, classifyRoadCrossing,
  nearestOnRoad, roadElevationAt, normalizeRoadCrossing, normalizeCulvert, deriveRoadCrossings, deriveCulverts, sceneJunctions,
  summarizeJunctions, summarizeCulverts, junctionMarker, formatJunctionLabel, junctionLocation, junctionFeaturesNear } from './junctions.mjs';
export { LodComparator, runLodComparison, lodWindow, sampleDifferences } from './lod-comparator.mjs';
export { createApp, profileToCsv, QUICK_LAYERS } from './app.mjs';
export { classifyTrafficability, terrainTrafficabilityAt, trafficRasterColor, formatCost, TRAFFIC_THRESHOLDS, TRAFFIC_CLASSES, TRAFFIC_COLORS,
  TRAFFIC_LABELS } from './trafficability.mjs';
export { designTestPad, designTestRoad, smoothGrade, sandboxTerrain, SANDBOX_DEFAULTS } from './sandbox.mjs';
export { loadScene, sceneBundleForExport, restoreMetricTerrain, runRoadPipeline, createCorridorIndex, createCorridorSampler, structureAt,
  sampleLineProfile, roadPathProfile, crossingLocation, UI_SCENE_SCHEMA, ROAD_ADJUSTED_SCHEMA, SUPPORTED_SCHEMAS } from './scene.mjs';
export { PRESETS, presetUrl, fetchPreset, buildDemoScene, demoHeight } from './presets.mjs';
export { Viewport, clamp, lerp, elevationColor, waterColor, hillshade, applyShade, rgbCss, STRUCTURE_COLORS, CROSSING_STATUS_COLORS,
  polylineLength, pointAlongPolyline, slicePolyline, distanceToSegment, pointInPolygon, boundsOfPoints, insideBounds, rectanglePolygon,
  niceTicks, formatNumber, formatMeters, formatDistance, shortId, scaleBarLength, h, fitCanvas, cssVar, nextFrame } from './util.mjs';

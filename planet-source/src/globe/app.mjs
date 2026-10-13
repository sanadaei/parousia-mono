import {installShapeFirstPanel} from './shape-first-panel.mjs';
import {shapeFirstOverview} from './terrain-appearance.mjs';
import {prepareShapeFirstPlanetPlacement} from './shape-first-planet-placement.mjs';
import {createShapeFirstPlanetRegion} from './shape-first-planet.mjs';
import {loadShapeFirstModel} from './shape-first-loader.mjs';
import {installSaveControls,materializationStatusText} from './save-controls.mjs';
import {createBrowserMaterializationStorage} from './materialization-storage.mjs';
import {inspectVisibleCrossings} from './crossing-inspection.mjs';
import {makePopulationZoneOverlay,PopulationZoneView} from './population-zone-map.mjs';
import {landformShapeSummary} from '../core/landform-inspection.mjs';
import {createTerritoryScenario,territoryAt} from '../core/territory-scenario.mjs';
import {makeTerritoryMap,TerritoryLabels} from './territory-view.mjs';
import {SETTLEMENT_RUNTIME_VERSION} from '../core/settlement-catalogue.mjs';
import {summarizeLayouts} from './layout-summary.mjs';
import {SettlementLabels} from './settlement-labels.mjs';
import {validateHeightScale} from './height-exaggeration.mjs';
import {loadVerifiedField,makeThematicMap,climateCell,automaticContourInterval} from './thematic-map.mjs';
import {BIOMES} from '../core/planet-climate.mjs';
import {dragPoint,projectSettlement,dataAvailability} from './map-annotations.mjs';
import {solarDirection,solarAt,dayFractionForLocalHour} from '../core/solar-light.mjs';
import {lakeShoreView} from './lake-view.mjs';
import {installPageRecovery} from './page-lifecycle.mjs';
import { benchmarkFrameBudgetPass, benchmarkSummary, benchmarkReady, recordBenchmarkFrame, benchmarkRunProgress } from './benchmark-summary.mjs';
import {worldExperimentLink,worldCatalogEntries,worldVersionLabel,savedLandscapeSummary,generationJobMessage} from './world-link.mjs';
import { readPage } from './page-request.mjs';
import { GroundTracker, cameraSurfaceElevation } from './ground-tracker.mjs';
import { PagedSource } from './paged-source.mjs';
import { saveView, validateView, groundDisplaySummary, roadDisplaySummary, createOrbitCamera } from './view-state.mjs';
import { SoftwareRenderer, softwareViewportSize } from './software-renderer.mjs';
import { BuildingLayer } from './buildings.mjs';
import { GlobeRenderer } from './renderer.mjs';
import { GlobeStream } from './stream.mjs';
import { geographicPoint, sphereBasis, offsetGeographic } from '../core/spherical.mjs';

import { LOD_ERROR_METHOD, LOD_TARGET_PIXELS } from './lod.mjs';
const $ = id => document.getElementById(id), canvas = $('globe'), startupStarted=performance.now();
installSaveControls({exportButton:$('export-committed'),importInput:$('import-committed'),status:$('save-transfer-status'),storage:createBrowserMaterializationStorage(),download:(text,name)=>{const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
let firstGeometryAt=null,autoBenchmarkPending=false,autoBenchmarkAfter=Infinity;
const parameters = new URLSearchParams(location.search), manifestURL = new URL(parameters.get('world') ?? '../../examples/planet/generated/manifest.json', location.href).href;
const softwareURL=new URL(location.href);softwareURL.searchParams.set('renderer','software');$('software-link').href=softwareURL.href;
async function loadWorldCatalog(){
 try{
  const catalogURL=new URL('../../examples/planet/catalog.json',location.href),catalog=await readPage(fetch,catalogURL.href,{kind:'text'}),entries=worldCatalogEntries(JSON.parse(catalog),catalogURL.href,location.href),select=$('world-choice');
  select.replaceChildren();const current=document.createElement('option');current.value=location.href;current.textContent='この保存世界';select.append(current);
  for(const e of entries){const option=document.createElement('option');option.value=e.url;option.textContent=e.name;select.append(option);if(e.worldId===manifest.canonicalWorldId)option.selected=true;}
  $('world-version').textContent=worldVersionLabel(manifest,entries);
  select.disabled=false;select.onchange=()=>{location.href=select.value;};
 }catch(e){$('world-choice').title=`例の一覧を読めません: ${e.message}`;}
}
const state = { point: { latDeg: 35, lonDeg: 135 }, altitude: 20000000, ground: 600, groundReference: null, tilt: 0, heading: 0, flight: null, drag: null };
const streamOptions={meshBudgetMiB:Number(parameters.get('meshBudgetMiB')??64)};
let renderer, stream, buildings, groundTracker, manifest, lastTime = 0, lastPlan = -Infinity, lastHUD = 0, lastProbe = null, benchmark = null, lastReport = null, lastDraw = {}, sampleIntervals = [];
let heightScale=1,settlementLabels=null,territoryData=null,territoryLabels=null;
let lastPopulationZones=null,populationZoneView=null;
let inspectGeneration=0, climateData=null,populationData=null,thematicMap=null,layerLoad=null;
async function updateMapLayer(){
 const mode=$('map-layer').value,month=+$('map-month').value;$('map-month').disabled=mode!=='temperature';
 if(mode==='terrain'){thematicMap=null;$('map-legend').textContent='地形の標高色。等高線はm単位。';return;}
 if(!manifest.climate){$('map-legend').textContent='この保存世界には気候データがありません。新しいseed生成版を開いてください。';$('map-layer').value='terrain';thematicMap=null;return;}
 try{layerLoad??=Promise.all([loadVerifiedField(manifest.climate,manifestURL),loadVerifiedField(manifest.population,manifestURL)]).then(([c,p])=>{climateData=c;populationData=p;});await layerLoad;
 if(mode!==$('map-layer').value||month!==+$('map-month').value)return;
 if(mode==='territory'){if(!territoryData){const saved=manifest.territories?await loadVerifiedField(manifest.territories,manifestURL):null;if(saved&&(saved.climateId!==climateData.id||saved.populationId!==populationData?.id))throw new Error('領有データと地理・人口の参照が一致しません');territoryData=saved??createTerritoryScenario(climateData,populationData,{radiusM:manifest.base.frame.radiusM});}if(mode!==$('map-layer').value)return;thematicMap=makeTerritoryMap(territoryData,climateData);$('map-legend').textContent=`仮の領有 ${territoryData.territories.length}勢力。固定ID・陸上到達性による仮配置。白い帯は粗いセル境界で、歴史・地籍・近景の境界線は未実装。未配属の陸 ${territoryData.diagnostics.unassignedDryCells}セル。`;inspect().catch(showError);return;}
 thematicMap=makeThematicMap(climateData,populationData,mode,month);lastPopulationZones=null;
 $('map-legend').textContent=mode==='watershed'?'同じ排水先へつながる土地を同じ色で表示。色は識別用で、湿りや水深ではありません。広域セルの推定であり、近景の川筋は未確定です。':mode==='upstream-area'?`上流の集水面積：薄茶 0 → 青 ${Math.round(thematicMap.maximumUpstreamAreaKm2).toLocaleString()} km²。尺度は世界全体で固定。雨量・流量・浸水域とは別です。`:mode==='environment'?'気候と土壌水分による潜在被覆。森林・疎林・草地・低木地・乾燥裸地・寒冷域。近景では同じ条件に傾斜と川岸の条件が加わります。':mode==='soil-moisture'?'土壌の湿り 0〜1：乾いた茶 → 湿った青。月別降水と蒸発要求による簡易推定。':mode==='water-supply'?'流域の水供給：茶 0 → 青 10,000 m³/s以上（対数色）。上流から集まる潜在供給であり、実河川流量・湖水収支ではありません。':mode==='biome'?Object.values(BIOMES).map(([n])=>n).join(' / '):mode==='temperature'?`${month<0?'年平均':month+1+'月'}気温 ℃：青 −30以下 → 赤 35以上`:mode==='agriculture'?'農業適性 0〜1：茶 → 緑。土壌は仮定。':'人口密度 0〜100人/km²：茶 → 緑（対数色）。近づくと人口ゾーンを段階的に表示します。色の表示だけでは家や道路を一括生成しません。';
 if(populationData){const t=populationData.totals;$('population-summary').textContent=`要求 ${t.targetPopulation.toLocaleString()}人 / 配分 ${t.supportedPopulation.toLocaleString()}人 / 食料不足で未配分 ${t.unplacedPopulation.toLocaleString()}人。推定 村${t.villages.toLocaleString()}・町${t.towns.toLocaleString()}・都市${t.cities.toLocaleString()}（集計値。建物数ではありません）。`;}
 inspect().catch(showError);
 }catch(e){layerLoad=null;thematicMap=null;$('map-layer').value='terrain';$('map-legend').textContent=e.message;}
}
for(const id of ['map-layer','map-month'])$(id).onchange=()=>updateMapLayer();

let longTaskCount = 0, longestTaskMs = 0;
const longTaskRecords = [];
const longTasksSupported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask');
if (longTasksSupported) new PerformanceObserver(list => { for (const e of list.getEntries()) {
  longTaskCount++; longestTaskMs = Math.max(longestTaskMs, e.duration);
  if(benchmark&&e.startTime>=benchmark.started)benchmark.maxLongTaskMs=Math.max(benchmark.maxLongTaskMs??0,e.duration);
  longTaskRecords.push({ startTime: e.startTime, duration: e.duration, name: e.name, attribution: e.attribution.map(a => ({ name: a.name, containerType: a.containerType, containerName: a.containerName })) });
  if (longTaskRecords.length > 128) longTaskRecords.shift();
} }).observe({ type: 'longtask', buffered: false });
function camera() {return createOrbitCamera(state,{radiusM:manifest.base.frame.radiusM,heightScale,aspect:canvas.clientWidth/canvas.clientHeight});}

let solarState={dayFraction:.5,declinationDeg:0,primeNoonLongitudeDeg:0};
function saveSun(){localStorage.setItem(`planet-sun:${manifest.worldId}`,JSON.stringify(solarState));}
$('sun-time').oninput=e=>{solarState.dayFraction=dayFractionForLocalHour(state.point.lonDeg,Number(e.target.value));saveSun();};
$('sun-noon').onclick=()=>{solarState.dayFraction=dayFractionForLocalHour(state.point.lonDeg,12);saveSun();};
$('sun-season').oninput=e=>{solarState.declinationDeg=Number(e.target.value);saveSun();};
const sliderAltitude = value => 3 * (20000000 / 3) ** (value / 1000);
const sliderValue = altitude => Math.log(altitude / 3) / Math.log(20000000 / 3) * 1000;
function setAltitude(value) { state.altitude = Math.max(3, Math.min(40000000, value)); $('height').value = sliderValue(state.altitude); }
function fly(altitude, seconds = 14, point = state.point) { state.flight = { started: performance.now(), duration: seconds * 1000, from: state.altitude, to: altitude, pointFrom: { ...state.point }, pointTo: point }; }
function cancelFlight() { state.flight = null; }
function updateFlight(time) {
  const f = state.flight; if (!f) return;
  const t = Math.min(1, (time - f.started) / f.duration), s = t * t * (3 - 2 * t);
  setAltitude(Math.exp(Math.log(f.from) * (1 - s) + Math.log(f.to) * s));
  const lonDelta = ((f.pointTo.lonDeg - f.pointFrom.lonDeg + 540) % 360) - 180;
  state.point = geographicPoint(f.pointFrom.latDeg * (1 - s) + f.pointTo.latDeg * s, f.pointFrom.lonDeg + lonDelta * s);
  if (t === 1) { state.flight = null; inspect().catch(showError); }
}
async function inspect() {
  if (!stream) return;
  const generation=++inspectGeneration,point = { ...state.point }, data = await stream.probe(point);if(generation!==inspectGeneration)return;lastProbe = data;
  state.groundReference = { up: sphereBasis(point).up, elevationM: data.sample.baseGroundElevationM };
  if (Math.abs(state.point.latDeg - point.latDeg) < 1e-8 && Math.abs(state.point.lonDeg - point.lonDeg) < 1e-8) state.ground = cameraSurfaceElevation(data.sample);
  const s = data.sample;
  $('probe').textContent = `${point.latDeg.toFixed(7)}°, ${point.lonDeg.toFixed(7)}°\n地盤 ${s.groundElevationM.toFixed(6)} m\n水深 ${s.waterDepthM == null ? '未定義' : s.waterDepthM.toFixed(6) + ' m'}\n道路面 ${s.roadSurface?.roadElevationM?.toFixed(6) ?? '—'} m\n勾配 ${s.slopeMPerM.toFixed(6)}\n${s.roadSurface?.structureKind ?? s.buildingId ?? ''}`;
  if(s.shapeFirst)$('probe').textContent+=`\n形状座標 X ${s.shapeFirst.xM.toFixed(2)} / Y ${s.shapeFirst.yM.toFixed(2)} m\n${s.shapeFirst.weight===1?'元形状の標高を参照':'外周の移行帯'} / 設計水路（仮の水供給）`;
  if(climateData){const i=climateCell(climateData,point.latDeg,point.lonDeg),month=+$('map-month').value,t=month<0?climateData.annualMeanTemperatureC[i]:climateData.monthlyTemperatureC[month][i];$('probe').textContent+=`\n${month<0?'年平均':month+1+'月'}気温 ${t} ℃ / 潜在植生 ${BIOMES[climateData.biome[i]][0]}`;const drainage=climateData.catchmentWater?.drainage;if(drainage)$('probe').textContent+=`\n流域受け口 #${drainage.terminalCell[i]}（${drainage.terminalKind[i]==='inland-terminal'?'内陸終端':'非陸域へ接続'}） / 上流集水面積 ${(drainage.upstreamLandAreaM2[i]/1e6).toFixed(1)} km²`;if(populationData){const c=populationData.cells[i];$('probe').textContent+=`\n農業適性 ${c.suitability.toFixed(3)} / 地域人口 ${c.population.toLocaleString()} / 食料容量 ${c.capacity.toLocaleString()}人`;}}
  if(territoryData){const assignment=territoryAt(territoryData,point);$('probe').textContent+=`\n仮の領有 ${assignment.territoryId??'未配属または水域'}（広域セル）`;}
  return data;
}
function showError(e) { if(e.name==='AbortError')return;$('error').hidden = false; $('error').textContent = e.message ?? String(e); }
$('space').onclick = () => { fly(20000000, 14); };
$('ground').onclick = () => { fly(30, 14); };
$('tour').onclick = () => { if (state.flight) cancelFlight(); else fly(state.altitude > 100000 ? 30 : 20000000, 26, manifest.focus); };
$('height').oninput = e => { cancelFlight(); setAltitude(sliderAltitude(Number(e.target.value))); };
$('tilt').oninput = e => { state.tilt = Number(e.target.value) * Math.PI / 180; };
$('inspect').onclick = () => inspect().catch(showError);
canvas.onwheel = e => { e.preventDefault(); cancelFlight(); setAltitude(state.altitude * Math.exp(Math.max(-300, Math.min(300, e.deltaY)) * .002)); }; canvas.addEventListener('wheel', () => {}, { passive: false });
canvas.onpointerdown = e => { cancelFlight(); canvas.setPointerCapture(e.pointerId); state.drag = { x: e.clientX, y: e.clientY, orbit: e.shiftKey || e.button === 2 }; };
canvas.onpointermove = e => {
  if (!state.drag) return; const dx = e.clientX - state.drag.x, dy = e.clientY - state.drag.y; state.drag.x = e.clientX; state.drag.y = e.clientY;
  if (state.drag.orbit) { state.tilt = Math.max(0, Math.min(70 * Math.PI / 180, state.tilt + dy * .004)); state.heading -= dx * .006; $('tilt').value = state.tilt * 180 / Math.PI; }
  else state.point = dragPoint(state.point, dx, dy, state.altitude, canvas.clientHeight, state.heading, manifest.base.frame.radiusM);
};
canvas.onpointercancel=()=>{state.drag=null;};
canvas.onpointerup = () => { state.drag = null; inspect().catch(showError); }; canvas.oncontextmenu = e => e.preventDefault();
const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null; };
function memory() {
  const s = stream.stats(), features=buildings?.stats(), tracker=groundTracker?.stats(), trackerBytes=(tracker?.fieldBytes??0)+(tracker?.anchorBytes??0)+(tracker?.featureBytesEstimated??0)+(tracker?.patchBytesEstimated??0)+(tracker?.meshNormalBytesEstimated??0), workerBytes = s.workerStats.reduce((sum, w) => sum + (w.fieldBytes ?? 0) + (w.anchorBytes ?? 0) + (w.featureBytesEstimated ?? 0)+(w.patchBytesEstimated??0)+(w.meshNormalBytesEstimated??0), 0);
  return { jsHeapBytes: performance.memory?.usedJSHeapSize ?? null, gpuBufferBytes: renderer instanceof SoftwareRenderer ? null : s.gpuBytes, cpuMeshBufferBytes: renderer instanceof SoftwareRenderer ? s.gpuBytes : null, workerOwnedBytesEstimated: workerBytes,
    featureLayer:features,retainedFeatureMeshBytes:features?.retainedMeshBytes??0,groundTracker:tracker,groundTrackerOwnedBytesEstimated:trackerBytes,neighborTopologyBytesEstimated:s.neighborTopology.estimatedBytes,tileInfoCache:s.tileInfoCache,trackedOwnedBytes: s.gpuBytes + workerBytes + trackerBytes+(s.tileInfoCache?.bytesEstimated??0)+s.neighborTopology.estimatedBytes+(features?.retainedMeshBytes??0), cacheTiles: s.cacheTiles, allocations: s.allocations, deletions: s.deletions,
    note: 'Window JS heap excludes Worker heaps and driver memory; tracked buffers are not total browser process memory. Retained feature meshes may share buffers with the CPU renderer, so their sum is conservative.' };
}
function beginBenchmark() {
  if (!benchmarkReady({streamReady:!!stream,rootTilesReady:[0,1,2,3,4,5].every(face=>stream?.cache.entries.has(`${face}/0/0/0`)),drawTiles:lastDraw.drawTiles,lost:renderer?.lost,running:!!benchmark})) return;
  const durationSeconds=Number(parameters.get('duration')??120);if(!Number.isFinite(durationSeconds)||durationSeconds<1||durationSeconds>3600){showError(new Error('測定時間は1〜3600秒で指定してください'));return;}
  cancelFlight(); const now = performance.now();
  benchmark = { started: now, durationMs: durationSeconds * 1000, intervals: [], cpu: [], snapshots: [], altitudeMinM: Infinity, altitudeMaxM: 0,
    maxRenderedLevel: 0, minRenderedLevel: 24, noGeometryFrames: 0, maxDisplayedNeighborViolations:0, displayedBalanceFrames:0, frames: 0, lastMemory: -Infinity, initialLongTasks: longTaskCount, initialGpuMs: renderer.gpuMs, initialRenderCount: renderer.renderCount ?? 0, slowFrames: [], visibility: [{ elapsedMs: 0, state: document.visibilityState }] };
  $('benchmark').textContent = '測定中…'; $('state').textContent = '同じ球面で宇宙・地表・日付変更線・極域を往復しています';
}
$('benchmark').onclick = beginBenchmark;
function benchmarkCamera(time) {
  const b = benchmark, progress = (time - b.started) / b.durationMs;
  const cycle = (time-b.started)/60000, part = cycle % 1, p = manifest.focus;
  // Repeat the same 60-second tour during both short and long runs.
  if (part < .4) { const t = part / .4; state.point = { ...p }; setAltitude(Math.exp(Math.log(20000000) * (1 - t) + Math.log(15) * t)); }
  else if (part < .6) { const t = (part - .4) / .2; state.point = offsetGeographic(p, Math.sin(t * Math.PI * 2) * 80, Math.cos(t * Math.PI * 2) * 70, manifest.base.frame.radiusM); setAltitude(15 + 30 * (Math.sin(t * Math.PI) ** 2)); }
  else {
    const t = (part - .6) / .4; setAltitude(Math.exp(Math.log(45) * (1 - t) + Math.log(20000000) * t));
    // Gain clearance above the planet's relief before traveling to distant
    // terrain; low-altitude motion remains within the known local chart.
    const travel = Math.max(0, Math.min(1, Math.log(state.altitude / 20000) / Math.log(20000000 / 20000)));
    state.point = geographicPoint(p.latDeg + (89.9 - p.latDeg) * Math.sin(travel * Math.PI), p.lonDeg + 360 * travel);
  }
  state.tilt = part > .4 && part < .6 ? .48 : 0;
  if (progress >= 1) { state.point = { ...p }; state.tilt = 0; setAltitude(30); finishBenchmark(time); }
}
function captureBenchmarkReport(time,complete=false) {
  const b = benchmark, stats = stream.stats(), elapsed = time - b.started;
  return { ...benchmarkRunProgress({elapsedMs:elapsed,requestedDurationMs:b.durationMs,complete}), schema: 'minimal-world-globe-runtime@1', timestamp: new Date().toISOString(), worldId: manifest.worldId, manifest: manifestURL,
    startupGeometryMs:firstGeometryAt==null?null:firstGeometryAt-startupStarted,
    lodContract: { method: LOD_ERROR_METHOD, targetPixels: LOD_TARGET_PIXELS, pixelHeight:stream.lastPlanPixelHeight, pixelBasis:'actual renderer framebuffer; low-resolution CPU diagnostic is not full-resolution GPU acceptance', scope: 'base derivative bound; actual ground interval where canonical feature recipes are loaded; morph/stitch included in displayed quality; water/overlay accuracy separate' },
    browser: navigator.userAgent, gpu: renderer.device, viewport: lastDraw.viewport, devicePixelRatio, durationMs: elapsed, frames: b.frames,
    averageFPS: b.frames / elapsed * 1000, intervalMs: { p50: percentile(b.intervals, .5), p95: percentile(b.intervals, .95), p99: percentile(b.intervals, .99), max: b.intervalMaxMs },
    mainWorkMs: { p50: percentile(b.cpu, .5), p95: percentile(b.cpu, .95), max: b.cpuMaxMs },
    maxDisplayedNeighborViolations:b.maxDisplayedNeighborViolations,displayedBalanceFrames:b.displayedBalanceFrames,
    timingSample:{count:b.intervals.length,stride:b.sampleStride??1,scope:'evenly spaced frames across the whole run; counts and maxima include every frame'}, framesOver33ms: b.framesOver33ms??0, noGeometryFrames: b.noGeometryFrames,
    longTasks: { supported: longTasksSupported, count: longTaskCount - b.initialLongTasks, longestMs: b.maxLongTaskMs??0, records: longTaskRecords.filter(t => t.startTime >= b.started) },
    slowFrames: b.slowFrames, visibility: b.visibility,
    altitudeMinM: b.altitudeMinM, altitudeMaxM: b.altitudeMaxM, renderedLevelRange: [b.minRenderedLevel, b.maxRenderedLevel],
    gpuTimerAvailable: !!renderer.timer, lastGpuMs: renderer.gpuMs, memorySamples: b.snapshots, limits: stream.limits, streaming: stats,
    witnesses: stream.witnesses, centerProbe: lastProbe,
    rendererKind: renderer instanceof SoftwareRenderer ? 'software-diagnostic' : 'webgl2',
    lastRasterCpuMs:lastDraw.drawCpuMs??null,lastRasterIntervalMs:lastDraw.drawIntervalMs??null,
    actualDrawFPS: renderer instanceof SoftwareRenderer ? (renderer.renderCount-b.initialRenderCount)/elapsed*1000 : b.frames/elapsed*1000,
    fps30Gate:benchmarkFrameBudgetPass({rendererKind:renderer instanceof SoftwareRenderer?'software-diagnostic':'webgl2',actualDrawFPS:b.frames/elapsed*1000,intervalMs:{max:b.intervalMaxMs},framesOver33ms:b.framesOver33ms??0,frames:b.frames}),
    fps30GateScope:'Every recorded frame interval, not p95 alone; requires WebGL2 and at least 30 actual frames/s',
    totalBrowserMemoryGate: 'not-measured; requires browser process/driver measurement',
    stabilityScope: `${(elapsed/1000).toFixed(1)}s automated repeated tour; renderer and process-memory observations are separate; not all-device acceptance` };
}
function finishBenchmark(time) {
  lastReport=captureBenchmarkReport(time,true);
  $('report').textContent = JSON.stringify(lastReport, null, 2); $('benchmark').textContent = '120秒の動作測定';
  $('state').textContent = benchmarkSummary(lastReport); benchmark = null; inspect().catch(showError);
}
$('save-report').onclick = () => {
  if(!stream){$('state').textContent='地形の準備が終わってから記録を保存できます。';return;}
  const report=benchmark?captureBenchmarkReport(performance.now()):lastReport??{
    schema:'planet-display-inspection@1',runStatus:'inspection-only',recordedAt:new Date().toISOString(),manifest:manifestURL,worldId:manifest.worldId,canonicalWorldId:manifest.canonicalWorldId,
    lodPixelHeight:stream.lastPlanPixelHeight, pixelBasis:'actual renderer framebuffer',camera:saveView(manifest.worldId,state),streaming:stream.stats(),limits:stream.limits,draw:lastDraw,witnesses:stream.witnesses,centerProbe:lastProbe,
    rendererKind:renderer instanceof SoftwareRenderer?'software-diagnostic':'webgl2',
    scope:'Single display inspection; not a completed benchmark, continuous stability result or visual acceptance.'};
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })); a.download = report.runStatus==='completed'?'globe-runtime.json':report.runStatus==='inspection-only'?'globe-inspection.json':'globe-checkpoint.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
let navigationStateKey=null;
function rememberNavigationView(){
  if(!manifest||benchmark||state.flight)return;
  const value={planetView:saveView(manifest.worldId,state),planetSettlementId:$('settlement').value},key=JSON.stringify(value);
  if(key===navigationStateKey)return;
  try{history.replaceState({...history.state,...value},'');navigationStateKey=key;}catch{}
}
function frame(time) {
  if (!stream||stream.destroyed) return; const start = performance.now(), dt = lastTime ? time - lastTime : 16.7; lastTime = time;
  if (renderer.lost) { $('benchmark').disabled=true; $('state').textContent='GPU接続が失われました。復帰を待っています'; if(benchmark){benchmark=null;$('benchmark').textContent='120秒の動作測定';$('report').textContent='GPU接続喪失で測定中断。性能合格ではありません。';} return; }
  if (benchmark) benchmarkCamera(time); else updateFlight(time);
  if(state.altitude<5000){const tracked=groundTracker?.tick(state.point,time);if(tracked){state.ground=tracked.surfaceElevationM;state.groundReference={up:sphereBasis(state.point).up,elevationM:tracked.rawGroundElevationM};}}
  const cam = camera(); cam.sun=solarDirection(solarState);cam.radiusM=manifest.base.frame.radiusM;
  const daylight=solarAt(state.point,solarState);$('sun-time').value=String(daylight.localHour);$('sun-status').textContent=`当地 ${daylight.localHour.toFixed(1)}時 / 太陽高度 ${daylight.altitudeDeg.toFixed(1)}° / ${daylight.phase}`;
  if (time - lastPlan > 180) { stream.requestPlan(cam, renderer instanceof SoftwareRenderer ? softwareViewportSize(canvas.clientWidth,canvas.clientHeight)[1] : Math.round(canvas.clientHeight * Math.min(1.5, devicePixelRatio || 1))); lastPlan = time; }
  const contourSelection=$('contour-interval').value,contourInterval=contourSelection==='auto'?automaticContourInterval(2*state.altitude/cam.focal*Math.max(1,cam.aspect)):Number(contourSelection);
  $('contour-status').textContent=contourInterval?`等高線 ${contourInterval} m 間隔${contourSelection==='auto'?'（縮尺に応じて自動）':''} / 標高は変更しません`:'';
  populationZoneView?.update(cam,time,$('map-layer').value==='population');
  const zones=populationZoneView?.zones??settlementLabels?.pages.deferred?.lastZones;if($('map-layer').value==='population'&&thematicMap&&zones&&zones!==lastPopulationZones){lastPopulationZones=zones;const zoneOverlay=makePopulationZoneOverlay(zones,manifest.base.frame.radiusM,state.point.lonDeg);const baseKey=thematicMap.baseKey??thematicMap.key;thematicMap={...thematicMap,baseKey,key:baseKey+':'+(zoneOverlay?.key??'coarse'),zoneOverlay};}
  const tiles = stream.frame(cam, dt); lastDraw = renderer.draw({...cam,thematicMap,contourInterval}, [...tiles, ...(buildings?.update(cam) ?? [])], time);
  settlementLabels?.update(cam,canvas.clientWidth,canvas.clientHeight,time,$('show-labels').checked);
  territoryLabels?.update(territoryData,cam,manifest.base.frame.radiusM,canvas.clientWidth,canvas.clientHeight,$('map-layer').value==='territory'&&$('show-labels').checked);
  if(tiles.length&&firstGeometryAt==null)firstGeometryAt=performance.now();
  const ready=benchmarkReady({streamReady:true,rootTilesReady:[0,1,2,3,4,5].every(face=>stream.cache.entries.has(`${face}/0/0/0`)),drawTiles:lastDraw.drawTiles,lost:renderer.lost,running:!!benchmark});
  $('benchmark').disabled=!ready;
  if(autoBenchmarkPending&&ready&&time>=autoBenchmarkAfter){autoBenchmarkPending=false;beginBenchmark();}
  const cpuMs = performance.now() - start;
  sampleIntervals.push(dt); if (sampleIntervals.length > 120) sampleIntervals.shift();
  if (benchmark) {
    const b = benchmark; b.maxDisplayedNeighborViolations=Math.max(b.maxDisplayedNeighborViolations,stream.displayedNeighborViolations??0);if(stream.displayedBalanceCollapsed)b.displayedBalanceFrames++;recordBenchmarkFrame(b,dt,cpuMs);
    if (dt > 1000 / 30 && b.slowFrames.length < 128) b.slowFrames.push({ elapsedMs: time - b.started, intervalMs: dt, cpuMs, heightM: state.altitude, drawTiles: tiles.length });
    b.altitudeMinM = Math.min(b.altitudeMinM, state.altitude); b.altitudeMaxM = Math.max(b.altitudeMaxM, state.altitude);
    for (const t of tiles) { b.minRenderedLevel = Math.min(b.minRenderedLevel, t.tile.tile.level); b.maxRenderedLevel = Math.max(b.maxRenderedLevel, t.tile.tile.level); }
    if (!tiles.length) b.noGeometryFrames++;
    if (time - b.lastMemory > 1000) { b.snapshots.push({ elapsedMs: time - b.started, ...memory() }); b.lastMemory = time; }
  }
  if (time - lastHUD > 500) {
    rememberNavigationView();
    const featureStats=buildings?.stats();if($('feature-status'))$('feature-status').textContent=featureStats?`建物・道路・植生の形状 ${(featureStats.uploadedBytes/1048576).toFixed(1)} MiB / ${featureStats.loadedFeatures}形状チャンク表示 / 読込中 ${featureStats.pending}${featureStats.budgetDeferred?' / 表示予算により '+featureStats.budgetDeferred+'チャンクを保留':''}${featureStats.errors.length?' / 読込問題: '+[...new Set(featureStats.errors)].join('、'):''}`:'';const layouts=featureStats?.layouts??[];$('layout-status').textContent=summarizeLayouts(layouts);const routeResults=buildings?.stats().routes??[];if($('road-status'))$('road-status').title=routeResults.map(r=>`${r.id}: ${r.status} ${r.reason??''}`).join('\n');if($('road-status'))$('road-status').textContent=roadDisplaySummary(routeResults);
    const s = stream.stats(), fps = 1000 / (sampleIntervals.reduce((a, b) => a + b, 0) / sampleIntervals.length);
    const groundStatus=heightScale!==1?'強調表示中：地形の数値・物理判定は1倍のまま':groundDisplaySummary(s,{drawTiles:tiles.length,software:renderer instanceof SoftwareRenderer});
    if($('ground-status').textContent!==groundStatus)$('ground-status').textContent=groundStatus;
    $('height-label').textContent = state.altitude >= 1000 ? `${(state.altitude / 1000).toFixed(1)} km` : `${state.altitude.toFixed(1)} m`;
    $('position').textContent = `${state.point.latDeg.toFixed(6)}°, ${state.point.lonDeg.toFixed(6)}° · 高さ ${state.altitude.toFixed(1)} m`;
    $('metrics').textContent = `${renderer instanceof SoftwareRenderer ? (lastDraw.cachedFrame?'静止画再利用（CPU診断）':`${(lastDraw.drawFPS??0).toFixed(1)} 描画fps（CPU診断）`) : `${fps.toFixed(0)} fps`} · ${lastDraw.drawTiles} tiles · L${Math.max(0, ...tiles.map(t => t.tile.tile.level))} · ${renderer instanceof SoftwareRenderer ? 'CPU形状' : 'GPU'} ${(s.gpuBytes / 1048576).toFixed(1)} MiB · 読込 ${s.activeWorkers}/2`;
    const up = sphereBasis(state.point).up;
    const nearest = [...tiles].sort((a, b) => a.tile.anchor.reduce((sum, v, i) => sum + (v - up[i] * (manifest.base.frame.radiusM + state.ground)) ** 2, 0) - b.tile.anchor.reduce((sum, v, i) => sum + (v - up[i] * (manifest.base.frame.radiusM + state.ground)) ** 2, 0)).slice(0, 3);
    $('coverage').textContent = JSON.stringify({lodPixelHeight:stream.lastPlanPixelHeight,pixelBasis:'actual renderer framebuffer',features:featureStats,plan:s.lodQuality,workers:s.workerRecovery,workerBuilds:s.workerStats.map(w=>({lastMeshBuildMs:w.lastMeshBuildMs,yieldMethod:w.lastMeshSampling?.cooperativeYield,surfaceQueries:w.lastMeshSampling?.surfaceQueries})),planningActive:s.planningActive,wantedTiles:s.wantedTiles,quality:s.displayedQuality,neighborViolations:s.displayedNeighborViolations,balancedSubtrees:s.displayedBalanceCollapsed,planningWorkMs:s.lastPlanningWorkMs,nearest:nearest.map(t => ({ tile: t.tile.tile, morph: t.morph, overlays: t.tile.overlay?.count ?? 0,
      geometricError: t.tile.geometricError, morphErrorM: t.tile.morphErrorM, witness: t.tile.witness }))}, null, 2);
    if (!benchmark && !lastReport) $('state').textContent = `${s.completedMeshes}枚を非同期生成 · 保持 ${s.cacheTiles}枚 · 破棄 ${s.cacheEvictions}枚${tiles.some(t=>t.tile.pendingFeatures>0)?' · 道路を調査中（地形は途中表示）':''}${s.errors.length ? ' · ' + s.errors.at(-1) : ''}`;
    lastHUD = time;
  }
  requestAnimationFrame(frame);
}
$('restart-workers').onclick=()=>{if(!stream)return;stream.restartWorkers();$('state').textContent='表示中の地形を残して、2つの読込処理を再起動しました';};
$('save-view').onclick=()=>{try{localStorage.setItem(`planet-view:${manifest.worldId}`,JSON.stringify(saveView(manifest.worldId,state)));$('state').textContent='この世界の視点を保存しました';}catch(e){showError(e);}};
$('restore-view').onclick=()=>{try{const raw=localStorage.getItem(`planet-view:${manifest.worldId}`);if(!raw)throw new Error('この世界の保存した視点はありません');const saved=validateView(raw,manifest.worldId);cancelFlight();state.point=saved.point;state.tilt=saved.tilt;state.heading=saved.heading;setAltitude(saved.altitude);$('tilt').value=state.tilt*180/Math.PI;inspect().catch(showError);}catch(e){showError(e);}};
canvas.addEventListener('webglcontextrestored',()=>{
  if(!(renderer instanceof GlobeRenderer))return;
  try{buildings.destroy();stream.destroy();renderer=new GlobeRenderer(canvas);renderer.radiusM=manifest.base.frame.radiusM;stream=new GlobeStream(renderer,manifest,manifestURL,streamOptions);buildings=new BuildingLayer(renderer,manifest,manifestURL);lastPlan=-Infinity;lastTime=0;$('error').hidden=true;$('state').textContent='GPU接続が復帰しました。保存済みの世界から形状を再読込しています';requestAnimationFrame(frame);inspect().catch(showError);}catch(e){showError(e);}
});
document.addEventListener('visibilitychange', () => { if (benchmark && benchmark.visibility.length < 128) benchmark.visibility.push({ elapsedMs: performance.now() - benchmark.started, state: document.visibilityState }); });
try {
  manifest=JSON.parse(await readPage(fetch,manifestURL,{kind:'text'}));
  if(parameters.get('terrain')==='shape-first'){
    if(parameters.has('sfParentWorld')&&parameters.get('sfParentWorld')!==manifest.worldId)throw new Error('このドラフトの配置先と保存惑星の識別子が一致しません。元の惑星データを開いてください。');
    const model=await loadShapeFirstModel({seed:parameters.get('sfSeed')}),options={};
    for(const [query,key]of [['sfLat','latDeg'],['sfLon','lonDeg'],['sfTransition','transitionM'],['sfElevation','elevationOffsetM']])if(parameters.has(query))options[key]=Number(parameters.get(query));
    manifest=await prepareShapeFirstPlanetPlacement(manifest,model,new PagedSource(manifest,manifestURL,fetch,{materializationStorage:null}),options);
    if(parameters.has('sfOutletIdentity')&&parameters.get('sfOutletIdentity')!==manifest.shapeFirstRegion.outletIdentity)throw new Error('保存した流出口の接続先・経路と再読込結果が一致しません。元の実行環境と惑星データを使用してください。');
    if(parameters.has('sfRuntimeVersion')&&parameters.get('sfRuntimeVersion')!==manifest.shapeFirstRegion.runtimeVersion)throw new Error('このドラフトの球面・流出口モデルのバージョンが一致しません。元の実行環境を使用してください。');
    if(parameters.has('sfChannelVersion')&&parameters.get('sfChannelVersion')!==manifest.shapeFirstRegion.channelSchema)throw new Error('このドラフトの水路設計バージョンと実行環境が一致しません。元のバージョンを使用してください。');
    manifest.shapeFirstRegion.showSymbols=parameters.get('sfSymbols')!=='off';
    const placedURL=new URL(location.href);for(const [key,value]of Object.entries({sfOutletIdentity:manifest.shapeFirstRegion.outletIdentity,sfRuntimeVersion:manifest.shapeFirstRegion.runtimeVersion,sfChannelVersion:manifest.shapeFirstRegion.channelSchema,sfParentWorld:manifest.shapeFirstRegion.parentWorldId,sfLat:manifest.focus.latDeg,sfLon:manifest.focus.lonDeg,sfTransition:manifest.shapeFirstRegion.transitionM,sfElevation:manifest.shapeFirstRegion.elevationOffsetM}))placedURL.searchParams.set(key,String(value));history.replaceState(history.state,'',placedURL.href);
    const label=document.createElement('p');label.id='shape-first-planet-status';label.textContent=`球面ドラフト / 原形 ${model.candidate.grid.columns}×${model.candidate.grid.rows}点 / 中心 ${manifest.focus.latDeg.toFixed(5)}, ${manifest.focus.lonDeg.toFixed(5)} / 外側${manifest.shapeFirstRegion.transitionM} mを保存惑星へ滑らかに接続。最低30 mの陸地配置（自動時） / 標高配置 ${manifest.shapeFirstRegion.elevationOffsetM>=0?'+':''}${manifest.shapeFirstRegion.elevationOffsetM.toFixed(1)} m。明るい青線は川筋の記号（幅48 mの描画用）。濃い青の水面・河床・深さは供給仮定から設計した値で、水理検証済みではありません。${manifest.shapeFirstRegion.outletConnection?'流出口は保存河川 '+manifest.shapeFirstRegion.outletConnection.receiver.id+' へ接続（受け側の流量応答は未検証）。':'流出口は未接続：30 km以内に検証可能な受け側を確認できません。'}旧集落・道路レイヤーはこのドラフトでは省略。${model.storageStatus==='memory-only'?'保存できていません: '+(model.storageWarning??'このタブ内のみ'):model.storageStatus==='saved'?'生成形状を保存済み。':'保存済みの同梱形状。'}`;
    const button=document.createElement('button');button.id='shape-first-region';button.textContent='形状優先の地域へ';button.onclick=()=>{const view=shapeFirstOverview(manifest.shapeFirstRegion);state.tilt=view.tiltDeg*Math.PI/180;$('tilt').value=view.tiltDeg;fly(view.altitudeM,3,manifest.focus);};
    const toggleLabel=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.id='shape-first-symbols';toggle.checked=manifest.shapeFirstRegion.showSymbols;toggle.onchange=()=>{const next=new URL(location.href);next.searchParams.set('sfSymbols',toggle.checked?'on':'off');history.replaceState({...history.state,planetView:saveView(manifest.worldId,state)},'',next.href);location.reload();};toggleLabel.append(toggle,'川筋の記号を重ねる（実際の水面とは別）');document.querySelector('.controls').prepend(label,button,toggleLabel);
    installShapeFirstPanel({model,manifest,status:label,regionButton:button,symbolLabel:toggleLabel});
  }
  const generation=manifest.generationDiagnostics;$('generation-status').textContent=generation?`${manifest.settlementCatalogue?manifest.settlementCatalogue.totals.placed.toLocaleString()+'集落（住宅は必要時生成） / 詳細地形を保存した':'詳細地形を保存した'}${generation.generatedSettlements}集落 / 湖${generation.hydrologyScope?.lakes??manifest.waterBodies?.length??0} / 河川${generation.globalRivers?.acceptedProfiles??0}区間 / 幹線の生成除外${generation.globalRivers?.rejected?.length??0}区間`:'明示した保存世界';
  if(manifest.shapeFirstRegion)$('generation-status').textContent='選択形状を球面に配置した独立ドラフト。旧世界の地域詳細は再利用しません。';
  $('memory-budget').value=String(streamOptions.meshBudgetMiB);
  $('memory-budget').onchange=()=>{const target=new URL(location.href);target.searchParams.set('meshBudgetMiB',$('memory-budget').value);cancelFlight();history.replaceState({...history.state,planetView:saveView(manifest.worldId,state),planetSettlementId:$('settlement').value},'',target.href);location.reload();};
  $('world-version').textContent=worldVersionLabel(manifest);
  const savedLandscape=savedLandscapeSummary(manifest);$('saved-landscape-status').textContent=savedLandscape.text;
  $('show-new-generation').hidden=savedLandscape.current;
  $('show-new-generation').onclick=()=>{$('generation-panel').open=true;$('world-seed').focus();};
  loadWorldCatalog();state.point = { ...manifest.focus };let restoredNavigationView=false;
  if(history.state?.planetView){try{const saved=validateView(history.state.planetView,manifest.worldId);state.point=saved.point;state.tilt=saved.tilt;state.heading=saved.heading;setAltitude(saved.altitude);$('tilt').value=state.tilt*180/Math.PI;restoredNavigationView=true;}catch{}}
   try{const savedSun=JSON.parse(localStorage.getItem(`planet-sun:${manifest.worldId}`)??'null');if(savedSun){solarDirection(savedSun);solarState=savedSun;}else{solarState.dayFraction=dayFractionForLocalHour(manifest.focus.lonDeg,manifest.shapeFirstRegion?shapeFirstOverview(manifest.shapeFirstRegion).localHour:12);saveSun();}}catch{}
   try{heightScale=validateHeightScale(Number(localStorage.getItem(`planet-height-scale:${manifest.worldId}`)??1));}catch{heightScale=1;}
   $('height-scale').value=String(heightScale);$('height-scale-label').textContent=`地形の強調倍率 ${heightScale}×（表示のみ）`;
   $('height-scale').onchange=()=>{heightScale=validateHeightScale(+$('height-scale').value);localStorage.setItem(`planet-height-scale:${manifest.worldId}`,heightScale);$('height-scale-label').textContent=`地形の強調倍率 ${heightScale}×（表示のみ）`;lastPlan=-Infinity;};
   $('sun-season').value=solarState.declinationDeg;
   $('world-name').textContent = manifest.name; renderer = parameters.get('renderer') === 'software' ? new SoftwareRenderer(canvas) : new GlobeRenderer(canvas); renderer.radiusM=manifest.base.frame.radiusM;stream = new GlobeStream(renderer, manifest, manifestURL,streamOptions); buildings = new BuildingLayer(renderer, manifest, manifestURL);
  groundTracker=new GroundTracker(new PagedSource(manifest,manifestURL));
  $('materialization-status').textContent=materializationStatusText({available:Boolean(groundTracker.source.materializer),deferredPopulation:manifest.settlementCatalogue?.method==='on-reference-population@1'});
  territoryLabels=new TerritoryLabels($('territory-labels'));
  $('climate-link').href=`./climate.html?world=${encodeURIComponent(manifestURL)}`;
  $('network-link').href=`./network.html?world=${encodeURIComponent(manifestURL)}${parameters.get('renderer')==='software'?'&renderer=software':''}`;
  $('data-availability').textContent=dataAvailability(manifest).map(d=>`${d.name}: ${d.status}\n${d.detail}`).join('\n\n');

  const choices = document.getElementById("settlement");
  for (const place of manifest.settlements ?? []) { const option=document.createElement("option"); option.textContent=`${place.name} · ${place.id}`; option.value=place.id; choices.append(option); }
  const selectPlaceLinks=id=>{for(const[name,page]of [['settlement-plan-link','settlement.html'],['vehicle-link','vehicle.html'],['runoff-link','runoff.html'],['bridge-check-link','bridge.html']]){const href=worldExperimentLink(page,manifest,manifestURL,location.href,id);if(href){$(name).href=href;$(name).removeAttribute('aria-disabled');}else{$(name).removeAttribute('href');$(name).setAttribute('aria-disabled','true');$(name).title='この世界には集落実験に必要な集落と全体保存がありません';}}};
  const restoredPlace=history.state?.planetView?.worldId===manifest.worldId?manifest.settlements?.find(p=>p.id===history.state.planetSettlementId):null;
  if(restoredPlace)choices.value=restoredPlace.id;
  selectPlaceLinks(restoredPlace?.id??manifest.settlements?.[0]?.id);
  choices.onchange=()=>{const place=manifest.settlements.find(p=>p.id===choices.value);if(place){selectPlaceLinks(place.id);fly(350,14,place);}};
  settlementLabels?.destroy();settlementLabels=new SettlementLabels(manifest,manifestURL,$('map-labels'),$('nearby-settlement'),place=>{choices.value=place.id;selectPlaceLinks(place.id);$('catalogue-status').textContent=`${place.name} / ${place.id}${place.population?' / '+place.population+'人':''}${territoryData?' / 仮の領有 '+(territoryAt(territoryData,place).territoryId??'未配属または水域'):''}。近づくと住宅区画を生成します。町・都市の全施設は未完成です。`;fly(350,3,place);});
  $('populate-world').hidden=manifest.settlementCatalogue?.runtimeVersion===SETTLEMENT_RUNTIME_VERSION;if(manifest.settlementCatalogue)$('populate-world').textContent='この保存世界の集落・道路計画を更新';
  if(manifest.settlementCatalogue){const t=manifest.settlementCatalogue.totals;$('catalogue-status').textContent=t.deferred?`未確定の集落予定 ${t.deferred.toLocaleString()}。近づいた地域を確定・保存します。人口レイヤーで広域の分布を確認できます。`:`位置確定 ${t.placed.toLocaleString()}集落 / 敷地条件・処理予算で未配置 ${t.unplaced.toLocaleString()}。街並みは接近時に生成。ラベルは重なりを間引いて表示。`;}
  const waterSiteChoices=$('water-settlement'),waterSites=waterSettlementViews(manifest.settlementCatalogue);
  for(const p of waterSites){const o=document.createElement('option');o.value=p.id;o.textContent=`${p.name} · ${p.id} / 川まで約${Math.round(p.approachDistanceM)} m`;waterSiteChoices.append(o);}
  waterSiteChoices.disabled=!waterSites.length;$('water-settlement-coverage').textContent=settlementWaterCoverageText(manifest.settlementCatalogue);
  waterSiteChoices.onchange=()=>{const p=waterSites.find(p=>p.id===waterSiteChoices.value);if(p){selectPlaceLinks(p.id);state.tilt=60*Math.PI/180;$('tilt').value=60;fly(p.viewAltitudeM,3,p);}};
  const landforms=manifest.landformInspection?.targets??[],landformChoices=$('landform');
  for(const p of landforms){const option=document.createElement('option');option.value=p.id;option.textContent=`${p.name}（測定高低差 ${Math.round(p.reliefM)} m）`;landformChoices.append(option);}
  landformChoices.disabled=!landforms.length;
  $('landform-survey').textContent=landforms.length?'地表を33点ずつ測った移動先です。地形全域の最高・最低点ではありません。':'この保存世界には起伏の測定先がありません。山や丘が存在しないという意味ではありません。';
  landformChoices.onchange=()=>{const p=landforms.find(p=>p.id===landformChoices.value);if(!p)return;
    $('landform-survey').textContent=`半径 ${p.surveyRadiusM} m内の陸地${p.drySamples}/${p.totalSamples}点：標高 ${Math.round(p.minElevationM)}〜${Math.round(p.maxElevationM)} m、高低差 ${Math.round(p.reliefM)} m。測定点間の起伏は未集計です。`+landformShapeSummary(p.shapeContext);
    state.tilt=55*Math.PI/180;$('tilt').value=55;fly(p.viewAltitudeM,3,p);};
  const lakeChoices=$('lake');for(const lake of manifest.waterBodies??[]){const option=document.createElement('option');option.textContent=lake.name;option.value=lake.id;lakeChoices.append(option);}lakeChoices.disabled=!(manifest.waterBodies?.length);
  const riverChoices=$('river'),shapeRegion=createShapeFirstPlanetRegion(manifest.shapeFirstRegion),riverDestinations=shapeRegion?shapeRegion.rivers.map(r=>({...shapeRegion.geographic(r.points[Math.floor(r.points.length/2)].xM,r.points[Math.floor(r.points.length/2)].yM),id:r.id,name:`設計川筋 ${r.id} / 仮流量 ${r.outletM3PerSecond.toFixed(3)} m³/s`,viewAltitudeM:3000})):riverViews(manifest.rivers);
  if(shapeRegion?.connector){const connection=shapeRegion.connector,midpoint=connection.route.points[Math.floor(connection.route.points.length/2)];
    for(const [id,name,point]of [['shape-outlet','地域の流出口',connection.spec.outlet],['shape-connection','外側へつなぐ水路の中間',midpoint],['shape-receiver','保存河川への合流点',connection.spec.receiver]])riverDestinations.push({...shapeRegion.geographic(point.xM,point.yM),id,name,viewAltitudeM:300});
  }
  for(const river of riverDestinations){const option=document.createElement('option');option.textContent=river.name;option.value=river.id;riverChoices.append(option);}
  riverChoices.disabled=!riverDestinations.length;
  $('river-coverage').textContent=shapeRegion?'選択形状の設計川筋。流量は仮の注釈。水面・深さ・川幅は設計値で水理検証済みではありません。':tributaryCoverageText(manifest.rivers);
  riverChoices.onchange=()=>{const river=riverDestinations.find(r=>r.id===riverChoices.value);if(river){state.tilt=45*Math.PI/180;$('tilt').value=45;fly(river.viewAltitudeM,3,river);}};
  let shoreIndex=0;
  $('lake-shore').onclick=()=>{const lake=manifest.waterBodies.find(p=>p.id===lakeChoices.value),view=lakeShoreView(lake,manifest.base.frame.radiusM,shoreIndex++);if(!view)return;state.tilt=view.tiltRad;state.heading=view.headingRad;$('tilt').value=55;fly(view.altitudeM,10,view.point);};
  lakeChoices.onchange=()=>{const lake=manifest.waterBodies.find(p=>p.id===lakeChoices.value);shoreIndex=0;$('lake-shore').disabled=!lakeShoreView(lake,manifest.base.frame.radiusM);if(lake){state.tilt=0;$('tilt').value=0;fly(lake.viewAltitudeM,10,lake);}};
  const bridgeChoices=$('bridge');
  for(const bridge of manifest.bridges??[]){const option=document.createElement('option');option.textContent=bridge.name;option.value=bridge.id;bridgeChoices.append(option);}
  bridgeChoices.disabled=!(manifest.bridges?.length);
  bridgeChoices.onchange=()=>{const bridge=manifest.bridges.find(p=>p.id===bridgeChoices.value);if(bridge){selectPlaceLinks(bridge.settlementId);choices.value=bridge.settlementId;state.tilt=55*Math.PI/180;$('tilt').value=55;fly(100,10,bridge);}};
  for(const id of ['space','ground','tour','inspect','save-view','restore-view','restart-workers'])$(id).disabled=false;
  populationZoneView?.destroy();populationZoneView=new PopulationZoneView(settlementLabels?.pages.deferred,manifest.base.frame.radiusM);
  const requestedSite=manifest.settlementNetwork?.sites.find(p=>p.id===parameters.get('site'))??await settlementLabels?.pages.getSite(parameters.get('site'));if(requestedSite&&!restoredNavigationView){selectPlaceLinks(requestedSite.id);state.point={latDeg:requestedSite.latDeg,lonDeg:requestedSite.lonDeg};setAltitude(requestedSite.id.startsWith('pop:')?1500:100000);}
  const requestedRiver=riverDestinations.find(r=>r.id===parameters.get('river'));if(requestedRiver&&!restoredNavigationView){riverChoices.value=requestedRiver.id;state.point={latDeg:requestedRiver.latDeg,lonDeg:requestedRiver.lonDeg};state.tilt=45*Math.PI/180;$('tilt').value=45;setAltitude(requestedRiver.viewAltitudeM);}
  if(manifest.shapeFirstRegion&&!restoredNavigationView&&!requestedRiver){const view=shapeFirstOverview(manifest.shapeFirstRegion);setAltitude(parameters.get('sfView')==='global'?20000000:view.altitudeM);state.tilt=parameters.get('sfView')==='global'?0:view.tiltDeg*Math.PI/180;$('tilt').value=state.tilt*180/Math.PI;}
  if(manifest.shapeFirstRegion&&parameters.has('sfAltitude')&&!restoredNavigationView){const altitude=Number(parameters.get('sfAltitude'));if(!Number.isFinite(altitude)||altitude<3||altitude>40000000)throw new Error('地域視点の高度が不正です');setAltitude(altitude);}
  requestAnimationFrame(frame); inspect().catch(showError);
  if (parameters.get('benchmark') === 'auto'){autoBenchmarkPending=true;autoBenchmarkAfter=performance.now()+10000;}
  installPageRecovery({onHide:()=>{
    cancelFlight();++inspectGeneration;
    rememberNavigationView();
    const featureStats=buildings?.stats();if($('feature-status'))$('feature-status').textContent=featureStats?`建物・道路・植生の形状 ${(featureStats.uploadedBytes/1048576).toFixed(1)} MiB / ${featureStats.loadedFeatures}形状チャンク表示 / 読込中 ${featureStats.pending}${featureStats.budgetDeferred?' / 表示予算により '+featureStats.budgetDeferred+'チャンクを保留':''}${featureStats.errors.length?' / 読込問題: '+[...new Set(featureStats.errors)].join('、'):''}`:'';const layouts=featureStats?.layouts??[];$('layout-status').textContent=summarizeLayouts(layouts);const routeResults=buildings?.stats().routes??[];if($('road-status'))$('road-status').title=routeResults.map(r=>`${r.id}: ${r.status} ${r.reason??''}`).join('\n');if($('road-status'))$('road-status').textContent=roadDisplaySummary(routeResults);
    populationZoneView?.destroy();settlementLabels?.destroy();groundTracker?.destroy();buildings.destroy();stream.destroy();
  }});
} catch (e) { showError(e); }

let generationPoll=null;
async function pollGeneration(){
 try{const response=await fetch('/api/planet-generation');if(!response.ok)throw new Error('生成サーバーに接続できません');const j=await response.json();
 $('generate-status').textContent=generationJobMessage(j);
 $('generate-submit').disabled=j.status==='running';if(j.status==='complete'){const target=new URL(j.url,location.href);if(parameters.get('renderer')==='software')target.searchParams.set('renderer','software');$('generated-world').href=target.href;$('generated-world').textContent=`seed「${j.seed??'不明'}」の生成結果を開く`;$('generated-world').hidden=false;}
 if(j.status==='running')generationPoll=setTimeout(pollGeneration,2000);
 }catch(e){$('generate-status').textContent=e.message;$('generate-submit').disabled=false;}
}
const syncDeferredWaterChoice=()=>{const allowed=$('deferred-population').checked;$('deferred-water').disabled=!allowed;if(!allowed)$('deferred-water').checked=false;const empty=$('unpopulated-water');if(empty){empty.disabled=!allowed||!$('deferred-water').checked;if(empty.disabled)empty.checked=false;}};
$('deferred-population').addEventListener('change',syncDeferredWaterChoice);
$('deferred-water').addEventListener('change',syncDeferredWaterChoice);
syncDeferredWaterChoice();
$('generate-world').onsubmit=async e=>{e.preventDefault();clearTimeout(generationPoll);$('generate-submit').disabled=true;$('generated-world').hidden=true;
 try{const response=await fetch('/api/planet-generation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({seed:$('world-seed').value,deferredPopulation:$('deferred-population').checked,deferredWater:$('deferred-population').checked&&$('deferred-water').checked,unpopulatedWater:$('deferred-population').checked&&$('deferred-water').checked&&Boolean($('unpopulated-water')?.checked),population:Number($('population-count').value),sites:Number($('site-count').value),settlements:Number($('detail-count').value),localTributaries:$('local-tributaries').checked,riverDetail:$('river-detail').value,landformShape:$('landform-shape').value})});if(response.status===405||response.status===404)throw new Error('start-planetでサーバーを起動し直してください');const j=await response.json();if(!response.ok)throw new Error(j.error);await pollGeneration();}catch(error){$('generate-status').textContent=error.message;$('generate-submit').disabled=false;}
};

$('generation-panel').ontoggle=()=>{if($('generation-panel').open){clearTimeout(generationPoll);pollGeneration();}};

$('populate-world').onclick=async()=>{
 $('populate-world').disabled=true;
 try{const u=new URL(manifestURL);if(u.origin!==location.origin)throw new Error('同じサーバー上の保存世界のみ更新できます');const r=await fetch('/api/planet-generation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'populate',manifest:decodeURIComponent(u.pathname)})});if(!r.ok){let message='サーバーを再起動してください';try{message=(await r.json()).error??message;}catch{}throw new Error(message);}$('generation-panel').open=true;$('catalogue-status').textContent='元の地形と集落を保持した別の保存版を生成しています。';await pollGeneration();}catch(e){$('catalogue-status').textContent=e.message;}finally{$('populate-world').disabled=false;}
};
import {riverViews,tributaryCoverageText,waterSettlementViews,settlementWaterCoverageText} from './river-views.mjs';

$('inspect-crossings')?.addEventListener('click',async()=>{
 const button=$('inspect-crossings'),output=$('crossing-results');button.disabled=true;output.textContent='両岸を調べています…';
 try{const results=await inspectVisibleCrossings(buildings);output.replaceChildren();if(!results.length)output.textContent='付近には、広域の渡河計画が必要と判定された接続がまだありません。';
 for(const result of results){const section=document.createElement('p');section.textContent=`${result.connectionId}：岸の候補 ${result.candidates.length} 組。橋・渡し船・接続道路は未建設。`;output.append(section);
 for(const [i,c] of result.candidates.entries()){const row=document.createElement('p');row.textContent=`候補 ${i+1}：水域の幅 約${Math.round(c.sampledWetLengthM)}m。岸の陸側の傾斜 約${(100*c.nearBankGrade).toFixed(1)}% / ${(100*c.farBankGrade).toFixed(1)}%。 `;for(const [label,p] of [['手前の岸',c.nearBank],['向こう岸',c.farBank]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>{state.point={latDeg:p.latDeg,lonDeg:p.lonDeg};state.altitude=1000;state.ground=p.groundElevationM;state.groundReference=null;});row.append(b);}output.append(row);}
 const note=document.createElement('p');note.textContent='流れの強さ、洪水、船の運航、施設の地盤、村からの道はまだ確認していません。';output.append(note);}
 }catch(e){output.textContent=e.message;}finally{button.disabled=false;}
});

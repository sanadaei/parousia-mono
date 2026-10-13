import { PagedSource } from './paged-source.mjs';
import { buildMesh } from './mesh.mjs';
import { offsetGeographic, sphereBasis } from '../core/spherical.mjs';
let source, active = null;
self.onmessage = async ({ data: m }) => {
  if (m.type === 'init') { source = new PagedSource(m.manifest, m.url); self.postMessage({ type: 'ready' }); return; }
  if (m.type === 'cancel') { if (active?.id === m.id) active.controller.abort(); return; }
  if (m.type === 'dispose') { active?.controller.abort(); source.cache.clear(); source.anchors.clear(); self.close(); return; }
  if (active) { self.postMessage({ type: 'error', id: m.id, error: 'Worker already busy' }); return; }
  if(m.retainedTiles)source.retainRoadWork(new Set(m.retainedTiles));
  const job = { id: m.id, controller: new AbortController() }; active = job;const releaseWater=source.beginWaterWork?.();
  try {
    if (m.type === 'probe') {
      await source.prepareSettlements({center:sphereBasis(m.point).up,angular:500/source.manifest.base.frame.radiusM},job.controller.signal);
      await source.enableFeaturesAt(m.point, job.controller.signal);
      const p = m.point, radius = source.manifest.base.frame.radiusM, d = source.manifest.base.derivativeStepM;
      let sample = await source.ready(() => source.sample(p.latDeg, p.lonDeg), job.controller.signal);
      const offset = async (east, north) => { const q = offsetGeographic(p, east, north, radius); return source.ready(() => source.sample(q.latDeg, q.lonDeg).groundElevationM, job.controller.signal); };
      const east = ((await offset(d, 0)) - (await offset(-d, 0))) / (2 * d), north = ((await offset(0, d)) - (await offset(0, -d))) / (2 * d);
      sample=source.applySurfaceSlope(p.latDeg,p.lonDeg,sample,Math.hypot(east,north));
      const baseGroundElevationM = await source.ready(() => source.rawGroundElevationAt(p.latDeg, p.lonDeg), job.controller.signal);
      self.postMessage({ type: 'probe', id: m.id, point: p, sample: { ...sample, baseGroundElevationM, gradientEastNorth: { east, north }, slopeMPerM: Math.hypot(east, north) }, stats: source.stats() });
    } else {
      const started=performance.now(),mesh = await buildMesh(source, m.tile, job.controller.signal),buildMs=performance.now()-started;
      self.postMessage({ type: 'mesh', id: m.id, mesh, stats: {...source.stats(),lastMeshBuildMs:buildMs,lastMeshSampling:mesh.samplingStats} }, [mesh.heightLifts.buffer,mesh.overlayHeightLifts.buffer,mesh.vertex.buffer, mesh.edgeMask.buffer, mesh.index.buffer, mesh.overlayVertex.buffer, mesh.overlayIndex.buffer]);
    }
  } catch (e) { self.postMessage({ type: e.name === 'AbortError' ? 'cancelled' : 'error', id: m.id, error: e.message, stats: source.stats() }); }
  finally { releaseWater?.();active = null; }
};

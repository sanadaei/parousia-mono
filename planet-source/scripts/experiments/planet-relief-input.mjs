import { evolveRelief } from './mst-relief.mjs';
import { reliefTerrain } from './relief-terrain.mjs';
import { createTerrainAdapter } from '../../src/core/index.mjs';
import { restoreGlobalTerrain, createGlobalTerrain } from '../../src/core/global-terrain.mjs';
import { createSphericalProjection } from '../../src/core/spherical.mjs';
import { hashJson } from '../../src/core/json-contract.mjs';

/** Read a bounded metric window from an identified planet as experiment INPUT.
 * A coarse-only copy intentionally removes old detail and river incision; it is
 * a different derived source, never a mutation/replacement of the saved world.
 * Heights/landform labels do not imply uplift, rock strength, or geological age.
 */
export function preparePlanetReliefInput(snapshot, { centerLatDeg, centerLonDeg,
  extentM=32000, n=129, sourceMode='coarse-only' } = {}) {
  if(!Number.isInteger(n)||n<3||n>257||!Number.isFinite(extentM)||extentM<1||extentM>100000||
      !['coarse-only','saved-surface'].includes(sourceMode))throw new RangeError('Bounded relief input window required');
  const original=restoreGlobalTerrain(snapshot),raw=original.toSnapshot();
  if(!raw.references.sea)throw new TypeError('Explicit planetary sea datum required for sampled water screening');
  const projection=createSphericalProjection({centerLatDeg,centerLonDeg,radiusM:original.frame.radiusM,
    maxRadiusM:Math.SQRT2*extentM/2+2*original.derivativeStepM});
  if(sourceMode==='coarse-only'){
    delete raw.worldId;delete raw.sourceWorldId;
    raw.detail.bands=[];delete raw.references.rivers;delete raw.references.localPonds;
    raw.revision='coarse-relief-input-research@1';
  }
  const source=sourceMode==='coarse-only'?createGlobalTerrain(raw):original,initial=[],sourceCells=new Set(),sourceOutlets=new Set();
  let wetSamples=0,unresolvedSamples=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const p=projection.toGeographic(x*extentM/(n-1)-extentM/2,y*extentM/(n-1)-extentM/2);
    const sample=source.sampleSurfaceAt(p.latDeg,p.lonDeg);
    if(sample.hydrologyStatus!=='modeled'||sample.sourceLandMask===null)unresolvedSamples++;
    if(sample.waterDepthM>0||sample.sourceLandMask===0)wetSamples++;
    initial.push(sample.groundElevationM);sourceCells.add(sample.sourceCellIndex);sourceOutlets.add(sample.outletCellIndex);
  }
  if(wetSamples||unresolvedSamples)throw new RangeError(`Research land-only input has ${wetSamples} wet/marine and ${unresolvedSamples} unresolved samples; reservoir coupling required`);
  const content={method:'identified-planet-relief-input@1',originalWorldId:original.worldId,
    derivedSourceWorldId:source.worldId,sourceMode,verticalDatum:source.frame.verticalDatum,projection:projection.contract,
    n,extentM,initial,sourceCellIndices:[...sourceCells].sort((a,b)=>a-b),
    sourceOutletIndices:[...sourceOutlets].sort((a,b)=>(a??-1)-(b??-1)),
    waterScreening:'Derived-source samples only; coarse mode removes old local river/pond effects. No continuous-interior or changed-surface water proof',
    forcing:'Uplift and erodibility must be explicit independent experiment inputs'};
  return {...content,inputId:hashJson(content)};
}

/** Produce a new local research result with explicit planetary provenance.
 * Does not insert it into the source planet or preserve old river incision.
 */
export function evolvePlanetRelief(input, forcing) {
 const {inputId,...content}=input;
 if(input.method!=='identified-planet-relief-input@1'||inputId!==hashJson(content))throw new TypeError('Relief input identity mismatch');
 if(!forcing||!['steps','dtYears','erodibility','upliftMPerYear'].every(k=>Object.hasOwn(forcing,k)))throw new TypeError('Explicit simulation forcing is required');
 const result=evolveRelief({...forcing,n:input.n,extentM:input.extentM,initial:input.initial});
 const state=reliefTerrain(result,{seed:inputId,verticalDatum:input.verticalDatum}).toSnapshot();
 delete state.worldId;
 state.references.reliefResearch.planetInput={inputId,originalWorldId:input.originalWorldId,
  derivedSourceWorldId:input.derivedSourceWorldId,sourceMode:input.sourceMode,projection:input.projection,
  metricToProjectionOffsetM:{x:-input.extentM/2,y:-input.extentM/2},
  adoption:'Unadopted local result; original world, rivers and settlements unchanged'};
 return {terrain:createTerrainAdapter(state),result};
}

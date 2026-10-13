import { copyJson } from './json-contract.mjs';
import { CIRCULAR_CULVERT_MODEL, validateCircularCulvert, sizeCircularCulvert } from './culvert-hydraulics.mjs';
import { inspectEarthworkDrainage } from './earthwork-drainage.mjs';
import { freezeOwned } from './road-geometry.mjs';

export const CULVERT_ROUTING_SCHEMA = 'culvert-reservoir-links@2';
export const SIZED_CULVERT_ROUTING_SCHEMA='culvert-reservoir-links@3';
const LEGACY='culvert-reservoir-links@1', HYDRAULIC_BASIS='authored circular geometry; quasi-steady hydraulic approximation';
/** Canonical passage locations and an explicit game construction preset.
 * Diameter is authored (0.4m), not storm-return-period automatic design. */
export function planCulvertRouting(terrain, roads, pads = [], {design=null}={}) {
  if(design)validateCulvertDesign(design);
  const inspection = inspectEarthworkDrainage(terrain, { roads, pads });
  const links = inspection.culverts.map(c => ({
    id: c.culvertId, sourceKind: c.sourceKind, roadId: c.roadId ?? null,
    buildingId: c.buildingId ?? null, upstream: c.upstream, downstream: c.downstream,
    lengthM: c.lengthM, invertM: Math.max(c.upstreamInvertElevationM, c.downstreamInvertElevationM),
    hydraulics: { model:CIRCULAR_CULVERT_MODEL, diameterM:.4, lengthM:c.lengthM, roughnessN:.015, entranceLoss:.5, exitLoss:1,
      inletInvertM:c.upstreamInvertElevationM, outletInvertM:c.downstreamInvertElevationM },
  }));
  for(const c of links)if(design){
    c.design=sizingFor(c.hydraulics,design);
    if(c.design.selectedDiameterM==null)throw new RangeError(`No supplied diameter meets the explicit culvert design: ${c.id}`);
    c.hydraulics.diameterM=c.design.selectedDiameterM;
  }
  return freezeOwned({ schema: design?SIZED_CULVERT_ROUTING_SCHEMA:CULVERT_ROUTING_SCHEMA, ...(design?{designInput:structuredClone(design)}:{}), links,
    coefficientBasis: HYDRAULIC_BASIS,
    inspection: { blockedFlowCount: inspection.blockedFlowCount, unresolvedFlowCount: inspection.unresolvedFlowCount,
      precision: inspection.precision },
  });
}

export function validateCulvertRouting(routing, recipe) {
  if (routing == null) return; // Existing snapshots have no passages.
  const legacy=routing.schema===LEGACY,sized=routing.schema===SIZED_CULVERT_ROUTING_SCHEMA;
  if(sized)validateCulvertDesign(routing.designInput);else if(routing.designInput!=null)throw new TypeError("Unsized routing cannot carry design input");
  if ((!legacy && !sized && routing.schema !== CULVERT_ROUTING_SCHEMA) || !Array.isArray(routing.links) || routing.links.length > 4096
    || routing.coefficientBasis !== (legacy?'authored-game-reservoir-ceiling; not hydraulic pipe sizing':HYDRAULIC_BASIS)) throw new TypeError('Invalid culvert routing contract');
  const ids = new Set(), roads = new Set((recipe.roadCenterlineProfiles ?? []).map(r => r.roadId ?? r.id)),
    pads = new Set((recipe.buildingPads ?? []).map(p => p.id ?? p.buildingId)), b = recipe.bounds;
  for (const c of routing.links) {
    if (typeof c.id !== 'string' || !c.id || ids.has(c.id)) throw new TypeError('Invalid culvert identity'); ids.add(c.id);
    if (!(c.sourceKind === 'road-embankment' && roads.has(c.roadId) && c.buildingId === null)
      && !(c.sourceKind === 'building-pad-fill' && pads.has(c.buildingId) && c.roadId === null)) throw new TypeError('Invalid culvert feature reference');
    for (const p of [c.upstream, c.downstream]) if (!p || ![p.xM,p.yM,p.invertElevationM].every(Number.isFinite)
      || p.xM < b.minXM || p.xM > b.maxXM || p.yM < b.minYM || p.yM > b.maxYM) throw new RangeError('Invalid culvert mouth');
    const length = Math.hypot(c.upstream.xM-c.downstream.xM,c.upstream.yM-c.downstream.yM);
    if (!Number.isFinite(c.lengthM) || length <= 0 || Math.abs(length-c.lengthM)>1e-7
      || c.upstream.invertElevationM < c.downstream.invertElevationM
      || c.invertM !== Math.max(c.upstream.invertElevationM,c.downstream.invertElevationM)) throw new RangeError('Invalid culvert profile');
    if(sized){const expected=sizingFor(c.hydraulics,routing.designInput);
      const difference=sizingDifference(copyJson(expected),copyJson(c.design));
      if(expected.selectedDiameterM==null||c.hydraulics.diameterM!==expected.selectedDiameterM||difference)throw new TypeError('Saved culvert sizing differs from its explicit inputs: '+JSON.stringify(difference));
    }else if(c.design!=null)throw new TypeError('Unsized routing cannot carry sizing results');
    if(legacy){if(c.hydraulics!=null)throw new TypeError('Legacy routing cannot contain hydraulic overrides');for (const value of [c.capacityM3PerSecond,c.conductanceM2PerSecond]) if (!Number.isFinite(value)||value<0) throw new RangeError('Invalid culvert coefficient');}
    else { if(c.capacityM3PerSecond!=null||c.conductanceM2PerSecond!=null)throw new TypeError('Hydraulic routing cannot contain legacy coefficients');validateCircularCulvert(c.hydraulics); if(c.hydraulics.lengthM!==c.lengthM||c.hydraulics.inletInvertM!==c.upstream.invertElevationM||c.hydraulics.outletInvertM!==c.downstream.invertElevationM)throw new RangeError('Culvert hydraulics must match saved mouths'); }
  }
}

/** Project saved mouths onto this simulation grid only. No geometry is generated
 * here. Unresolvable mouths never silently connect arbitrary cells. */
export function mapCulvertRouting(routing, state, { isSolid = () => false } = {}) {
  const links = [], unresolved = [];
  const cell = p => {
    const x = Math.floor((p.xM-state.originXM)/state.cellSizeM), y = Math.floor((p.yM-state.originYM)/state.cellSizeM);
    return x<0||x>=state.columns||y<0||y>=state.rows ? null : y*state.columns+x;
  };
  for (const c of routing?.links ?? []) {
    const a=cell(c.upstream), b=cell(c.downstream);
    const reason = a===null||b===null ? 'mouth-outside-simulation' : a===b ? 'both-mouths-in-one-cell'
      : isSolid(a)||isSolid(b) ? 'mouth-cell-occupied-by-structure' : null;
    if(reason) { unresolved.push({id:c.id,reason}); continue; }
    links.push({id:c.id,fromCell:a,toCell:b,invertM:c.invertM,
      ...(c.hydraulics?{hydraulics:{...c.hydraulics}}:{capacityM3PerSecond:c.capacityM3PerSecond,conductanceM2PerSecond:c.conductanceM2PerSecond})});
  }
  return {links,unresolved,coefficientBasis:routing?.coefficientBasis??null};
}

export function validateCulvertDesign(design){
 if(!design||!Array.isArray(design.headCases)||!design.headCases.length||design.headCases.length>64)throw new TypeError('Explicit culvert head cases are required');
 for(const c of design.headCases)for(const key of ['upstreamDepthM','downstreamDepthM'])if(!Number.isFinite(c[key])||c[key]<0)throw new RangeError('Design water depth must be finite and nonnegative');
 // Reuse the full sizing contract; a neutral downhill geometry validates input
 // without guessing a real catchment or making construction changes.
 sizingFor({model:CIRCULAR_CULVERT_MODEL,lengthM:1,roughnessN:.015,entranceLoss:.5,exitLoss:1,inletInvertM:1,outletInvertM:0},design);
}
function sizingFor(geometry,design){
 return sizeCircularCulvert({geometry,diametersM:design.diametersM,safetyFactor:design.safetyFactor??1,
  conditions:design.headCases.map(c=>({id:c.id,targetFlowM3PerSecond:c.targetFlowM3PerSecond,upstreamLevelM:geometry.inletInvertM+c.upstreamDepthM,downstreamLevelM:geometry.outletInvertM+c.downstreamDepthM}))});
}

function sizingDifference(a,b,path='design'){
 if(a===b)return null;
 // Browser/Node transcendental functions can differ by a few ULPs. Only
 // recomputed capacity witnesses get this tolerance; design inputs, chosen
 // diameters and pass/fail decisions remain exact. Snapshot hashes stay exact.
 if(path.endsWith('.availableFlowM3PerSecond')&&Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=32*Number.EPSILON*Math.max(1,Math.abs(a),Math.abs(b)))return null;
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return{path,expected:a,saved:b};
 if(Array.isArray(a)!==Array.isArray(b)||Object.keys(a).length!==Object.keys(b).length)return{path,reason:'shape'};
 for(const key of Object.keys(a)){if(!Object.hasOwn(b,key))return{path,reason:'key'};const difference=sizingDifference(a[key],b[key],path+'.'+key);if(difference)return difference;}return null;
}

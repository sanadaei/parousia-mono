import { positiveNumber, finiteNumber } from './contract-validation.mjs';

export const CIRCULAR_CULVERT_MODEL = 'circular-quasi-steady@1';
const G=9.80665;
/** A bounded game approximation, not HDS-5 design certification. Geometry is
 * explicit; a critical-energy inlet ceiling and a wetted-section friction
 * ceiling are combined. No hydraulic jumps or longitudinal backwater solve. */
export function validateCircularCulvert(p){
  if(p?.model!==CIRCULAR_CULVERT_MODEL)throw new TypeError('Unknown circular culvert model');
  for(const key of ['diameterM','lengthM','roughnessN'])positiveNumber(p[key],key);
  for(const key of ['entranceLoss','exitLoss','inletInvertM','outletInvertM'])finiteNumber(p[key],key);
  if(p.entranceLoss<0||p.exitLoss<0)throw new RangeError('Negative culvert loss');
}
export function circularSection(diameterM,depthM){
  positiveNumber(diameterM,'diameterM');finiteNumber(depthM,'depthM');
  const y=Math.max(0,Math.min(diameterM,depthM));
  if(y===0)return{areaM2:0,wettedPerimeterM:0,hydraulicRadiusM:0,topWidthM:0};
  const r=diameterM/2,theta=2*Math.acos(Math.max(-1,Math.min(1,1-y/r))),
    area=r*r*(theta-Math.sin(theta))/2,perimeter=r*theta;
  return{areaM2:area,wettedPerimeterM:perimeter,hydraulicRadiusM:area/perimeter,topWidthM:2*Math.sqrt(Math.max(0,y*(diameterM-y)))};
}
function inletCapacity(p,head){
  // Max Q permitted by H = y + (1+Ke) v²/(2g) in the circular opening.
  // Maximization is a bounded critical-specific-energy approximation, not an
  // empirical inlet-shape coefficient table. Tailwater submergence gradually
  // releases this free-inlet ceiling; that transition is an explicit game approximation.
  let a=0,b=Math.min(head,p.diameterM);const q=y=>{
    const s=circularSection(p.diameterM,y);
    return s.areaM2*Math.sqrt(Math.max(0,2*G*(head-y)/(1+p.entranceLoss)));
  };
  for(let i=0;i<40;i++){const x=a+(b-a)/3,y=b-(b-a)/3;if(q(x)<q(y))a=x;else b=y;}
  return q((a+b)/2);
}
export function circularCulvertFlow(p,levelA,levelB){
  validateCircularCulvert(p);finiteNumber(levelA,'first water level');finiteNumber(levelB,'second water level');
  const reverse=levelB>levelA,up=reverse?levelB:levelA,down=reverse?levelA:levelB,
    zi=reverse?p.outletInvertM:p.inletInvertM,zo=reverse?p.inletInvertM:p.outletInvertM,
    sourceDepth=up-zi,head=Math.max(0,up-Math.max(down,zo));
  if(sourceDepth<=0||head===0)return{flowM3PerSecond:0,regime:'dry-or-balanced',headDifferenceM:head};
  // A reverse flow cannot climb above its source reservoir's head.
  if(up<=Math.max(zi,zo))return{flowM3PerSecond:0,regime:'blocked-by-invert',headDifferenceM:head};
  const full=up>=zi+p.diameterM&&down>=zo+p.diameterM,
    depth=Math.min(p.diameterM,sourceDepth,up-zo),section=circularSection(p.diameterM,depth),
    loss=p.entranceLoss+p.exitLoss+2*G*p.roughnessN**2*p.lengthM/section.hydraulicRadiusM**(4/3),
    barrel=section.areaM2*Math.sqrt(2*G*head/loss),
    tailFraction=Math.max(0,Math.min(1,(down-zo)/p.diameterM)),
    relief=tailFraction*tailFraction*(3-2*tailFraction),
    inlet=full?Infinity:inletCapacity(p,sourceDepth)/Math.max(1e-12,1-relief),rate=Math.min(barrel,inlet);
  if(!Number.isFinite(rate))throw new RangeError('Culvert flow overflow');
  return{flowM3PerSecond:(reverse?-1:1)*rate,regime:full?'full-barrel-energy':'partial-barrel-approximation',
    controlling:barrel<=inlet?'barrel-loss':'inlet-energy',headDifferenceM:head,wettedAreaM2:section.areaM2,lossCoefficient:loss};
}

/** Select the smallest supplied diameter meeting every explicit design case.
 * This sizes the existing game approximation only. Neither a design storm nor
 * catchment discharge is inferred from a name, terrain tag or missing input. */
export function sizeCircularCulvert({geometry,diametersM,conditions,safetyFactor=1}){
  if(!Array.isArray(diametersM)||!diametersM.length||diametersM.length>64||!Array.isArray(conditions)||!conditions.length||conditions.length>64)throw new RangeError('Culvert sizing needs bounded diameter and condition lists');
  positiveNumber(safetyFactor,'safetyFactor');if(safetyFactor<1)throw new RangeError('Safety factor must be at least one');
  const diameters=[...diametersM];for(const d of diameters)positiveNumber(d,'candidate diameter');
  diameters.sort((a,b)=>a-b);if(new Set(diameters).size!==diameters.length)throw new RangeError('Duplicate candidate diameters');
  const ids=new Set();for(const c of conditions){if(typeof c.id!=='string'||!c.id||ids.has(c.id))throw new TypeError('Unique design condition IDs are required');ids.add(c.id);
    positiveNumber(c.targetFlowM3PerSecond,'target flow');finiteNumber(c.upstreamLevelM,'design upstream level');finiteNumber(c.downstreamLevelM,'design downstream level');
    if(c.upstreamLevelM<=c.downstreamLevelM)throw new RangeError('Positive design flow requires a higher upstream head');}
  const candidates=diameters.map(diameterM=>{
    const hydraulics={...geometry,model:CIRCULAR_CULVERT_MODEL,diameterM};validateCircularCulvert(hydraulics);
    const cases=conditions.map(c=>{const flow=circularCulvertFlow(hydraulics,c.upstreamLevelM,c.downstreamLevelM),required=c.targetFlowM3PerSecond*safetyFactor;
      finiteNumber(required,'required design flow');return{id:c.id,requiredFlowM3PerSecond:required,availableFlowM3PerSecond:flow.flowM3PerSecond,passes:flow.flowM3PerSecond>=required,regime:flow.regime};});
    return{diameterM,passes:cases.every(c=>c.passes),cases};
  });
  const chosen=candidates.find(c=>c.passes);
  return{schema:'circular-culvert-sizing@1',status:chosen?'sized-within-input-model':'no-candidate-meets-design',selectedDiameterM:chosen?.diameterM??null,
    safetyFactor,conditions:conditions.map(c=>({...c})),candidates,scope:'explicit head/discharge cases in circular-quasi-steady@1; not calibrated storm, backwater, scour or real construction design'};
}

import {roadCrossSectionOffsetBound} from './road-cross-section.mjs';
import { metricRoads } from './road-geometry.mjs';
import { finiteNumber, positiveNumber, nonEmptyText } from './contract-validation.mjs';
import { nonnegative, freezeOwned } from './road-geometry.mjs';
/** Mechanics reference: USDA FPL-GTR-190 Chapter 9, Table 9-1.
 * https://research.fs.usda.gov/download/treesearch/37423.pdf
 * Game-world elastic beam model, NOT a real construction design/code check.
 * A constant rectangular section, simply supported, uniform load plus a
 * centred point load. Buckling, connections, creep and foundations are excluded. */
export function assessBeamSpan({spanM,widthM,depthM,material,uniformLoadNPerM=0,centerLoadN=0,gravityMPerS2=9.80665,deflectionRatio=360}) {
 for(const[k,v]of Object.entries({spanM,widthM,depthM,gravityMPerS2,deflectionRatio}))positiveNumber(v,k);
 for(const[k,v]of Object.entries({uniformLoadNPerM,centerLoadN}))nonnegative(v,k);
 const required=['densityKgPerM3','elasticModulusPa','shearModulusPa','allowableBendingPa','allowableShearPa'];
 const missing=required.filter(k=>material?.[k]==null);if(missing.length)return freezeOwned({status:'insufficient-material-data',missing});
 for(const k of required)positiveNumber(material[k],k);
 const area=widthM*depthM,inertia=widthM*depthM**3/12,sectionModulus=widthM*depthM**2/6,shearArea=5*area/6;
 const ownWeightNPerM=area*material.densityKgPerM3*gravityMPerS2,w=uniformLoadNPerM+ownWeightNPerM,L=spanM,P=centerLoadN;
 const momentNm=w*L*L/8+P*L/4,shearN=(w*L+P)/2,bendingPa=momentNm/sectionModulus,shearPa=1.5*shearN/area;
 const bendingDeflectionM=5*w*L**4/(384*material.elasticModulusPa*inertia)+P*L**3/(48*material.elasticModulusPa*inertia);
 const shearDeflectionM=w*L*L/(8*material.shearModulusPa*shearArea)+P*L/(4*material.shearModulusPa*shearArea),deflectionM=bendingDeflectionM+shearDeflectionM;
 const utilization={bending:bendingPa/material.allowableBendingPa,shear:shearPa/material.allowableShearPa,deflection:deflectionM/(L/deflectionRatio)};
 for(const[k,v]of Object.entries({area,inertia,ownWeightNPerM,momentNm,shearN,bendingPa,shearPa,deflectionM,...utilization}))finiteNumber(v,k);
 const status=L/depthM<10?'outside-slender-beam-model':Object.values(utilization).some(v=>v>1)?'over-capacity':'within-input-model';
 return freezeOwned({status,spanM:spanM,areaM2:area,inertiaM4:inertia,ownWeightNPerM,uniformLoadNPerM:w,centerLoadN:P,momentNm,shearN,bendingPa,shearPa,
 bendingDeflectionM,shearDeflectionM,deflectionM,allowedDeflectionM:L/deflectionRatio,utilization,
 excluded:['connections','lateral instability','creep and decay','impact and vibration','foundation bearing and scour'],scope:'static elastic beam only; not whole-bridge certification'});
}
/** Explicit fictional-world material. Values are simulation inputs, not a
 * species/grade lookup or a claim about actual construction timber. */
export const GENERATED_TIMBER=Object.freeze({id:'generated-game-timber@1',densityKgPerM3:600,elasticModulusPa:1e10,shearModulusPa:6.5e8,allowableBendingPa:8e6,allowableShearPa:8e5});
export function buildBridgeStructure({id,roadId,start,end,deckElevationM,widthM,groundAt,material=GENERATED_TIMBER,maxSpanM=8,beamCount=4,beamWidthM=.3,beamDepthM=.6,deckThicknessM=.2,liveLoadPa=2500,centerVehicleLoadN=40000,embedDepthM=1}) {
 nonEmptyText(id,'bridge.id');nonEmptyText(roadId,'roadId');finiteNumber(deckElevationM,'deck elevation');
 for(const p of[start,end]){finiteNumber(p?.xM,'bridge.xM');finiteNumber(p?.yM,'bridge.yM');}
 for(const[k,v]of Object.entries({widthM,maxSpanM,beamWidthM,beamDepthM,deckThicknessM,embedDepthM}))positiveNumber(v,k);
 for(const[k,v]of Object.entries({liveLoadPa,centerVehicleLoadN}))nonnegative(v,k);
 if(typeof groundAt!=='function'||!Number.isSafeInteger(beamCount)||beamCount<1||beamCount>16)throw new TypeError('Invalid bridge design input');
 const dx=end.xM-start.xM,dy=end.yM-start.yM,lengthM=Math.hypot(dx,dy);positiveNumber(lengthM,'bridge length');
 const spanCount=Math.ceil(lengthM/maxSpanM);if(spanCount>64)throw new RangeError('Bridge support budget exceeded');
 if(beamCount*beamWidthM>widthM)throw new RangeError('Beams do not fit under deck');
 positiveNumber(material?.densityKgPerM3,'material density');
 const deckOwnWeight=widthM*deckThicknessM*material.densityKgPerM3*9.80665;
 const assessment=assessBeamSpan({spanM:lengthM/spanCount,widthM:beamWidthM,depthM:beamDepthM,material,uniformLoadNPerM:(liveLoadPa*widthM+deckOwnWeight)/beamCount,centerLoadN:centerVehicleLoadN/beamCount});
 const direction={xM:dx/lengthM,yM:dy/lengthM},normal={xM:-direction.yM,yM:direction.xM},boxes=[];
 const at=(distance,offset=0)=>({xM:start.xM+direction.xM*distance+normal.xM*offset,yM:start.yM+direction.yM*distance+normal.yM*offset});
 const box=(part,point,lengthM,widthM,bottomElevationM,topElevationM,color)=>{if(topElevationM>bottomElevationM)boxes.push({id:`${id}/${part}`,center:point,direction,lengthM,widthM,bottomElevationM,topElevationM,color});};
 box('deck',at(lengthM/2),lengthM,widthM,deckElevationM-deckThicknessM,deckElevationM,[.36,.28,.17]);
 for(let k=0;k<beamCount;k++)for(let j=0;j<spanCount;j++)box(`beam:${k}/span:${j}`,at((j+.5)*lengthM/spanCount,(k+.5)/beamCount*widthM-widthM/2),lengthM/spanCount,beamWidthM,deckElevationM-deckThicknessM-beamDepthM,deckElevationM-deckThicknessM,[.25,.19,.12]);
 const supports=[];
 for(let k=0;k<=spanCount;k++){const p=at(k/spanCount*lengthM),groundElevationM=finiteNumber(groundAt(p.xM,p.yM),'support ground');
 const bottom=groundElevationM-embedDepthM,top=deckElevationM-deckThicknessM-beamDepthM;
 if(top<=bottom)throw new RangeError('Bridge support is buried above its bearing surface');
 box(`support:${k}`,p,1,Math.min(widthM,widthM*(1-1/beamCount)+beamWidthM+.2),bottom,top,[.45,.44,.40]);supports.push({...p,groundElevationM,bottomElevationM:bottom,topElevationM:top});}
 return freezeOwned({id,roadId,kind:'pier-supported-timber-deck',start:{...start},end:{...end},widthM,deckElevationM,totalDeckDepthM:deckThicknessM+beamDepthM,
 material:{...material},maxSpanM,loads:{liveLoadPa,centerVehicleLoadN},spanCount,beamCount,beamWidthM,beamDepthM,deckThicknessM,embedDepthM,assessment,supports,boxes,
 foundationStatus:'unresolved-ground-bearing-and-scour',hydraulicObstructionStatus:'not-yet-coupled-to-flow'});
}

// Geographic ground queries can differ by sub-micrometre rounding between
// browser/Node V8 versions. Structure semantics and nonnumeric fields stay exact.
function sameDesign(a,b){
 if(typeof a==='number'&&typeof b==='number')return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=1e-7+1e-12*Math.max(Math.abs(a),Math.abs(b));
 if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return a===b;
 if(Array.isArray(a)!==Array.isArray(b))return false;
 const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&sameDesign(a[k],b[k]));
}
export function validateBridgeStructures(input=[],roadProfiles=[],groundAt=null){
 if(!Array.isArray(input)||input.length>64)throw new RangeError('Invalid bridge structure collection');
 const roads=metricRoads(roadProfiles),ids=new Set();
 for(const s of input){if(ids.has(s.id))throw new RangeError('Duplicate bridge structure ID');ids.add(s.id);
 const road=roads.find(r=>r.id===s.roadId);if(!road||Math.abs(road.halfWidthM*2-s.widthM)>1e-8||Math.abs((road.road.deckThicknessM??.5)-s.totalDeckDepthM)>1e-8)throw new TypeError('Bridge structure differs from road deck');
 const a=road.points.find(p=>Math.hypot(p.xM-s.start.xM,p.yM-s.start.yM)<1e-6),b=road.points.find(p=>Math.hypot(p.xM-s.end.xM,p.yM-s.end.yM)<1e-6);
 if(!a||!b||a.distanceM>=b.distanceM||road.points.filter(p=>p.distanceM>=a.distanceM&&p.distanceM<=b.distanceM).some(p=>Math.abs(p.roadElevationM-s.deckElevationM)>1e-8))throw new TypeError('Bridge endpoints do not match a level road span');
 if(roadCrossSectionOffsetBound(road.road.crossSection,road.halfWidthM,a.distanceM,b.distanceM)>1e-10)throw new TypeError('Saved flat bridge must not have an unmatched crowned road surface');
 const oracle=groundAt??((x,y)=>{const p=s.supports.find(p=>Math.hypot(p.xM-x,p.yM-y)<1e-6);if(!p)throw new TypeError('Bridge support positions disagree');return p.groundElevationM;});
 const rebuilt=buildBridgeStructure({...s,groundAt:oracle,liveLoadPa:s.loads.liveLoadPa,centerVehicleLoadN:s.loads.centerVehicleLoadN});
 if(!sameDesign(rebuilt,s))throw new TypeError('Bridge geometry or assessment is inconsistent with its design');
 }
 return input;
}

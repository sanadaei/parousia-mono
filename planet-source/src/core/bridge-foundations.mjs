import {positiveNumber,finiteNumber} from './contract-validation.mjs';
import {freezeOwned} from './road-geometry.mjs';
const nonnegative=(v,n)=>{finiteNumber(v,n);if(v<0)throw new RangeError(`${n} must be nonnegative`);return v;};
/** Rigid rectangular full-contact base under explicit loads. Linear bearing
 * pressure N/A ± M/S; partial contact is diagnosed, not silently extrapolated.
 * Reference: FHWA-HRT-14-094, ch.4 (eccentricity / middle-third contact).
 * https://www.fhwa.dot.gov/publications/research/infrastructure/bridge/14094/004.cfm
 * Game scenario only. Soil capacity, friction and scour are INPUTS, not inferred
 * from terrain height, biome, rock colour or a pier's existence. */
export function assessSupportBase({lengthM,widthM,verticalLoadN,momentAlongNm=0,momentAcrossNm=0,horizontalLoadN=0,allowableBearingPa,frictionCoefficient,embedDepthM,scourDepthM}){
 for(const[k,v]of Object.entries({lengthM,widthM}))positiveNumber(v,k);
 for(const[k,v]of Object.entries({verticalLoadN,momentAlongNm,momentAcrossNm,horizontalLoadN}))finiteNumber(v,k);
 nonnegative(horizontalLoadN,'horizontalLoadN');
 const missing=Object.entries({allowableBearingPa,frictionCoefficient,embedDepthM,scourDepthM}).filter(([,v])=>v==null).map(([k])=>k);
 if(missing.length)return freezeOwned({status:'insufficient-ground-data',missing});
 positiveNumber(allowableBearingPa,'allowableBearingPa');for(const[k,v]of Object.entries({frictionCoefficient,embedDepthM,scourDepthM}))nonnegative(v,k);
 if(verticalLoadN<=0)return freezeOwned({status:'no-compressive-contact',verticalLoadN});
 const areaM2=lengthM*widthM,meanPressurePa=verticalLoadN/areaM2,
  alongPressurePa=6*Math.abs(momentAlongNm)/(widthM*lengthM**2),acrossPressurePa=6*Math.abs(momentAcrossNm)/(lengthM*widthM**2),
  minPressurePa=meanPressurePa-alongPressurePa-acrossPressurePa,maxPressurePa=meanPressurePa+alongPressurePa+acrossPressurePa,
  frictionCapacityN=verticalLoadN*frictionCoefficient,remainingEmbedM=embedDepthM-scourDepthM;
 for(const[k,v]of Object.entries({areaM2,meanPressurePa,minPressurePa,maxPressurePa,frictionCapacityN,remainingEmbedM}))finiteNumber(v,k);
 const violations=[];if(minPressurePa<0)violations.push('partial-contact-outside-model');if(maxPressurePa>allowableBearingPa)violations.push('bearing-pressure-exceeded');if(horizontalLoadN>frictionCapacityN)violations.push('sliding-demand-exceeded');if(remainingEmbedM<=0)violations.push('base-exposed-by-specified-scour');
 return freezeOwned({status:violations.length?'outside-input-conditions':'within-input-conditions',violations,areaM2,verticalLoadN,horizontalLoadN,meanPressurePa,minPressurePa,maxPressurePa,frictionCapacityN,remainingEmbedM,
  scope:'rigid full-contact bearing and Coulomb sliding checks; explicit scour exposure only; no soil settlement, partial-contact redistribution, passive resistance, pile action, buoyancy or scour prediction'});
}
/** Apply actual saved deck, beam and support dimensions. One vehicle at the
 * centre of one explicitly selected span, distributed live load on all spans.
 * No generated soil properties or unseen foundation enlargement are invented. */
export function inspectBridgeFoundations(structure,{allowableBearingPa,frictionCoefficient,scourDepthM,supportDensityKgPerM3,vehicleSpanIndex=0,lateralLoadPerSupportN=0}={}){
 const s=structure,n=s?.spanCount,missing=Object.entries({allowableBearingPa,frictionCoefficient,scourDepthM,supportDensityKgPerM3}).filter(([,v])=>v==null).map(([k])=>k);
 if(missing.length)return freezeOwned({status:'insufficient-ground-data',missing,bridgeId:s?.id??null});
 if(!Number.isSafeInteger(n)||n<1||n>64||!Array.isArray(s.supports)||s.supports.length!==n+1||!Number.isSafeInteger(vehicleSpanIndex)||vehicleSpanIndex<0||vehicleSpanIndex>=n)throw new TypeError('Invalid saved bridge span topology');
 positiveNumber(supportDensityKgPerM3,'supportDensityKgPerM3');nonnegative(lateralLoadPerSupportN,'lateralLoadPerSupportN');
 const lengthM=Math.hypot(s.end.xM-s.start.xM,s.end.yM-s.start.yM),spanM=lengthM/n,g=9.80665,
  deckWeightPerM=s.widthM*s.deckThicknessM*s.material.densityKgPerM3*g,
  beamWeightPerM=s.beamCount*s.beamWidthM*s.beamDepthM*s.material.densityKgPerM3*g,
  lineLoadNPerM=deckWeightPerM+beamWeightPerM+s.widthM*s.loads.liveLoadPa,vehicleLoadN=s.loads.centerVehicleLoadN;
 const rows=[];let totalReactionN=0,totalSupportWeightN=0;
 for(let i=0;i<=n;i++){
  const support=s.supports[i],box=s.boxes.find(b=>b.id===`${s.id}/support:${i}`);if(!box)throw new TypeError('Missing saved support geometry');
  const tributarySpans=(i===0||i===n)?1:2,reactionN=lineLoadNPerM*spanM/2*tributarySpans+((i===vehicleSpanIndex||i===vehicleSpanIndex+1)?vehicleLoadN/2:0),
    volumeM3=box.lengthM*box.widthM*(box.topElevationM-box.bottomElevationM),supportWeightN=volumeM3*supportDensityKgPerM3*g,
    leverM=(box.topElevationM-box.bottomElevationM)/2;
  totalReactionN+=reactionN;totalSupportWeightN+=supportWeightN;
  const assessment=assessSupportBase({lengthM:box.lengthM,widthM:box.widthM,verticalLoadN:reactionN+supportWeightN,horizontalLoadN:lateralLoadPerSupportN,momentAlongNm:lateralLoadPerSupportN*leverM,allowableBearingPa,frictionCoefficient,embedDepthM:support.groundElevationM-box.bottomElevationM,scourDepthM});
  rows.push({supportId:box.id,xM:support.xM,yM:support.yM,reactionN,supportWeightN,assessment});
 }
 return freezeOwned({bridgeId:s.id,status:rows.some(r=>r.assessment.status!=='within-input-conditions')?'outside-input-conditions':'within-input-conditions',
  input:{allowableBearingPa,frictionCoefficient,scourDepthM,supportDensityKgPerM3,vehicleSpanIndex,lateralLoadPerSupportN},
  totalDeckAndTrafficLoadN:lineLoadNPerM*lengthM+vehicleLoadN,totalReactionN,totalSupportWeightN,supports:rows,
  scope:'saved support footprints, one centred vehicle in the selected span, uniform live load on every span; uniform horizontal force along bridge at half each support height; no automatic soil/scour model or construction safety certification'});
}

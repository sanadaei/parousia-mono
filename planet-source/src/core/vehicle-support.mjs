import { positiveNumber, finiteNumber } from './contract-validation.mjs';
import { freezeOwned } from './road-geometry.mjs';
import { createSphericalProjection } from './spherical.mjs';

/** Static four-wheel support approximation. Fits an affine support plane at
 * each supplied pose; checks twist, slope, flooding and underbody samples.
 * This is deliberately not a tyre/suspension or continuous terrain solver. */
export function inspectVehicleSupport({poses,sampleSurface,wheelbaseM,trackWidthM,
  lengthM,widthM,heightM,groundClearanceM=.2,maxPitchSlope=.3,maxRollSlope=.2,
  maxWheelResidualM=.15,maxWadingDepthM=.4,underbodySpacingM=1,maxProbes=262144}) {
  for(const [k,v] of Object.entries({wheelbaseM,trackWidthM,lengthM,widthM,heightM,underbodySpacingM}))positiveNumber(v,k);
  for(const [k,v] of Object.entries({groundClearanceM,maxPitchSlope,maxRollSlope,maxWheelResidualM,maxWadingDepthM})){
    finiteNumber(v,k);if(v<0)throw new RangeError(`${k} must be nonnegative`);
  }
  if(wheelbaseM>lengthM||trackWidthM>widthM)throw new RangeError('Wheel contacts must fit the vehicle footprint');
  if(typeof sampleSurface!=='function'||!Array.isArray(poses)||poses.length<2||poses.length>8193
    ||!Number.isSafeInteger(maxProbes)||maxProbes<1||maxProbes>262144)throw new RangeError('Invalid support input');
  const nx=Math.ceil(lengthM/underbodySpacingM),ny=Math.ceil(widthM/underbodySpacingM);
  if(!Number.isSafeInteger(nx)||!Number.isSafeInteger(ny)||(4+(nx+1)*(ny+1))*poses.length>maxProbes)throw new RangeError('Support probe budget exceeded');
  let probes=0;const samples=[],violations=[],supportedPoses=[];
  for(let index=0;index<poses.length;index++){
    const p=poses[index];for(const k of ['xM','yM','headingRad'])finiteNumber(p?.[k],k);
    const c=Math.cos(p.headingRad),s=Math.sin(p.headingRad);
    const at=(u,v)=>{probes++;const xM=p.xM+u*c-v*s,yM=p.yM+u*s+v*c,q=sampleSurface(xM,yM);
      finiteNumber(q?.supportElevationM,'support elevation');if(q.waterDepthM!=null&&( !Number.isFinite(q.waterDepthM)||q.waterDepthM<0))throw new RangeError('Invalid support water depth');
      return{...q,u,v,xM,yM};};
    const wheels=[-1,1].flatMap(a=>[-1,1].map(b=>at(a*wheelbaseM/2,b*trackWidthM/2))),z=wheels.reduce((a,q)=>a+q.supportElevationM/4,0),
      pitch=wheels.reduce((a,q)=>a+q.u*q.supportElevationM,0)/(wheelbaseM**2),
      roll=wheels.reduce((a,q)=>a+q.v*q.supportElevationM,0)/(trackWidthM**2),
      residual=Math.max(...wheels.map(q=>Math.abs(q.supportElevationM-z-pitch*q.u-roll*q.v))),
      plane=(u,v)=>z+pitch*u+roll*v+groundClearanceM;
    let minimumClearanceM=Infinity,maximumWaterDepthM=0,unknownWater=false;
    for(const q of wheels){if(q.waterDepthM==null)unknownWater=true;else maximumWaterDepthM=Math.max(maximumWaterDepthM,q.waterDepthM);}
    for(let x=0;x<=nx;x++)for(let y=0;y<=ny;y++){
      const u=(x/nx-.5)*lengthM,v=(y/ny-.5)*widthM,q=at(u,v);
      minimumClearanceM=Math.min(minimumClearanceM,plane(u,v)-q.supportElevationM);
    }
    const reasons=[];
    if(Math.abs(pitch)>maxPitchSlope+1e-10)reasons.push('pitch-too-steep');
    if(Math.abs(roll)>maxRollSlope+1e-10)reasons.push('roll-too-steep');
    if(residual>maxWheelResidualM+1e-10)reasons.push('wheel-plane-twist');
    if(minimumClearanceM< -1e-9)reasons.push('underbody-ground-contact');
    if(maximumWaterDepthM>maxWadingDepthM+1e-10)reasons.push('wheels-flooded');
    if(unknownWater)reasons.push('wheel-water-unknown');
    for(const value of [z,pitch,roll,residual,minimumClearanceM,maximumWaterDepthM])finiteNumber(value,'derived support value');
    const verticalHalfRangeM=(Math.abs(pitch)*lengthM+Math.abs(roll)*widthM)/2;
    samples.push({index,xM:p.xM,yM:p.yM,supportCentreElevationM:z,pitchSlope:pitch,rollSlope:roll,
      pitchRad:Math.atan(pitch),rollRad:Math.atan(roll),wheelResidualM:residual,minimumClearanceM,maximumWaterDepthM,unknownWater,reasons});
    if(reasons.length)violations.push({index,reasons});
    supportedPoses.push({...p,bottomElevationM:z+groundClearanceM-verticalHalfRangeM});
  }
  // A conservative vertical box around each affine-bottom body. Its between-
  // pose interpolation is specified, not certified against unsampled ground.
  const boundingHeightM=heightM+Math.max(...samples.map(q=>Math.abs(q.pitchSlope)*lengthM+Math.abs(q.rollSlope)*widthM));
  finiteNumber(boundingHeightM,'support bounding height');
  supportedPoses.forEach(p=>finiteNumber(p.bottomElevationM,'support bottom elevation'));
  return freezeOwned({status:violations.length?'support-constraints-unmet':'within-sampled-support-limits',samples,violations,
    supportedPoses,boundingHeightM,probes,scope:'sampled four-wheel affine support; vertical body envelope; no between-probe terrain, traction, suspension or dynamic stability certification'});
}

/** Roads (including elevated bridges) support wheels at their actual deck,
 * while water is measured above that support, not above the riverbed. */
export function planetVehicleSurface(world,recipe){
  const projection=createSphericalProjection(recipe.projection),b=recipe.bounds;
  return(x,y)=>{
    if(x<b.minXM||x>b.maxXM||y<b.minYM||y>b.maxYM)throw new RangeError('Vehicle left the settlement chart');
    const p=projection.toGeographic(x,y),s=(world.sampleSurfaceAt?world.sampleSurfaceAt(p.latDeg,p.lonDeg):world.sampleAt(p.latDeg,p.lonDeg)),road=s.roadSurface,
      supportElevationM=road?.roadElevationM??s.groundElevationM;
    return{supportElevationM,waterDepthM:s.waterLevelElevationM==null?null:Math.max(0,s.waterLevelElevationM-supportElevationM),
      structureKind:road?.structureKind??s.structureKind??'natural-ground'};
  };
}

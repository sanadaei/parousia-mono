import {finiteNumber,positiveNumber} from './contract-validation.mjs';
import {freezeOwned} from './road-geometry.mjs';
/** Quasi-static load-line and friction assessment on the sampled affine
 * support plane. Wheel coordinates follow inspectVehicleSupport's horizontal
 * footprint convention. CG height is normal to that plane, centered between
 * contacts. Horizontal acceleration is prescribed; suspension, transients,
 * tyre deformation, braking distribution and terrain changes are not solved. */
export function inspectVehicleStability(support,{wheelbaseM,trackWidthM,centerOfMassHeightM,
 frictionCoefficient,speedMPerSecond,curvaturePerM=0,longitudinalAccelerationMPerSecond2=0,gravityMPerSecond2=9.80665}={}){
 for(const[k,v]of Object.entries({wheelbaseM,trackWidthM,centerOfMassHeightM,gravityMPerSecond2}))positiveNumber(v,k);
 for(const[k,v]of Object.entries({frictionCoefficient,speedMPerSecond}))finiteNumber(v,k);
 if(frictionCoefficient<0||speedMPerSecond<0)throw new RangeError('Friction and speed must be nonnegative');
 if(!Array.isArray(support?.samples)||!support.samples.length||support.samples.length>8193)throw new TypeError('Sampled vehicle support is required');
 const values=(value,name)=>{if(Array.isArray(value)){if(value.length!==support.samples.length)throw new RangeError(name+' must match support samples');for(const v of value)finiteNumber(v,name);return [...value];}finiteNumber(value,name);return support.samples.map(()=>value);};
 const curves=values(curvaturePerM,'curvature'),accelerations=values(longitudinalAccelerationMPerSecond2,'longitudinal acceleration'),laterals=curves.map(c=>finiteNumber(speedMPerSecond**2*c,'lateral acceleration'));
 const samples=[],violations=[];
 for(let index=0;index<support.samples.length;index++){const q=support.samples[index],lateralAccelerationMPerSecond2=laterals[index];finiteNumber(q.pitchSlope,'pitch');finiteNumber(q.rollSlope,'roll');
  const scale=Math.hypot(q.pitchSlope,q.rollSlope,1),normal=[-q.pitchSlope/scale,-q.rollSlope/scale,1/scale],
   effective=[-accelerations[index],-lateralAccelerationMPerSecond2,-gravityMPerSecond2],
   normalLoadPerKg=-effective.reduce((n,v,i)=>n+v*normal[i],0),reasons=[];
  let frictionDemand=null,loadPointXM=null,loadPointYM=null;
  if(normalLoadPerKg<=0)reasons.push('no-compressive-contact');
  else{
   frictionDemand=Math.hypot(...effective.map((v,i)=>v+normalLoadPerKg*normal[i]))/normalLoadPerKg;
   loadPointXM=centerOfMassHeightM*(normal[0]+effective[0]/normalLoadPerKg);
   loadPointYM=centerOfMassHeightM*(normal[1]+effective[1]/normalLoadPerKg);
   if(frictionDemand>frictionCoefficient+1e-12)reasons.push('insufficient-friction');
   if(Math.abs(loadPointXM)>wheelbaseM/2+1e-12)reasons.push('longitudinal-tip-risk');
   if(Math.abs(loadPointYM)>trackWidthM/2+1e-12)reasons.push('lateral-tip-risk');
  }
  const result={index:q.index,normalLoadPerKg,frictionDemand,loadPointXM,loadPointYM,reasons};
  for(const[k,v]of Object.entries(result))if(typeof v==='number')finiteNumber(v,k);
  samples.push(result);if(reasons.length)violations.push({index:q.index,reasons});
 }
 return freezeOwned({status:violations.length?'quasi-static-constraints-unmet':'within-quasi-static-limits',
  input:{wheelbaseM,trackWidthM,centerOfMassHeightM,frictionCoefficient,speedMPerSecond,curvaturePerM:Array.isArray(curvaturePerM)?curves:curvaturePerM,longitudinalAccelerationMPerSecond2:Array.isArray(longitudinalAccelerationMPerSecond2)?accelerations:longitudinalAccelerationMPerSecond2,gravityMPerSecond2},
  lateralAccelerationMPerSecond2:Array.isArray(curvaturePerM)?laterals:laterals[0],samples,violations,
  supportStatus:support.status??'unspecified',scope:'prescribed horizontal acceleration; sampled plane and centered CG; not transient vehicle dynamics or between-sample contact certification'});
}

/** Acceleration of the body center (wheelbase/2 ahead of the rear axle)
 * for the saved constant-steering kinematic segments. At a command junction
 * use the larger adjacent curvature magnitude; steering transients remain
 * excluded. Speed is the rear axle's speed along its path. */
export function bicycleAccelerationProfile(motion,{speedMPerSecond,wheelbaseM}){
 positiveNumber(wheelbaseM,'wheelbaseM');finiteNumber(speedMPerSecond,'speed');if(speedMPerSecond<0)throw new RangeError('Speed must be nonnegative');
 const curves=motion?.segmentCurvaturePerM;
 if(!Array.isArray(motion?.poses)||motion.poses.length<2||motion.poses.length>8193||!Array.isArray(curves)||curves.length!==motion.poses.length-1)throw new TypeError('Analytic segment curvature is required');
 for(const k of curves)finiteNumber(k,'segment curvature');
 const curvaturePerM=motion.poses.map((_,i)=>{const a=curves[Math.max(0,i-1)],b=curves[Math.min(i,curves.length-1)];return Math.abs(a)>Math.abs(b)?a:b;});
 const longitudinalAccelerationMPerSecond2=curvaturePerM.map(k=>finiteNumber(-(speedMPerSecond**2*k**2*wheelbaseM/2),'body-center longitudinal acceleration'));
 return{curvaturePerM,longitudinalAccelerationMPerSecond2};
}

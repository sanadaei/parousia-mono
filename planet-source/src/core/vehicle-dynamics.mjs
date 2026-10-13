import {positiveNumber,finiteNumber} from './contract-validation.mjs';
import {freezeOwned} from './road-geometry.mjs';

/** Convert the actual constant-steering path to elapsed time at rear-axle
 * speed. The body-centre chord is not mistaken for rear-axle arc distance. */
export function timeVehicleMotion(motion,{speedMPerSecond,wheelbaseM,stationarySeconds=3}){
 positiveNumber(wheelbaseM,'wheelbase');finiteNumber(speedMPerSecond,'speed');if(speedMPerSecond<0||speedMPerSecond>50)throw new RangeError('Speed must be 0..50m/s');positiveNumber(stationarySeconds,'stationary seconds');
 if(!Array.isArray(motion?.poses)||motion.poses.length<2||motion.poses.length>8193||!Array.isArray(motion.segmentCurvaturePerM)||motion.segmentCurvaturePerM.length!==motion.poses.length-1)throw new TypeError('Analytic bicycle motion required');
 let timeSeconds=0;const out=[{...motion.poses[0],timeSeconds:0}];
 if(speedMPerSecond===0)return[{...out[0]},{...out[0],timeSeconds:stationarySeconds}];
 for(let i=0;i<motion.segmentCurvaturePerM.length;i++){
  const a=motion.poses[i],b=motion.poses[i+1],k=motion.segmentCurvaturePerM[i];finiteNumber(k,'curvature');
  const distance=Math.abs(k)>1e-12?Math.abs((b.headingRad-a.headingRad)/k):Math.hypot(b.xM-a.xM,b.yM-a.yM);
  if(distance<=0)continue;timeSeconds+=distance/speedMPerSecond;
  out.at(-1).lateralAccelerationMPerSecond2=speedMPerSecond**2*k;out.at(-1).longitudinalAccelerationMPerSecond2=-(speedMPerSecond**2*k**2*wheelbaseM/2);
  out.push({...b,timeSeconds});
 }
 if(out.length<2)out.push({...out[0],timeSeconds:stationarySeconds});
 return out;
}

/** Three sprung-body degrees of freedom: heave, small-angle pitch and roll.
 * Four massless wheel followers drive unilateral vertical spring/dampers.
 * Horizontal motion is prescribed. No tyre force, unsprung wheel dynamics,
 * trailer, collision response or continuous surface certificate is inferred. */
export function simulateVehicleDynamics({poses,sampleSurface,wheelbaseM,trackWidthM,lengthM,widthM,centerOfMassHeightM,groundClearanceM,
 massKg,pitchInertiaKgM2,rollInertiaKgM2,springNPerM,damperNsPerM,maxCompressionM=.3,maxAngleRad=.4,
 timeStepSeconds=.005,outputStepSeconds=.05,settleSeconds=1,initialVerticalOffsetM=0,maxSteps=24000}){
 for(const[k,v]of Object.entries({wheelbaseM,trackWidthM,lengthM,widthM,centerOfMassHeightM,groundClearanceM,massKg,pitchInertiaKgM2,rollInertiaKgM2,springNPerM,maxCompressionM,maxAngleRad,timeStepSeconds,outputStepSeconds}))positiveNumber(v,k);
 finiteNumber(damperNsPerM,'damper');finiteNumber(settleSeconds,'settle time');finiteNumber(initialVerticalOffsetM,'initial displacement');
 if(damperNsPerM<0||settleSeconds<0||settleSeconds>30||Math.abs(initialVerticalOffsetM)>2||maxAngleRad>.5||wheelbaseM>lengthM||trackWidthM>widthM||groundClearanceM>=centerOfMassHeightM)throw new RangeError('Invalid sprung vehicle dimensions or limits');
 if(typeof sampleSurface!=='function'||!Array.isArray(poses)||poses.length<2||poses.length>8193||!Number.isSafeInteger(maxSteps)||maxSteps<1||maxSteps>24000)throw new RangeError('Invalid dynamic motion budget');
 let prior=-Infinity;for(const p of poses){for(const k of ['xM','yM','headingRad','timeSeconds'])finiteNumber(p?.[k],k);if(p.timeSeconds<=prior)throw new RangeError('Motion times must increase');prior=p.timeSeconds;for(const k of ['lateralAccelerationMPerSecond2','longitudinalAccelerationMPerSecond2'])if(p[k]!=null)finiteNumber(p[k],k);}
 if(poses[0].timeSeconds!==0)throw new RangeError('Motion must start at zero');
 const duration=poses.at(-1).timeSeconds+settleSeconds;if(duration>120)throw new RangeError('Dynamic motion exceeds 120 seconds');
 const pitchK=springNPerM*wheelbaseM**2,rollK=springNPerM*trackWidthM**2,
  elasticStep=.1*Math.min(Math.sqrt(massKg/(4*springNPerM)),Math.sqrt(pitchInertiaKgM2/pitchK),Math.sqrt(rollInertiaKgM2/rollK)),
  dampingStep=damperNsPerM>0?.1*Math.min(massKg/(4*damperNsPerM),pitchInertiaKgM2/(damperNsPerM*wheelbaseM**2),rollInertiaKgM2/(damperNsPerM*trackWidthM**2)):Infinity,
  count=Math.ceil(duration/Math.min(timeStepSeconds,elasticStep,dampingStep));
 if(!Number.isFinite(count)||count>maxSteps||Math.ceil(duration/outputStepSeconds)>4096)throw new RangeError('Dynamic integration exceeds the bounded work budget');
 const dt=duration/count,gravity=9.80665,restLengthM=centerOfMassHeightM+massKg*gravity/(4*springNPerM),contacts=[-1,1].flatMap(u=>[-1,1].map(v=>({u:u*wheelbaseM/2,v:v*trackWidthM/2}))),bodyPoints=[{u:0,v:0},...[-1,1].flatMap(u=>[-1,1].map(v=>({u:u*lengthM/2,v:v*widthM/2})))];
 finiteNumber(restLengthM,'spring rest length');
 let index=0,probes=0;const poseAt=t=>{while(index+1<poses.length-1&&poses[index+1].timeSeconds<=t)index++;const a=poses[index],b=poses[index+1],f=Math.min(1,(t-a.timeSeconds)/(b.timeSeconds-a.timeSeconds));return{xM:a.xM+(b.xM-a.xM)*f,yM:a.yM+(b.yM-a.yM)*f,headingRad:a.headingRad+(b.headingRad-a.headingRad)*f,
  lateral:t>=poses.at(-1).timeSeconds?0:a.lateralAccelerationMPerSecond2??0,longitudinal:t>=poses.at(-1).timeSeconds?0:a.longitudinalAccelerationMPerSecond2??0};};
 const ground=(p,q)=>{probes++;const c=Math.cos(p.headingRad),s=Math.sin(p.headingRad),v=sampleSurface(p.xM+q.u*c-q.v*s,p.yM+q.u*s+q.v*c);finiteNumber(v?.supportElevationM,'wheel/underbody support elevation');return v.supportElevationM;};
 let p=poseAt(0),lastGround=contacts.map(q=>ground(p,q)),z=lastGround.reduce((s,v)=>s+v/4,0)+centerOfMassHeightM+initialVerticalOffsetM,
  pitch=contacts.reduce((s,q,i)=>s+q.u*lastGround[i],0)/wheelbaseM**2,roll=contacts.reduce((s,q,i)=>s+q.v*lastGround[i],0)/trackWidthM**2,vz=0,vPitch=0,vRoll=0;
 const samples=[],events=[],counts={underbodyContact:0,unloadedWheel:0,compressionLimit:0};let eventCount=0,nextOutput=0,termination=null,minimumClearanceM=Infinity,maximumPitchRad=0,maximumRollRad=0,maximumCompressionM=0;
 for(let step=0;step<=count;step++){
  const t=step*dt;p=poseAt(t);const heights=step?contacts.map(q=>ground(p,q)):lastGround,forces=[],compressions=[];let force=0,pitchMoment=massKg*centerOfMassHeightM*p.longitudinal,rollMoment=massKg*centerOfMassHeightM*p.lateral;
  for(let i=0;i<4;i++){const q=contacts[i],compression=restLengthM+heights[i]-(z+pitch*q.u+roll*q.v),groundSpeed=step?(heights[i]-lastGround[i])/dt:0,relativeSpeed=vz+vPitch*q.u+vRoll*q.v-groundSpeed,
   f=compression<=0?0:Math.max(0,springNPerM*compression-damperNsPerM*relativeSpeed);forces.push(f);compressions.push(compression);force+=f;pitchMoment+=q.u*f;rollMoment+=q.v*f;}
  if(step){vz+=(force/massKg-gravity)*dt;vPitch+=pitchMoment/pitchInertiaKgM2*dt;vRoll+=rollMoment/rollInertiaKgM2*dt;z+=vz*dt;pitch+=vPitch*dt;roll+=vRoll*dt;}
  for(const value of [z,pitch,roll,vz,vPitch,vRoll])finiteNumber(value,'dynamic body state');
  const clearance=Math.min(...bodyPoints.map(q=>z-(centerOfMassHeightM-groundClearanceM)+pitch*q.u+roll*q.v-ground(p,q))),compression=Math.max(...compressions),unloaded=forces.filter(f=>f<=1e-8).length;
  minimumClearanceM=Math.min(minimumClearanceM,clearance);maximumPitchRad=Math.max(maximumPitchRad,Math.abs(pitch));maximumRollRad=Math.max(maximumRollRad,Math.abs(roll));maximumCompressionM=Math.max(maximumCompressionM,compression);
  const reasons=[];if(clearance<0){counts.underbodyContact++;reasons.push('sampled-underbody-contact');}if(unloaded){counts.unloadedWheel++;reasons.push('unloaded-massless-wheel');}if(compression>maxCompressionM){counts.compressionLimit++;reasons.push('spring-travel-limit');}
  if(Math.max(Math.abs(pitch),Math.abs(roll))>maxAngleRad){termination='small-angle-domain-exceeded';reasons.push(termination);}
  if(reasons.length){eventCount++;if(events.length<256)events.push({timeSeconds:t,reasons});}
  if(t>=nextOutput||step===count||termination){samples.push({timeSeconds:t,xM:p.xM,yM:p.yM,headingRad:p.headingRad,bodyElevationM:z,verticalVelocityMPerSecond:vz,pitchRad:pitch,rollRad:roll,clearanceM:clearance,maximumCompressionM:compression,appliedWheelForcesN:forces,unloadedWheels:unloaded});nextOutput=t+outputStepSeconds;}
  lastGround=heights;if(termination)break;
 }
 return freezeOwned({schema:'small-angle-sprung-body@1',status:termination??(Object.values(counts).some(v=>v>0)?'dynamic-conditions-unmet':'within-sampled-dynamic-conditions'),requestedDurationSeconds:duration,completedDurationSeconds:samples.at(-1).timeSeconds,timeStepSeconds:dt,probes,
  input:{wheelbaseM,trackWidthM,lengthM,widthM,centerOfMassHeightM,groundClearanceM,massKg,pitchInertiaKgM2,rollInertiaKgM2,springNPerM,damperNsPerM,maxCompressionM,maxAngleRad,settleSeconds,initialVerticalOffsetM,restLengthM},
  minimumClearanceM,maximumPitchRad,maximumRollRad,maximumCompressionM,counts,events,eventCount,eventListTruncated:eventCount>events.length,samples,
  scope:'prescribed piecewise-linear timed body path; four massless unilateral spring/damper followers, heave and small-angle pitch/roll; sampled underbody points; no tyre slip, unsprung masses, collision response, continuous contact or rollover certification'});
}

import {buildingPlanarBox} from './building-geometry.mjs';
import {finiteNumber,positiveNumber} from './contract-validation.mjs';
import {freezeOwned} from './road-geometry.mjs';
const cross=(a,b,c)=>(b.xM-a.xM)*(c.yM-a.yM)-(b.yM-a.yM)*(c.xM-a.xM);
function hull(points){const p=points.slice().sort((a,b)=>a.xM-b.xM||a.yM-b.yM),lo=[],hi=[];for(const q of p){while(lo.length>1&&cross(lo.at(-2),lo.at(-1),q)<=0)lo.pop();lo.push(q);}for(const q of p.slice().reverse()){while(hi.length>1&&cross(hi.at(-2),hi.at(-1),q)<=0)hi.pop();hi.push(q);}return lo.slice(0,-1).concat(hi.slice(0,-1));}
function corners(p,length,width){const c=Math.cos(p.headingRad),s=Math.sin(p.headingRad);return[-1,1].flatMap(a=>[-1,1].map(b=>({xM:p.xM+a*length/2*c-b*width/2*s,yM:p.yM+a*length/2*s+b*width/2*c})));}
function pose(p){for(const k of ['xM','yM','bottomElevationM','headingRad'])finiteNumber(p?.[k],`pose.${k}`);return p;}
function overlaps(a,b){for(const poly of[a,b])for(let i=0;i<poly.length;i++){const p=poly[i],q=poly[(i+1)%poly.length],nx=q.yM-p.yM,ny=p.xM-q.xM,aa=a.map(v=>v.xM*nx+v.yM*ny),bb=b.map(v=>v.xM*nx+v.yM*ny);if(Math.max(...aa)<Math.min(...bb)-1e-9||Math.max(...bb)<Math.min(...aa)-1e-9)return false;}return true;}
/** Rear-axle bicycle kinematics at constant steering within each command.
 * Coordinates returned are BODY CENTRES. The body centre is wheelbase/2 ahead
 * of the rear axle. No tyre slip, trailers, suspension or dynamics are inferred.
 * Each analytic arc is bounded against its chord; that error accompanies poses. */
export function traceVehicleTurn({start,wheelbaseM,commands,maxStepM=.5,maxHeadingStepRad=.05,maxSegments=8192}){
 pose(start);positiveNumber(wheelbaseM,'wheelbaseM');positiveNumber(maxStepM,'maxStepM');positiveNumber(maxHeadingStepRad,'maxHeadingStepRad');
 if(!Array.isArray(commands)||commands.length>1024||!Number.isSafeInteger(maxSegments)||maxSegments<1||maxSegments>8192)throw new RangeError('Invalid vehicle path budget');
 let p={...start};const poses=[{...p}],segmentPositionErrorM=[],segmentCurvaturePerM=[];
 for(const command of commands){finiteNumber(command.distanceM,'distanceM');finiteNumber(command.steeringRad,'steeringRad');if(Math.abs(command.steeringRad)>=Math.PI/2-.01)throw new RangeError('Steering must remain below 90 degrees');
 const curvature=Math.tan(command.steeringRad)/wheelbaseM,n=Math.max(1,Math.ceil(Math.abs(command.distanceM)/maxStepM),Math.ceil(Math.abs(command.distanceM*curvature)/maxHeadingStepRad));if(poses.length-1+n>maxSegments)throw new RangeError('Vehicle path budget exceeded');
 const ds=command.distanceM/n;for(let i=0;i<n;i++){const h=p.headingRad,next=h+ds*curvature,a=wheelbaseM/2;
 let dx,dy;if(Math.abs(curvature)<1e-12){dx=ds*Math.cos(h);dy=ds*Math.sin(h);}else{dx=(Math.sin(next)-Math.sin(h))/curvature;dy=(-Math.cos(next)+Math.cos(h))/curvature;}
 p={xM:p.xM+dx+a*(Math.cos(next)-Math.cos(h)),yM:p.yM+dy+a*(Math.sin(next)-Math.sin(h)),bottomElevationM:p.bottomElevationM,headingRad:next};poses.push({...p});
 segmentCurvaturePerM.push(curvature);segmentPositionErrorM.push(Math.abs(curvature)<1e-12?0:Math.hypot(1/curvature,a)*(next-h)**2/8);
 }}return freezeOwned({poses,segmentCurvaturePerM,segmentPositionErrorM,model:'constant-steering bicycle; body centred over wheelbase; flat elevation'});
}
/** Continuous enclosure for linearly interpolated position/elevation and
 * UNWRAPPED heading. Rotation interpolation error <= rho * angle² / 8 from
 * the second derivative bound. Add analytic centre-arc error from traceVehicleTurn.
 * Convex hull + square inflation encloses every body corner, not just samples.
 * Overlap is a possible collision; disjoint is certified under these contracts. */
export function inspectVehicleSweep({poses,segmentPositionErrorM=null,lengthM,widthM,heightM,obstacles=[],marginM=0,maxPairs=2000000}){
 for(const[k,v]of Object.entries({lengthM,widthM,heightM}))positiveNumber(v,k);finiteNumber(marginM,'marginM');if(marginM<0)throw new RangeError('Negative clearance margin');
 if(!Array.isArray(poses)||poses.length<2||poses.length>8193||!Array.isArray(obstacles)||obstacles.length>4096||!Number.isSafeInteger(maxPairs)||maxPairs<1||maxPairs>2000000)throw new RangeError('Invalid sweep budget');poses.forEach(pose);
 const errors=segmentPositionErrorM??Array(poses.length-1).fill(0);if(!Array.isArray(errors)||errors.length!==poses.length-1||!errors.every(x=>Number.isFinite(x)&&x>=0))throw new TypeError('Invalid path enclosure errors');
 const ids=new Set(),solids=obstacles.map(o=>{if(typeof o.id!=='string'||!o.id||ids.has(o.id))throw new TypeError('Invalid obstacle identity');ids.add(o.id);pose(o);for(const k of['lengthM','widthM','heightM'])positiveNumber(o[k],k);return{...o,polygon:hull(corners(o,o.lengthM,o.widthM))};});
 const radius=Math.hypot(lengthM,widthM)/2,envelopes=[],conflicts=[];let testedPairs=0;
 for(let i=0;i<poses.length-1;i++){const a=poses[i],b=poses[i+1],angle=b.headingRad-a.headingRad;if(Math.abs(angle)>Math.PI)throw new RangeError('Subdivide turns greater than 180 degrees; heading must be unwrapped');
 const errorM=radius*angle**2/8+errors[i]+marginM,points=corners(a,lengthM,widthM).concat(corners(b,lengthM,widthM));
 const polygon=hull(points.flatMap(p=>[-1,1].flatMap(x=>[-1,1].map(y=>({xM:p.xM+x*errorM,yM:p.yM+y*errorM}))))),bottom=Math.min(a.bottomElevationM,b.bottomElevationM)-marginM,top=Math.max(a.bottomElevationM,b.bottomElevationM)+heightM+marginM;
 envelopes.push({segment:i,polygon,bottomElevationM:bottom,topElevationM:top,enclosureErrorM:errorM});
 for(const o of solids){if(++testedPairs>maxPairs)throw new RangeError('Sweep obstacle budget exceeded');if(top<=o.bottomElevationM+1e-9||bottom>=o.bottomElevationM+o.heightM-1e-9)continue;if(overlaps(polygon,o.polygon))conflicts.push({segment:i,obstacleId:o.id,status:'possible-collision'});}
 }
 return freezeOwned({status:conflicts.length?'possible-collision':'clear-for-specified-motion',envelopes,conflicts,testedPairs,scope:'rigid rectangular body; bounded continuous pose sweep; no support, traction, trailer or suspension certification'});
}
/** Conservatively enclose real generated houses (including roofs) and bridge
 * boxes. These are the same saved geometries used by the globe renderer. */
export function settlementVehicleObstacles(recipe){
 if(!recipe||!Array.isArray(recipe.buildings)||recipe.buildings.length>4096)throw new TypeError('Invalid settlement buildings');
 const houses=recipe.buildings.map(b=>({id:b.id,...buildingPlanarBox(b),bottomElevationM:b.baseElevationM,heightM:b.heightM+b.roofHeightM}));
 const bridges=(recipe.bridgeStructures??[]).flatMap(s=>s.boxes.map(b=>({id:b.id,xM:b.center.xM,yM:b.center.yM,bottomElevationM:b.bottomElevationM,headingRad:Math.atan2(b.direction.yM,b.direction.xM),lengthM:b.lengthM,widthM:b.widthM,heightM:b.topElevationM-b.bottomElevationM})));
 return freezeOwned(houses.concat(bridges));
}

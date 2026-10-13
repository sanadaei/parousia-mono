import {offsetGeographic,greatCircle} from '../core/spherical.mjs';
/** View-only navigation using the saved twelve-ray shoreline survey.
 * It does not create water or alter terrain. Irregular shorelines and the
 * finite source survey make this an approximate inspection location. */
export function lakeShoreView(lake,radiusM,index=0){
 const distances=lake?.shoreRadiusSamplesM;
 if(!Array.isArray(distances)||distances.length!==12||!Number.isFinite(radiusM)||radiusM<=0
  ||!Number.isInteger(index)||!Number.isFinite(lake.latDeg)||Math.abs(lake.latDeg)>90||!Number.isFinite(lake.lonDeg))return null;
 const rays=distances.map((d,i)=>({d,i})).filter(v=>Number.isFinite(v.d)&&v.d>0&&v.d<Math.PI*radiusM*.9).sort((a,b)=>a.d-b.d||a.i-b.i);
 if(!rays.length)return null;
 const ray=rays[((index%rays.length)+rays.length)%rays.length],theta=ray.i*Math.PI/6;
 const point=offsetGeographic(lake,Math.cos(theta)*ray.d,Math.sin(theta)*ray.d,radiusM);
 const inward=greatCircle(point,lake,radiusM).bearingDeg;
 return{point,altitudeM:1500,tiltRad:55*Math.PI/180,headingRad:((inward??0)+180)*Math.PI/180,ray:ray.i,approximate:true};
}

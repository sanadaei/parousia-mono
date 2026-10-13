import { sphereBasis } from './spherical.mjs';
const rad=Math.PI/180;
/** One planet-fixed light vector. No wall-clock reads and no per-village sun. */
export function solarDirection({dayFraction=.5,declinationDeg=0,primeNoonLongitudeDeg=0}={}) {
 if(![dayFraction,declinationDeg,primeNoonLongitudeDeg].every(Number.isFinite)||Math.abs(declinationDeg)>90)throw new RangeError('Invalid solar state');
 const lon=(primeNoonLongitudeDeg+180-360*((dayFraction%1+1)%1))*rad,d=declinationDeg*rad;
 return [Math.cos(d)*Math.cos(lon),Math.cos(d)*Math.sin(lon),Math.sin(d)];
}
export function solarAt(point,state={}) {
 const basis=sphereBasis(point),sun=solarDirection(state),dot=a=>a.reduce((s,v,i)=>s+v*sun[i],0),altitudeDeg=Math.asin(Math.max(-1,Math.min(1,dot(basis.up))))/rad;
 const east=dot(basis.east),north=dot(basis.north);
 return {direction:sun,altitudeDeg,azimuthDeg:(Math.atan2(east,north)/rad+360)%360,phase:altitudeDeg>0?'day':altitudeDeg>=-6?'twilight':'night',localHour:(((state.dayFraction??.5)*24+(point.lonDeg-(state.primeNoonLongitudeDeg??0))/15)%24+24)%24};
}
/** Setting local time changes the single global clock, not that village alone. */
export function dayFractionForLocalHour(lonDeg,hour,primeNoonLongitudeDeg=0){
 if(![lonDeg,hour,primeNoonLongitudeDeg].every(Number.isFinite))throw new RangeError('Invalid time');
 return (((hour-(lonDeg-primeNoonLongitudeDeg)/15)/24)%1+1)%1;
}

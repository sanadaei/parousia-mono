/** A spherical convex hull is normalize(sum(weights * unit corners)).
 * In an azimuthal-equidistant chart its metric coordinate is
 * R * atan2(hypot(e,n),u) / hypot(e,n) * (e,n).
 * Normalization cancels. Enclose the common scale and retain correlated
 * east/north corner pairs, so an arbitrary road-axis projection is tighter
 * than a disk which extends outside the actual tile. No sampled Hessian.
 */
export function projectedHullEnvelope(corners,basis,radiusM){
  if(!Array.isArray(corners)||corners.length<3||corners.length>16||!corners.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite))
    ||!Number.isFinite(radiusM)||radiusM<=0)return null;
  const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0),points=corners.map(p=>({east:dot(p,basis.east),north:dot(p,basis.north),up:dot(p,basis.up)})),
    e=[Math.min(...points.map(p=>p.east)),Math.max(...points.map(p=>p.east))],n=[Math.min(...points.map(p=>p.north)),Math.max(...points.map(p=>p.north))],
    u=[Math.min(...points.map(p=>p.up)),Math.max(...points.map(p=>p.up))],near=r=>r[0]>0?r[0]:r[1]<0?-r[1]:0,
    s0=Math.hypot(near(e),near(n)),s1=Math.hypot(Math.max(...e.map(Math.abs)),Math.max(...n.map(Math.abs)));
  if(u[0]<=0)return null;
  const scale=(s,u)=>radiusM*(s===0?1/u:Math.atan2(s,u)/s);
  return {points:points.map(({east,north})=>({east,north})),minScaleM:scale(s1,u[1]),maxScaleM:scale(s0,u[0]),roundingM:256*Number.EPSILON*radiusM};
}

export function validateProjectedHull(hull){
  if(hull==null)return null;
  if(!Array.isArray(hull.points)||hull.points.length<3||hull.points.length>16||!hull.points.every(p=>Number.isFinite(p?.east)&&Number.isFinite(p?.north))
    ||![hull.minScaleM,hull.maxScaleM,hull.roundingM].every(Number.isFinite)||hull.minScaleM<=0||hull.maxScaleM<hull.minScaleM||hull.roundingM<0)
    throw new RangeError('Invalid projected spherical hull');
  return {points:hull.points.map(p=>({east:p.east,north:p.north})),minScaleM:hull.minScaleM,maxScaleM:hull.maxScaleM,roundingM:hull.roundingM};
}

export function projectedHullAxisRange(hull,axisX,axisY){
  if(!hull)return null;
  const values=hull.points.map(p=>p.east*axisX+p.north*axisY),lo=Math.min(...values),hi=Math.max(...values),
    products=[lo*hull.minScaleM,lo*hull.maxScaleM,hi*hull.minScaleM,hi*hull.maxScaleM],slack=hull.roundingM*Math.hypot(axisX,axisY);
  return [Math.min(...products)-slack,Math.max(...products)+slack];
}

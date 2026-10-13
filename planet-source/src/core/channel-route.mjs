/** Round surveyed-grid bends inside their adjacent cells. Preserve endpoints
 * (shared junctions) and leave physical height fitting to the caller. No noise,
 * camera dependence, or fallback to an unvalidated channel is introduced. */
export function channelRoute(points,policy='grid-channels@1'){
 if(policy==='grid-channels@1')return points;
 if(policy!=='rounded-survey-path@1')throw new RangeError('Unsupported channel route policy');
 if(points.length<3)return points;
 const mix=(a,b,t)=>({xM:a.xM+(b.xM-a.xM)*t,yM:a.yM+(b.yM-a.yM)*t,areaM2:a.areaM2+(b.areaM2-a.areaM2)*t});
 const out=[points[0]];
 for(let i=1;i<points.length-1;i++){
  const a=points[i-1],b=points[i],c=points[i+1],u={x:b.xM-a.xM,y:b.yM-a.yM},v={x:c.xM-b.xM,y:c.yM-b.yM},den=Math.hypot(u.x,u.y)*Math.hypot(v.x,v.y);
  if(den===0)throw new RangeError('Degenerate channel route');
  if(Math.abs(u.x*v.y-u.y*v.x)/den<1e-8&&u.x*v.x+u.y*v.y>0){out.push(b);continue;}
  const enter=mix(b,a,.25),exit=mix(b,c,.25);out.push(enter);
  for(let k=1;k<=8;k++){const t=k/8;out.push(mix(mix(enter,b,t),mix(b,exit,t),t));}
 }
 out.push(points.at(-1));return out;
}

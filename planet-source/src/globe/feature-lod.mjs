/** Coarse display reductions only. Canonical parcels and physical roads remain
 * unchanged; this module never generates or relocates a world feature. */
export function coalesceRoadSegments(segments,{maxSpanM=20,elevationToleranceM=.1}={}){
 const out=[];
 for(let i=0;i<segments.length;){
  let end=i,best=segments[i];
  for(let j=i+1;j<segments.length;j++){
   const a=segments[i].a,b=segments[j].b,span=b.distanceM-a.distanceM;
   if(span>maxSpanM||span<=0)break;
   let error=0,straight=true;
   for(let k=i;k<=j&&straight;k++)for(const p of [segments[k].a,segments[k].b]){
    const t=(p.distanceM-a.distanceM)/span;
    if(Math.hypot(p.xM-a.xM-(b.xM-a.xM)*t,p.yM-a.yM-(b.yM-a.yM)*t)>1e-8){straight=false;break;}
    // On each original interval, endpoint departure plus its certified cubic
    // chord error bounds departure from the new long straight display chord.
    error=Math.max(error,Math.abs(p.roadElevationM-a.roadElevationM-(b.roadElevationM-a.roadElevationM)*t)+segments[k].elevationErrorBoundM);
   }
   if(!straight||error>elevationToleranceM)break;
   end=j;best={a,b,elevationErrorBoundM:error};
  }
  out.push(best);i=end+1;
 }
 return out;
}

/** The regular UV-grid triangulation aligns with this two-triangle diagonal.
 * Bounding every fine vertex's 3D displacement therefore bounds every point
 * on the original piecewise-linear display surface by convex interpolation. */
export function coarseParcelTriangles(vertices,steps,toleranceM=.1){
 if(!Number.isInteger(steps)||steps<1||vertices.length!==(steps+1)**2)return null;
 const n=steps+1,a=vertices[0],b=vertices[steps],c=vertices.at(-1),d=vertices[steps*n];
 for(let y=0;y<=steps;y++)for(let x=0;x<=steps;x++){
  const u=x/steps,v=y/steps,p=vertices[y*n+x];
  const q=u>=v?a.map((z,i)=>z*(1-u)+b[i]*(u-v)+c[i]*v):a.map((z,i)=>z*(1-v)+c[i]*u+d[i]*(v-u));
  if(Math.hypot(...p.map((z,i)=>z-q[i]))>toleranceM)return null;
 }
 return[[a,b,c],[a,c,d]];
}

export const STREET_REFINEMENT_POLICY='surveyed-lattice-refinement@1';
const key=p=>`${p.xM},${p.yM}`;
const distance=(p,a,b)=>{const dx=b.xM-a.xM,dy=b.yM-a.yM,t=Math.max(0,Math.min(1,((p.xM-a.xM)*dx+(p.yM-a.yM)*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p.xM-a.xM-t*dx,p.yM-a.yM-t*dy);};
const cross=(a,b,c)=>(b.xM-a.xM)*(c.yM-a.yM)-(b.yM-a.yM)*(c.xM-a.xM);
const intersects=(a,b,c,d)=>cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0;
/** Refine only after the entire network is planned. All shared vertices and
 * endpoints remain fixed. Shortcuts must remain within 5m of the routed line,
 * pass the same full-width terrain survey, and not cross another street. */
export function refineStreetLattice(roads,{safeSegment,ground}){
 const owners=new Map();for(let ri=0;ri<roads.length;ri++)for(const p of roads[ri].samples){const k=key(p);if(!owners.has(k))owners.set(k,new Set());owners.get(k).add(ri);}
 const refined=[];let shortcuts=0;
 for(let ri=0;ri<roads.length;ri++){
  const road=roads[ri],ps=road.samples,keep=[0];let i=0;
  while(i<ps.length-1){let limit=i+1;while(limit<ps.length-1&&owners.get(key(ps[limit])).size===1&&Math.hypot(ps[limit+1].xM-ps[i].xM,ps[limit+1].yM-ps[i].yM)<=60)limit++;
   let chosen=i+1;
   for(let j=limit;j>i+1;j--){const a=ps[i],b=ps[j];if(ps.slice(i+1,j).some(p=>distance(p,a,b)>5))continue;
    let collision=false;for(let other=0;other<roads.length&&!collision;other++){if(other===ri)continue;const points=(refined[other]??roads[other]).samples;for(let k=1;k<points.length;k++)if(intersects(a,b,points[k-1],points[k])){collision=true;break;}}
    if(!collision&&safeSegment(a,b)){chosen=j;shortcuts++;break;}
   }keep.push(chosen);i=chosen;
  }
  // Preserve terrain elevations along the new centreline, rather than creating
  // one long elevated chord between shortcut endpoints.
  const samples=[];let total=0;
  for(let k=1;k<keep.length;k++){const a=ps[keep[k-1]],b=ps[keep[k]],length=Math.hypot(b.xM-a.xM,b.yM-a.yM),steps=keep[k]===keep[k-1]+1?1:Math.ceil(length/5);for(let j=k===1?0:1;j<=steps;j++){const t=j/steps,xM=a.xM+(b.xM-a.xM)*t,yM=a.yM+(b.yM-a.yM)*t;samples.push({...a,xM,yM,distanceM:total+t*length,roadElevationM:j===0?a.roadElevationM:j===steps?b.roadElevationM:ground(xM,yM)+.06});}total+=length;}
  refined.push({...road,samples});
 }
 return{roads:refined,shortcuts,policy:STREET_REFINEMENT_POLICY};
}

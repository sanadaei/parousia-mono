/** Small rear plots belong to actual homes. They are not painted onto streets,
 * other homes, civic reservations or wet ground to fill empty pixels. */
export function planFrontageGardens({buildings,roads,ground,water,reservations=[],backland=false,withinPlot=null}){
 if(backland){if(typeof withinPlot!=='function')throw new TypeError('Backland gardens require an owned plot boundary');return planBacklandGardens({buildings,roads,ground,water,reservations,withinPlot});}
 const result=[],allocated=[],overlap=(a,b)=>a.minXM<b.maxXM+1&&a.maxXM>b.minXM-1&&a.minYM<b.maxYM+1&&a.maxYM>b.minYM-1;
 for(const b of buildings){if(!b.frontage)continue;const x=(b.bounds.minXM+b.bounds.maxXM)/2,y=(b.bounds.minYM+b.bounds.maxYM)/2,a=b.frontage.access,dx=x-a.xM,dy=y-a.yM,d=Math.hypot(dx,dy);if(!d)continue;const nx=dx/d,ny=dy/d,cx=x+nx*13,cy=y+ny*13,ux=ny,uy=-nx,corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([p,q])=>({xM:cx+ux*p*4+nx*q*7,yM:cy+uy*p*4+ny*q*7})),box={minXM:Math.min(...corners.map(p=>p.xM)),maxXM:Math.max(...corners.map(p=>p.xM)),minYM:Math.min(...corners.map(p=>p.yM)),maxYM:Math.max(...corners.map(p=>p.yM))};
  if(box.minXM< -190||box.maxXM>190||box.minYM< -220||box.maxYM>220||[...reservations,...buildings.map(b=>b.bounds),...allocated].some(q=>overlap(box,q)))continue;
  if(roads.some(r=>r.samples.some(p=>p.xM>box.minXM-r.halfWidthM&&p.xM<box.maxXM+r.halfWidthM&&p.yM>box.minYM-r.halfWidthM&&p.yM<box.maxYM+r.halfWidthM)))continue;
  const steps=4,points=[];let dry=true,min=Infinity,max=-Infinity;for(let j=0;j<=steps;j++)for(let i=0;i<=steps;i++){const u=-4+i*8/steps,v=-7+j*14/steps,xM=cx+ux*u+nx*v,yM=cy+uy*u+ny*v,z=ground(xM,yM);dry&&=water(xM,yM).waterDepthM===0;min=Math.min(min,z);max=Math.max(max,z);points.push({xM,yM,elevationM:z+.04});}
  if(!dry||max-min>1.5)continue;allocated.push(box);result.push({id:b.id+'/rear-plot',ownerId:b.id,type:'household_garden',areaM2:112,steps,points,color:[.34,.40,.20],provenance:'Rear frontage plot, dry/grade and occupation screened; household gardening scenario, not simulated harvest'});
 }
 return result;
}


/** A bounded allocation behind a dwelling, inside its own canonical block.
 * Four candidate depths are surveyed; no new soil fertility or harvest is inferred.
 * Occupancy is conservative AABB clearance and water/grade are finite samples.
 */
function planBacklandGardens({buildings,roads,ground,water,reservations,withinPlot,depths=[30,24,18,14],reserveMinimum=true}) {
 // Reserve eligible minimum plots first, so one early household cannot absorb
 // a later household's entire garden merely because it was visited first.
 const minimum=reserveMinimum?planBacklandGardens({buildings,roads,ground,water,reservations,withinPlot,depths:[14],reserveMinimum:false}):null;
 const minimumBoxes=minimum?.map(p=>({ownerId:p.ownerId,minXM:Math.min(...p.points.map(q=>q.xM)),maxXM:Math.max(...p.points.map(q=>q.xM)),minYM:Math.min(...p.points.map(q=>q.yM)),maxYM:Math.max(...p.points.map(q=>q.yM))}));
 const results=[],allocated=[],obstacles=[...reservations,...buildings.map(b=>b.bounds)];
 const overlap=(a,b)=>a.minXM<b.maxXM+1&&a.maxXM>b.minXM-1&&a.minYM<b.maxYM+1&&a.maxYM>b.minYM-1;
 for(const building of buildings){
  if(!building.frontage||minimum&&!minimum.some(p=>p.ownerId===building.id))continue;
  const x=(building.bounds.minXM+building.bounds.maxXM)/2,y=(building.bounds.minYM+building.bounds.maxYM)/2;
  const a=building.frontage.access,dx=x-a.xM,dy=y-a.yM,d=Math.hypot(dx,dy);if(!d)continue;
  const nx=dx/d,ny=dy/d,ux=ny,uy=-nx;
  for(const depthM of depths){
   const cx=x+nx*(6+depthM/2),cy=y+ny*(6+depthM/2);
   const local=(u,v)=>({xM:cx+ux*u+nx*v,yM:cy+uy*u+ny*v});
   const corners=[[-4,-depthM/2],[4,-depthM/2],[4,depthM/2],[-4,depthM/2]].map(([u,v])=>local(u,v));
   if(!corners.every(p=>withinPlot(building,p)))continue;
   const box={minXM:Math.min(...corners.map(p=>p.xM)),maxXM:Math.max(...corners.map(p=>p.xM)),minYM:Math.min(...corners.map(p=>p.yM)),maxYM:Math.max(...corners.map(p=>p.yM))};
   if([...obstacles,...allocated,...(minimumBoxes??[]).filter(q=>q.ownerId!==building.id)].some(q=>overlap(box,q)))continue;
   if(roads.some(r=>r.samples.some(p=>p.xM>box.minXM-r.halfWidthM&&p.xM<box.maxXM+r.halfWidthM&&p.yM>box.minYM-r.halfWidthM&&p.yM<box.maxYM+r.halfWidthM)))continue;
   const steps=Math.ceil(depthM/4),points=[];let valid=true;
   for(let j=0;j<=steps&&valid;j++)for(let i=0;i<=steps;i++){
    const p=local(-4+i*8/steps,-depthM/2+j*depthM/steps),z=ground(p.xM,p.yM);
    if(!Number.isFinite(z)||water(p.xM,p.yM).waterDepthM!==0){valid=false;break;}
    points.push({...p,elevationM:z+.04});
   }
   for(let j=0;j<steps&&valid;j++)for(let i=0;i<steps;i++){
    const z00=points[j*(steps+1)+i].elevationM,z10=points[j*(steps+1)+i+1].elevationM,z01=points[(j+1)*(steps+1)+i].elevationM,z11=points[(j+1)*(steps+1)+i+1].elevationM;
    if(Math.max(Math.hypot((z10-z00)/(8/steps),(z01-z00)/(depthM/steps)),Math.hypot((z11-z01)/(8/steps),(z11-z10)/(depthM/steps)))>.12){valid=false;break;}
   }
   if(!valid)continue;
   allocated.push(box);results.push({id:building.id+'/rear-plot',ownerId:building.id,type:'household_garden',areaM2:8*depthM,depthM,steps,points,color:[.34,.40,.20],provenance:'Bounded rear-plot allocation inside owned urban block; sampled dry ground and grade, conservative occupation clearance. Gardening scenario, not soil survey or simulated harvest.'});break;
  }
 }
 return results;
}

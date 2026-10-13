/** Display-only topology for a straight road's ground/deck transitions.
 * Geometry is derived from saved station kinds, not from a height threshold.
 * Curved/self-crossing roads need their nearest-segment regions and are left
 * unsupported rather than treating their joint as an infinite straight cut.
 * No world heights, road classifications or certified error bounds change.
 */
export function straightBridgeGroundBreaklines(profiles = []) {
  const lines = [];
  for (const road of profiles) {
    const points = road.samples ?? road.points;
    if (!points || points.length < 3) continue;
    const first = points[0], last = points.at(-1), dx = last.xM-first.xM, dy = last.yM-first.yM, length = Math.hypot(dx,dy);
    if (!(length > 0)) continue;
    const direction = {xM:dx/length,yM:dy/length};
    let previous = -Infinity;
    if (!points.every(p => {
      const x=p.xM-first.xM,y=p.yM-first.yM,station=x*direction.xM+y*direction.yM,
        valid=Math.abs(x*direction.yM-y*direction.xM)<=1e-7 && station>previous;
      previous=station;return valid;
    })) continue;
    const deck = i => (points[i].segmentKind ??
      (points[i].structureKind==='bridge-deck' && points[i+1].structureKind==='bridge-deck' ? 'bridge-deck' : 'at-grade'))==='bridge-deck';
    for(let i=1;i<points.length-1;i++) if(deck(i-1)!==deck(i)) {
      const p=points[i];
      lines.push({id:`${road.roadId??road.id}/ground-transition:${i}`,point:{xM:p.xM,yM:p.yM},direction,
        deckSide:deck(i)?1:-1});
    }
  }
  return lines;
}

/** Clip a triangle into both open sides. The caller provides a shared-edge
 * crossing with separately sampled vertices on each side, and an actual
 * positional gap bound. Joining these pairs produces the nearly vertical
 * ground face without inventing a bridge pier or filling its waterway.
 * A missing/multiple crossing stays on the old conservative fallback.
 */
export async function splitGroundTriangle(triangle, signedDistance, crossing) {
  const distances=triangle.map(signedDistance);
  if(!distances.every(Number.isFinite)||!distances.some(d=>d<0)||!distances.some(d=>d>0)||distances.some(d=>d===0))return null;
  const negative=[],positive=[],pairs=[];
  for(let i=0;i<3;i++){
    const a=triangle[i],b=triangle[(i+1)%3],da=distances[i],db=distances[(i+1)%3];
    (da<0?negative:positive).push(a);
    if((da<0)===(db<0))continue;
    const pair=await crossing(a,b,da,db);
    if(!pair)return null;
    negative.push(pair.negative);positive.push(pair.positive);pairs.push(pair);
  }
  if(pairs.length!==2)return null;
  const fan=polygon=>polygon.slice(2).map((p,i)=>[polygon[0],polygon[i+1],p]);
  return {ground:[...fan(negative),...fan(positive)],
    wall:[[pairs[0].negative,pairs[1].negative,pairs[1].positive],
      [pairs[0].negative,pairs[1].positive,pairs[0].positive]],pairs};
}

/** A directed positional certificate, NOT a radial-height certificate.
 * For any canonical point P in this spherical cap and height interval, pick
 * Q on an ACTUALLY DRAWN edge with the nearest axial coordinate along cap.up.
 * Its axial miss is bounded by interval containment; its perpendicular miss
 * is bounded by the sum of P's cap radius and the edge endpoint radii.
 * Therefore distance(P, rendered surface) <= hypot(axialMiss, lateralMiss).
 * This is valid even across a vertical ground face; never subtract a cliff's
 * height from a radial error. Does not certify normals, water, reverse
 * mesh-to-world distance, visibility or an unrendered hypothetical face.
 */
export function groundToRenderedEdgeBound(bound, heights, edge, radiusM) {
  if(!bound || !Array.isArray(bound.center)||bound.center.length!==3 || !bound.center.every(Number.isFinite)
    ||Math.abs(Math.hypot(...bound.center)-1)>1e-8 || !Number.isFinite(bound.angular)||bound.angular<0||bound.angular>Math.PI/2
    ||!Array.isArray(heights)||heights.length!==2||!heights.every(Number.isFinite)||heights[0]>heights[1]
    ||!Number.isFinite(radiusM)||radiusM+heights[0]<=0
    ||!Array.isArray(edge)||edge.length!==2||!edge.every(p=>Array.isArray(p)&&p.length===3&&p.every(Number.isFinite)))return Infinity;
  const dot=p=>p.reduce((s,v,k)=>s+v*bound.center[k],0),axis=edge.map(dot),
    low=(radiusM+heights[0])*Math.cos(bound.angular),high=radiusM+heights[1],
    axialMiss=Math.max(0,Math.min(...axis)-low,high-Math.max(...axis)),
    lateralMiss=(radiusM+heights[1])*Math.sin(bound.angular)+Math.max(...edge.map((p,i)=>Math.hypot(...p.map((v,k)=>v-axis[i]*bound.center[k]))));
  return Math.hypot(axialMiss,lateralMiss)+128*Number.EPSILON*(radiusM+Math.max(...heights.map(Math.abs)));
}

/** Reverse side for canonical piecewise-continuous ground with its vertical
 * jump faces included (the boundary of the terrain solid). A fine triangle's
 * vertices are canonical samples, or mixtures of the two samples bounding a
 * jump. Along a path between the samples, the completed ground graph takes
 * every intermediate axial height. The matching point and the rendered point
 * both stay inside the cell cap, so their lateral separation is <= 2*r*sin(a).
 * Excludes parent morph, skirts and overlays; those are not fine ground.
 */
export function closedGroundReverseBound(bound,heights,radiusM){
  if(!bound||!Number.isFinite(bound.angular)||bound.angular<0||bound.angular>Math.PI/2
    ||!Array.isArray(heights)||heights.length!==2||!heights.every(Number.isFinite)||heights[0]>heights[1]
    ||!Number.isFinite(radiusM)||radiusM+heights[0]<=0)return Infinity;
  return 2*(radiusM+heights[1])*Math.sin(bound.angular)+128*Number.EPSILON*(radiusM+Math.max(...heights.map(Math.abs)));
}

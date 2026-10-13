/** Subtract surveyed road corridors from existing field triangles. Coordinates
 * and interpolated heights stay in the parcel's fixed local frame. This never
 * creates agricultural land outside the already accepted field surface. */
const area2 = p => p.reduce((s,a,i) => {const b=p[(i+1)%p.length];return s+a.xM*b.yM-a.yM*b.xM;},0);
function halfPlane(poly, nx, ny, limit, inside) {
  const out=[];
  for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],da=a.xM*nx+a.yM*ny-limit,db=b.xM*nx+b.yM*ny-limit;
    if(inside?da<=0:da>=0)out.push(a);
    if(da*db<0){const t=da/(da-db);out.push({xM:a.xM+(b.xM-a.xM)*t,yM:a.yM+(b.yM-a.yM)*t,elevationM:a.elevationM+(b.elevationM-a.elevationM)*t});}
  }
  return out.length>=3&&Math.abs(area2(out))>1e-8?out:[];
}
function subtract(poly, planes) {
  if(planes.some(([nx,ny,limit])=>poly.every(p=>p.xM*nx+p.yM*ny>=limit)))return [poly];
  const outside=[];let remaining=poly;
  for(const [nx,ny,limit] of planes){if(!remaining.length)break;const piece=halfPlane(remaining,nx,ny,limit,false);if(piece.length)outside.push(piece);remaining=halfPlane(remaining,nx,ny,limit,true);}
  return outside;
}
export function cutParcelRoads(parcels, segments, {maxTriangles=12000,report={}}={}) {
  if(!Number.isSafeInteger(maxTriangles)||maxTriangles<1)throw new RangeError('Invalid field triangle budget');
  const corridors=segments.map(({a,b,width})=>{
    const length=Math.hypot(b.xM-a.xM,b.yM-a.yM);
    if(!Number.isFinite(length)||length<=0||!Number.isFinite(width)||width<0)throw new RangeError('Invalid surveyed road corridor');
    const ux=(b.xM-a.xM)/length,uy=(b.yM-a.yM)/length,nx=-uy,ny=ux,w=width+.75;
    // Square end caps are conservative supersets of the road's end disc.
    return [[ux,uy,b.xM*ux+b.yM*uy+w],[-ux,-uy,-a.xM*ux-a.yM*uy+w],[nx,ny,a.xM*nx+a.yM*ny+w],[-nx,-ny,-a.xM*nx-a.yM*ny+w]];
  });
  let used=0;const result=[];report.deferredParcels=0;
  for(const parcel of parcels){const triangles=[];let exhausted=false;
    for(const triangle of parcel.triangles){let pieces=[triangle];
      for(const corridor of corridors){pieces=pieces.flatMap(p=>subtract(p,corridor));if(pieces.reduce((n,p)=>n+p.length-2,0)>maxTriangles-used){exhausted=true;break;}}
      if(exhausted)break;
      for(const p of pieces)for(let i=1;i<p.length-1;i++){if(used+triangles.length>=maxTriangles){exhausted=true;break;}triangles.push([p[0],p[i],p[i+1]]);}
      if(exhausted)break;
    }
    // A whole parcel is deferred rather than showing an arbitrary truncated
    // prefix or silently increasing memory. Existing IDs are never reassigned.
    if(exhausted){report.deferredParcels++;continue;}
    used+=triangles.length;
    const unchanged=triangles.length===parcel.triangles.length&&triangles.every((t,i)=>t.every((p,j)=>p===parcel.triangles[i][j]));
    if(triangles.length){if(unchanged)result.push(parcel);else{const {boundary,sourceBoundary,...rest}=parcel,origin=sourceBoundary??boundary;result.push({...rest,...(origin!=null?{sourceBoundary:origin}:{}),triangles,roadCutouts:'surveyed-corridors@1'});}}
  }
  return result;
}

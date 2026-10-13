import {roadCrossSectionOffsetBound} from './road-cross-section.mjs';
import { metricRoads, freezeOwned, nonnegative } from './road-geometry.mjs';
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
function footprint(s,width){const dx=s.b.xM-s.a.xM,dy=s.b.yM-s.a.yM,n=Math.hypot(dx,dy),x=-dy/n*width,y=dx/n*width;
 return [{x:s.a.xM+x,y:s.a.yM+y},{x:s.a.xM-x,y:s.a.yM-y},{x:s.b.xM-x,y:s.b.yM-y},{x:s.b.xM+x,y:s.b.yM+y}];}
function intersect(a,b){let out=a;
 for(let i=0;i<b.length&&out.length;i++){const c=b[i],d=b[(i+1)%b.length],input=out;out=[];
 for(let j=0;j<input.length;j++){const p=input[j],q=input[(j+1)%input.length],cp=cross(c,d,p),cq=cross(c,d,q);if(cp>=-1e-9)out.push(p);if((cp>=0)!==(cq>=0)){const t=cp/(cp-cq);out.push({x:p.x+(q.x-p.x)*t,y:p.y+(q.y-p.y)*t});}}
 }return out;}
function station(s,p){const dx=s.b.xM-s.a.xM,dy=s.b.yM-s.a.yM,t=Math.max(0,Math.min(1,((p.x-s.a.xM)*dx+(p.y-s.a.yM)*dy)/(dx*dx+dy*dy)));return s.a.distanceM+t*(s.b.distanceM-s.a.distanceM);}
const linear=s=>s.a.gradeSlope==null&&s.b.gradeSlope==null;
function heightRange(s,poly,road){const stations=poly.map(p=>station(s,p)),lo=Math.min(...stations),hi=Math.max(...stations),values=[s.curve.at(lo).roadElevationM,s.curve.at(hi).roadElevationM];
 // Derivative is quadratic. Recover its coefficients at three normalized points.
 const length=s.b.distanceM-s.a.distanceM,g0=s.curve.at(s.a.distanceM).gradeSlope,g1=s.curve.at(s.b.distanceM).gradeSlope,gm=s.curve.at(s.a.distanceM+length/2).gradeSlope;
 const A=2*(g1+g0-2*gm),B=g1-g0-A,C=g0,roots=[];
 if(Math.abs(A)<1e-15){if(Math.abs(B)>1e-15)roots.push(-C/B);}else{const disc=B*B-4*A*C;if(disc>=0){roots.push((-B-Math.sqrt(disc))/(2*A),(-B+Math.sqrt(disc))/(2*A));}}
 for(const t of roots){const d=s.a.distanceM+t*length;if(d>lo&&d<hi)values.push(s.curve.at(d).roadElevationM);}
 const offset=roadCrossSectionOffsetBound(road.road.crossSection,road.halfWidthM,lo,hi);
 return [Math.min(...values)-offset,Math.max(...values)+offset];}
/** Entire rectangular road widths (or an explicitly wider straight swept
 * envelope), including overlaps missed by centerline crossings. Curved turns,
 * vehicle dynamics and structural strength are separate contracts. */
export function inspectRoadCorridorClearance(roads,{vehicleWidthM=0,lateralMarginM=0,requiredClearanceM=4.5,atGradeToleranceM=.02,maxPairs=2000000}={}){
 for(const [k,v] of Object.entries({vehicleWidthM,lateralMarginM,requiredClearanceM,atGradeToleranceM}))nonnegative(v,k);
 if(!Number.isSafeInteger(maxPairs)||maxPairs<1||maxPairs>2000000)throw new RangeError('Invalid corridor budget');
 const routes=metricRoads(roads),overlaps=[];let testedPairs=0;
 for(let i=0;i<routes.length;i++)for(let j=i+1;j<routes.length;j++){
 const a=routes[i],b=routes[j],wa=Math.max(a.halfWidthM,vehicleWidthM/2+lateralMarginM),wb=Math.max(b.halfWidthM,vehicleWidthM/2+lateralMarginM);
 for(const sa of a.segments)for(const sb of b.segments){if(++testedPairs>maxPairs)throw new RangeError('Corridor pair budget exceeded');
 const poly=intersect(footprint(sa,wa),footprint(sb,wb));if(poly.length<3)continue;
 const area=Math.abs(poly.reduce((n,p,k)=>n+p.x*poly[(k+1)%poly.length].y-p.y*poly[(k+1)%poly.length].x,0))/2;if(area<1e-8)continue;
 let lo,hi,method;
 if(linear(sa)&&linear(sb)&&!a.road.crossSection&&!b.road.crossSection){const d=poly.map(p=>sa.curve.at(station(sa,p)).roadElevationM-sb.curve.at(station(sb,p)).roadElevationM);lo=Math.min(...d);hi=Math.max(...d);method='exact-affine-overlap-extrema';}
 else{const ar=heightRange(sa,poly,a),br=heightRange(sb,poly,b);lo=ar[0]-br[1];hi=ar[1]-br[0];method='conservative-cubic-height-interval';}
 const amid=a.at((sa.a.distanceM+sa.b.distanceM)/2),bmid=b.at((sb.a.distanceM+sb.b.distanceM)/2),upper=lo>=0?amid:hi<=0?bmid:null;
 const minimumClearanceM=upper?(lo>=0?lo:-hi)-upper.deckThicknessM:null;
 const sameGrade=Math.max(Math.abs(lo),Math.abs(hi))<=atGradeToleranceM&&amid.structureKind!=='bridge-deck'&&bmid.structureKind!=='bridge-deck';
 overlaps.push({roadIds:[a.id,b.id],polygon:poly.map(p=>({xM:p.x,yM:p.y})),areaM2:area,method,verticalDifferenceRangeM:[lo,hi],minimumClearanceM,
 status:sameGrade?'at-grade-compatible':upper?.structureKind==='bridge-deck'&&minimumClearanceM>=requiredClearanceM?'clearance-certified':method==='conservative-cubic-height-interval'?'unresolved-cubic-clearance':'clearance-conflict'});
 }}
 return freezeOwned({overlaps,testedPairs,requiredClearanceM,vehicleWidthM,lateralMarginM,scope:'full straight segment footprints; curve joins and turning swept volumes excluded'});
}

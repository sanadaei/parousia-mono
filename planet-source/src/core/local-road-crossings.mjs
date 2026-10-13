/** Fictional-world timber crossing policy. Water sources must explicitly be
 * modeled river reaches (or bounded lake crossings when enabled).
 * Sea and unknown water never become a free bridge. */
export function fitLocalRiverCrossings(input,{maxSpanM=160,clearanceM=3,maxGrade=.12,maxApproachFillM=15,allowLakeBridges=false}={}){
 if(!Array.isArray(input)||input.length<2)return null;
 const points=input.map(p=>({...p,roadElevationM:p.elevationM+.06})),spans=[];
 for(let i=0;i<points.length;i++){if(!(points[i].waterDepthM>0))continue;const first=i;while(i+1<points.length&&points[i+1].waterDepthM>0)i++;const last=i;
  if(first===0||last===points.length-1)return null;
  for(let k=first;k<=last;k++)if(!points[k].waterSourceIds?.length||points[k].waterSourceIds.some(id=>!id.startsWith('river:')&&!(allowLakeBridges&&id.startsWith('lake:')))||points[k].waterDepthM>15)return null;
  let left=Math.max(0,first-2),right=Math.min(points.length-1,last+2);
  // Dry land can still be a steep incised bank. Put abutments beyond that
  // bank where possible, rather than demanding a tall wedge of road fill.
  while(left>0&&points[left].elevationM<points[left-1].elevationM-maxGrade*(points[left].distanceM-points[left-1].distanceM)&&points[right].distanceM-points[left-1].distanceM<=maxSpanM)left--;
  while(right+1<points.length&&points[right].elevationM<points[right+1].elevationM-maxGrade*(points[right+1].distanceM-points[right].distanceM)&&points[right+1].distanceM-points[left].distanceM<=maxSpanM)right++;
  const a=points[left],b=points[right],length=b.distanceM-a.distanceM;
  if(length>maxSpanM||length<6||a.waterDepthM>0||b.waterDepthM>0)return null;
  const deck=Math.max(...points.slice(left,right+1).map(p=>p.elevationM+1),...points.slice(first,last+1).map(p=>p.waterLevelElevationM+clearanceM));
  for(let k=left;k<=right;k++){points[k].roadElevationM=deck;points[k].structureKind='bridge-deck';points[k].segmentKind=k<right?'bridge-deck':'fill';}
  spans.push({start:{latDeg:a.latDeg,lonDeg:a.lonDeg},end:{latDeg:b.latDeg,lonDeg:b.lonDeg},startDistanceM:a.distanceM,endDistanceM:b.distanceM,deckElevationM:deck,sourceIds:[...new Set(points.slice(first,last+1).flatMap(p=>p.waterSourceIds))]});
 }
 if(!spans.length)return null;
 // A least upper grade envelope builds a bounded embankment through steep
 // incised banks. Following the original bank slope inside a blending ramp
 // could never satisfy the grade limit, even when a short bridge was feasible.
 const smooth=()=>{for(let i=1;i<points.length;i++)points[i].roadElevationM=Math.max(points[i].roadElevationM,points[i-1].roadElevationM-maxGrade*(points[i].distanceM-points[i-1].distanceM));for(let i=points.length-2;i>=0;i--)points[i].roadElevationM=Math.max(points[i].roadElevationM,points[i+1].roadElevationM-maxGrade*(points[i+1].distanceM-points[i].distanceM));};
 for(let pass=0;pass<=spans.length;pass++){smooth();let changed=false;for(const span of spans){const deckPoints=points.filter(p=>p.distanceM>=span.startDistanceM&&p.distanceM<=span.endDistanceM),deck=Math.max(...deckPoints.map(p=>p.roadElevationM));if(deck>span.deckElevationM+1e-8){changed=true;span.deckElevationM=deck;for(const p of deckPoints)p.roadElevationM=deck;}}if(!changed)break;}
 if(points.some(p=>!p.waterDepthM&&p.roadElevationM-p.elevationM>maxApproachFillM)||[points[0],points.at(-1)].some(p=>p.roadElevationM>p.elevationM+.061))return null;
 for(let i=1;i<points.length;i++)if(Math.abs(points[i].roadElevationM-points[i-1].roadElevationM)/(points[i].distanceM-points[i-1].distanceM)>maxGrade+1e-9)return null;
 return{points,bridgeSpans:spans,policy:'bounded-game-timber-crossings@2',earthwork:{method:'bounded-fill-grade-envelope',maxApproachFillM},limitations:['Fictional material and load inputs','Ground bearing, scour and hydraulic obstruction unresolved']};
}

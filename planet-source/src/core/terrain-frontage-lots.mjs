/** Lots grow from surveyed streets; the road establishes orientation and access.
 * Reserved public land is supplied before housing, not carved out afterwards. */
export function planFrontageLots({id,requested,roads,ground,water,occupied=()=>false,reservations=[],frontageSpacingM=18,footprint={lengthM:10,widthM:8,heightM:3.2},setbackM=4,gapM=3,avoidRoads=roads,padClear=()=>true,parcelPolicy=null}){
 if(!Number.isInteger(requested)||requested<0||requested>512||![frontageSpacingM,footprint.lengthM,footprint.widthM,footprint.heightM].every(v=>Number.isFinite(v)&&v>0)||![setbackM,gapM].every(v=>Number.isFinite(v)&&v>=0))throw new RangeError('Invalid frontage allocation');
 const varied=parcelPolicy==='surveyed-household-frontages@2';
 const buildings=[],buildingPads=[],rejected={water:0,grade:0,overlap:0,reserved:0},seen=new Set(),candidates=[];
 const intersects=(a,b,g=1)=>a.minXM<b.maxXM+g&&a.maxXM>b.minXM-g&&a.minYM<b.maxYM+g&&a.maxYM>b.minYM-g;
 // Segment distances provide stable frontage spacing, not a camera grid.
 if(varied){
  // Each side is a sequence of household frontages, not two mirrored rows of
  // identical boxes. Width/depth/setback are an explicit dwelling scenario.
  // A stable road identity and slot choose each parcel; camera/LOD never do.
  const rand=key=>{let h=2166136261;for(const c of key)h=Math.imul(h^c.charCodeAt(0),16777619);h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return((h^(h>>>16))>>>0)/4294967296;};
  for(const road of roads)for(const side of [-1,1]){const total=road.samples.at(-1)?.distanceM??0;let start=8+10*rand(id+road.roadId+side+'/start');
   for(let slot=0;slot<512&&start<total-12;slot++){const key=id+'/'+road.roadId+'/'+side+'/'+slot,frontageM=15+5*rand(key+'/frontage'),next=start+frontageM/2;start+=frontageM;if(next>total-8)break;
    const i=road.samples.findIndex((p,j)=>j>0&&p.distanceM>=next);if(i<1)continue;const a=road.samples[i-1],b=road.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,d=Math.hypot(dx,dy);if(!d||b.distanceM<=a.distanceM)continue;
    const t=(next-a.distanceM)/(b.distanceM-a.distanceM),x=a.xM+dx*t,y=a.yM+dy*t,lengthM=8+4*rand(key+'/length'),widthM=6+2.5*rand(key+'/depth'),setback=4+2*rand(key+'/setback'),offset=road.halfWidthM+widthM/2+setback;
    candidates.push({cx:x-side*dy/d*offset,cy:y+side*dx/d*offset,heading:Math.atan2(dy,dx),roadId:road.roadId,distance:next,access:{xM:x,yM:y},lengthM,widthM,parcel:{frontageM,setbackM:setback,side,slot,policy:parcelPolicy}});
   }
  }
 }else for(const road of roads){let next=15;for(let i=1;i<road.samples.length;i++){const a=road.samples[i-1],b=road.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,length=Math.hypot(dx,dy);if(!length)continue;while(next<=b.distanceM){if(next>=a.distanceM){const t=(next-a.distanceM)/(b.distanceM-a.distanceM),x=a.xM+dx*t,y=a.yM+dy*t;for(const side of [-1,1]){const offset=road.halfWidthM+footprint.widthM/2+setbackM,cx=x-side*dy/length*offset,cy=y+side*dx/length*offset,key=`${Math.round(cx)}:${Math.round(cy)}`;if(!seen.has(key)){seen.add(key);candidates.push({cx,cy,heading:Math.atan2(dy,dx),roadId:road.roadId,distance:next,access:{xM:x,yM:y}});}}}next+=frontageSpacingM;}}
 }
 // Central access first; exact ties have stable structural order.
 candidates.sort((a,b)=>Math.hypot(a.cx,a.cy)-Math.hypot(b.cx,b.cy)||a.roadId.localeCompare(b.roadId)||a.distance-b.distance||a.cx-b.cx||a.cy-b.cy);
 for(const c of candidates){if(buildings.length>=requested)break;const co=Math.cos(c.heading),si=Math.sin(c.heading),lengthM=c.lengthM??footprint.lengthM,widthM=c.widthM??footprint.widthM,corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y])=>[c.cx+x*lengthM/2*co-y*widthM/2*si,c.cy+x*lengthM/2*si+y*widthM/2*co]),bounds={minXM:Math.min(...corners.map(p=>p[0])),maxXM:Math.max(...corners.map(p=>p[0])),minYM:Math.min(...corners.map(p=>p[1])),maxYM:Math.max(...corners.map(p=>p[1]))};
  if(bounds.minXM< -190||bounds.maxXM>190||bounds.minYM< -220||bounds.maxYM>220||reservations.some(r=>intersects(bounds,r))||corners.some(([x,y])=>occupied(x,y))){rejected.reserved++;continue;}
  if(buildings.some(b=>intersects(bounds,b.bounds,gapM))){rejected.overlap++;continue;}
  const levels=corners.map(([x,y])=>ground(x,y));
  if(varied){let safe=true;const nx=Math.ceil(lengthM/3),ny=Math.ceil(widthM/3);for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){const u=-lengthM/2+lengthM*i/nx,v=-widthM/2+widthM*j/ny,x=c.cx+u*co-v*si,y=c.cy+u*si+v*co,z=ground(x,y);levels.push(z);if(!Number.isFinite(z)||water(x,y).waterDepthM!==0||occupied(x,y))safe=false;}if(!safe){rejected.water++;continue;}}
  if(Math.max(...levels)-Math.min(...levels)>.8){rejected.grade++;continue;}
  if(corners.some(([x,y])=>water(x,y).waterDepthM>0)){rejected.water++;continue;}
  // Do not place a house across another street or a tight bend in its own.
  if(avoidRoads.some(r=>r.samples.slice(1).some((b,i)=>segmentHitsOrientedLot(r.samples[i],b,c,lengthM,widthM,r.halfWidthM+1)))){rejected.overlap++;continue;}
  const houseId=`${id}/house:${buildings.length}`,baseElevationM=Math.max(...levels)+.1;
  if(!padClear({bounds,targetPadElevationM:baseElevationM})){rejected.overlap++;continue;}
  buildings.push({id:houseId,bounds,orientation:{headingRad:c.heading,lengthM,widthM},baseElevationM,heightM:footprint.heightM,roofHeightM:1.8,wallColor:[.72,.67,.54],roofColor:[.40,.22,.13],frontage:{roadId:c.roadId,distanceM:c.distance,access:c.access,...(c.parcel?{parcel:c.parcel}:{})}});buildingPads.push({id:houseId,bounds:{...bounds},targetPadElevationM:baseElevationM});
 }
 return{buildings,buildingPads,requested,placed:buildings.length,unplaced:requested-buildings.length,rejected,method:varied?'surveyed-household-frontages@2':'terrain-frontage-lots@1'};
}

function segmentHitsOrientedLot(a,b,c,length,width,margin){const co=Math.cos(c.heading),si=Math.sin(c.heading),local=p=>[co*(p.xM-c.cx)+si*(p.yM-c.cy),-si*(p.xM-c.cx)+co*(p.yM-c.cy)],p=local(a),q=local(b);let lo=0,hi=1;for(let axis=0;axis<2;axis++){const half=(axis?width:length)/2+margin,d=q[axis]-p[axis];if(Math.abs(d)<1e-10){if(Math.abs(p[axis])>half)return false;continue;}const t0=(-half-p[axis])/d,t1=(half-p[axis])/d;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(lo>hi)return false;}return true;}

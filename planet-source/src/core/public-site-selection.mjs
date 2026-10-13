import {nearestStreetPoint} from './service-frontage.mjs';
import {planPublicAccess} from './public-access.mjs';
export const PUBLIC_SITE_POLICY='surveyed-street-public-sites@1';
const box=(x,y,hx,hy)=>({minXM:x-hx,maxXM:x+hx,minYM:y-hy,maxYM:y+hy});
const overlaps=(a,b)=>a.minXM<b.maxXM&&a.maxXM>b.minXM&&a.minYM<b.maxYM&&a.maxYM>b.minYM;
/** Bounded civic siting. A sloping churchyard need not be a level building pad.
 * Candidates follow actual streets; no camera coordinates or cosmetic jitter.
 * All accepted sites have an independently surveyed pedestrian approach. */
export function selectPublicChurchSite({id,roads,center,ground,water,occupied=()=>false,reservations=[],maxCandidates=48,avoidFoundationBatters=false,siteProfile='village',siteAllowed=()=>true}){
 if(!['village','civic-yard','compact-civic-yard'].includes(siteProfile))throw new TypeError('Unknown public site profile');
 const urban=siteProfile!=='village',compact=siteProfile==='compact-civic-yard',setback=compact?16:urban?20:34,yardHalfWidth=compact?10:urban?14:19,yardHalfLength=compact?8:urban?16:25;
 if(!Number.isSafeInteger(maxCandidates)||maxCandidates<1||maxCandidates>96)throw new RangeError('Invalid public site survey budget');
 const rejected={reserved:0,wet:0,grade:0,foundation:0,access:0},candidates=[],seen=new Set();
 if(!center)return{method:PUBLIC_SITE_POLICY,site:null,surveyed:0,rejected,reason:'no-street-center'};
 for(const road of roads)for(let i=1;i<road.samples.length;i++){
  const a=road.samples[i-1],b=road.samples[i],dx=b.xM-a.xM,dy=b.yM-a.yM,d=Math.hypot(dx,dy);if(d<.001)continue;
  for(let at=Math.ceil(a.distanceM/30)*30;at<=b.distanceM;at+=30){const t=(at-a.distanceM)/(b.distanceM-a.distanceM);for(const side of [-1,1]){
   const x=a.xM+t*dx-side*dy/d*setback,y=a.yM+t*dy+side*dx/d*setback,key=`${Math.round(x)},${Math.round(y)}`;
   if(Math.abs(x)>165||Math.abs(y)>195||seen.has(key))continue;seen.add(key);candidates.push({x,y,distance:Math.hypot(x-center.xM,y-center.yM)});
  }}
 }
 candidates.sort((a,b)=>a.distance-b.distance||a.x-b.x||a.y-b.y);let chosen=null,surveyed=0;
 for(const c of candidates.slice(0,maxCandidates)){
  if(chosen&&c.distance>=chosen.score)break; // Remaining nonnegative scores cannot win.
  surveyed++;const near=nearestStreetPoint(c.x,c.y,roads),acrossX=Math.abs(near.xM-c.x)>Math.abs(near.yM-c.y),yard=box(c.x,c.y,acrossX?yardHalfLength:yardHalfWidth,acrossX?yardHalfWidth:yardHalfLength);
  let bounds=box(c.x,c.y,acrossX?12:6,acrossX?6:12);
  if(reservations.some(r=>overlaps(yard,r))){rejected.reserved++;continue;}
  let levels=[],relief=Infinity;
  // Civic sites may use a smaller chapel or turn the nave to fit the slope;
  // never raise the foundation-relief limit merely to force a placement.
  if(!urban){for(let y=bounds.minYM;y<=bounds.maxYM;y+=3)for(let x=bounds.minXM;x<=bounds.maxXM;x+=3)levels.push(ground(x,y));relief=Math.max(...levels)-Math.min(...levels);}
  else for(const [hx,hy]of [[12,6],[6,12],[9,5],[5,9],[7,4],[4,7]]){if(2*hx+2>yard.maxXM-yard.minXM||2*hy+2>yard.maxYM-yard.minYM)continue;bounds=box(c.x,c.y,hx,hy);levels=[];const sx=Math.ceil(2*hx/3),sy=Math.ceil(2*hy/3);for(let j=0;j<=sy;j++)for(let i=0;i<=sx;i++)levels.push(ground(bounds.minXM+2*hx*i/sx,bounds.minYM+2*hy*j/sy));relief=Math.max(...levels)-Math.min(...levels);if(levels.every(Number.isFinite)&&relief<=1.2)break;}
  if(!levels.every(Number.isFinite)||relief>1.2){rejected.foundation++;continue;}
  let failure=null;const nx=Math.ceil((yard.maxXM-yard.minXM)/4),ny=Math.ceil((yard.maxYM-yard.minYM)/4),values=[];
  for(let j=0;j<=ny&&!failure;j++)for(let i=0;i<=nx;i++){
   const x=yard.minXM+(yard.maxXM-yard.minXM)*i/nx,y=yard.minYM+(yard.maxYM-yard.minYM)*j/ny,z=ground(x,y),street=nearestStreetPoint(x,y,roads);
   if(!siteAllowed(x,y)||occupied(x,y)||street&&street.distanceM<street.halfWidthM+1){failure='reserved';break;}
   if(water(x,y).waterDepthM!==0||!Number.isFinite(z)){failure='wet';break;}
   if(i&&Math.abs(z-values.at(-1))/((yard.maxXM-yard.minXM)/nx)>.18||j&&Math.abs(z-values[(j-1)*(nx+1)+i])/((yard.maxYM-yard.minYM)/ny)>.18){failure='grade';break;}values.push(z);
  }
  if(failure){rejected[failure]++;continue;}
  const z=Math.max(...levels)+.1,chapelId=id+'/chapel',building={id:chapelId,facilityType:'chapel',sector:3,bounds,baseElevationM:z,heightM:6,roofHeightM:4,wallColor:[.68,.66,.57],roofColor:[.35,.24,.18]},tower={...building,id:chapelId+'/tower',facilityType:'chapel_tower',bounds:{minXM:bounds.minXM,maxXM:bounds.minXM+5,minYM:bounds.minYM,maxYM:bounds.minYM+5},heightM:12,roofHeightM:3},access=planPublicAccess({roads,buildings:[building,tower],ground,water,occupied,avoidFoundationBatters});
  if(access.access[0]?.status!=='connected'){rejected.access++;continue;}
  const score=c.distance+relief*45+access.access[0].lengthM*.5;
  if(!chosen||score<chosen.score)chosen={score,yard,buildings:[building,tower],foundationReliefM:relief,access:access.access[0],reason:'Dry street-front yard, bounded foundation earthwork, surveyed pedestrian access, proximity to civic center'};
 }
 return{method:PUBLIC_SITE_POLICY,...(urban?{siteProfile}:{}),site:chosen,surveyed,rejected,reason:chosen?null:'no-feasible-public-site-within-budget'};
}

/** A village green follows its real terrain; it is not a level building pad.
 * Bounded sizes shrink only when water, reservations or excessive grade prevent
 * a larger shared space. No excavation, paving or food capacity is invented. */
export function selectSlopingVillageGreen({center,ground,water,occupied=()=>false}){
 if(!center)return null;
 for(const [width,height]of[[40,32],[32,24],[24,20]]){
  const bounds=box(center.xM,center.yM,width/2,height/2),nx=Math.ceil(width/4),ny=Math.ceil(height/4),values=[];let valid=true,maximumGrade=0;
  for(let j=0;j<=ny&&valid;j++)for(let i=0;i<=nx;i++){
   const x=bounds.minXM+width*i/nx,y=bounds.minYM+height*j/ny,z=ground(x,y),w=water(x,y);
   if(!Number.isFinite(z)||w.waterDepthM!==0||occupied(x,y)){valid=false;break;}
   const east=i?(z-values.at(-1))/(width/nx):0,north=j?(z-values[(j-1)*(nx+1)+i])/(height/ny):0,grade=Math.hypot(east,north);maximumGrade=Math.max(maximumGrade,grade);
   if(grade>.12){valid=false;break;}values.push(z);
  }
  if(valid)return{bounds,survey:{method:'surveyed-sloping-commons@1',samples:values.length,maximumGrade,reliefM:Math.max(...values)-Math.min(...values),surface:'existing-ground',limitations:'Finite4m survey; no grading, drainage capacity, paving or guaranteed universal accessibility'}};
 }
 return null;
}

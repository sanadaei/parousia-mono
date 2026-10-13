import {refineStreetLattice} from './street-lattice-refinement.mjs';
import {validateVillagePortals} from './village-portals.mjs';
/** Terrain-led local street skeleton. All decisions use fixed world coordinates,
 * never camera tiles. Boundary gates remain explicit inter-quarter contracts.
 * This is a bounded planning lattice, not the resulting street geometry. */
export function planTerrainLedStreets({ground,water,occupied=()=>false,districtIndex=0,maxGrade=.18,branchFromNetwork=false,gateNames=null,residentialCatchments=false,gatePoints=null,refineLattice=false}){
 if(typeof refineLattice!=='boolean'||refineLattice&&!branchFromNetwork)throw new RangeError('Street refinement requires network-led branches');
 if(typeof residentialCatchments!=='boolean'||residentialCatchments&&!branchFromNetwork)throw new RangeError('Residential catchments require network-led branches');
 if(gateNames!==null&&(!Array.isArray(gateNames)||!gateNames.length||gateNames.some(n=>!['west','east','south','north'].includes(n))))throw new RangeError('Invalid street gates');
 if(gatePoints){validateVillagePortals(gatePoints);if(!gateNames||gatePoints.length!==gateNames.length||gatePoints.some(p=>!gateNames.includes(p.name)))throw new RangeError('Village portals must match saved gate names');}
 const step=10,w=41,h=47,n=w*h,position=i=>({xM:(i%w-20)*step,yM:(Math.floor(i/w)-23)*step}),cell=(x,y)=>Math.round(y/step+23)*w+Math.round(x/step+20),z=new Float64Array(n),dry=new Uint8Array(n);
 for(let i=0;i<n;i++){const p=position(i),s=water(p.xM,p.yM);z[i]=ground(p.xM,p.yM);dry[i]=Number.isFinite(z[i])&&s.waterDepthM===0&&!occupied(p.xM,p.yM)?1:0;}
 const edgeSurvey=new Map();
 const safeEdge=(i,j,d)=>{if(!branchFromNetwork)return true;const key=Math.min(i,j)*n+Math.max(i,j);if(edgeSurvey.has(key))return edgeSurvey.get(key);const a=position(i),b=position(j),dx=(b.xM-a.xM)/d,dy=(b.yM-a.yM)/d,steps=Math.ceil(d);let valid=true;for(const side of [-3,0,3]){let last=null;for(let k=0;k<=steps;k++){const t=k/steps,x=a.xM+(b.xM-a.xM)*t-dy*side,y=a.yM+(b.yM-a.yM)*t+dx*side,zz=ground(x,y);if(!Number.isFinite(zz)||water(x,y).waterDepthM>0||occupied(x,y)||(last!=null&&Math.abs(zz-last)/(d/steps)>maxGrade)){valid=false;break;}last=zz;}if(!valid)break;}edgeSurvey.set(key,valid);return valid;};
 const neighbors=i=>{const x=i%w,y=Math.floor(i/w),r=[];for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){if(!dx&&!dy||x+dx<0||x+dx>=w||y+dy<0||y+dy>=h)continue;const j=i+dy*w+dx;if(!dry[j]||dx&&dy&&(!dry[i+dx]||!dry[i+dy*w]))continue;const d=step*Math.hypot(dx,dy),g=Math.abs(z[i]-z[j])/d;if(g<=maxGrade&&edgeSurvey.get(Math.min(i,j)*n+Math.max(i,j))!==false)r.push([j,d,g]);}return r;};
 let center=-1,best=Infinity;
 for(let i=0;i<n;i++){const p=position(i);if(!dry[i]||Math.abs(p.xM)>60||Math.abs(p.yM)>60)continue;const around=neighbors(i);if(around.length<8)continue;const score=Math.hypot(p.xM,p.yM)+around.reduce((s,[j])=>s+Math.abs(z[i]-z[j])*12,0);if(score<best){best=score;center=i;}}
 if(center<0)return{method:'terrain-led-streets@1',roads:[],center:null,connections:[],reason:'no-dry-accessible-center'};
 const used=new Set([center]),roads=[],connections=[],targets=[['west',-200,0],['east',200,0],['south',0,-230],['north',0,230],['north-west',-120,160],['north-east',120,160],['south-west',-120,-160],['south-east',120,-160],['west-north-lane',-170,90],['west-south-lane',-170,-90],['east-north-lane',170,90],['east-south-lane',170,-90]];
 if(gatePoints)for(const p of gatePoints){const t=targets.find(t=>t[0]===p.name);t[1]=p.xM;t[2]=p.yM;}
 const legacyTargets=gateNames?[...targets.slice(0,4).filter(t=>gateNames.includes(t[0])),...targets.slice(4,8).filter(t=>dry[cell(t[1],t[2])]).sort((a,b)=>Math.abs(z[cell(a[1],a[2])]-z[center])-Math.abs(z[cell(b[1],b[2])]-z[center])||a[0].localeCompare(b[0])).slice(0,Math.max(2,4-gateNames.length))]:branchFromNetwork?targets.slice(0,8):targets;
 const residentialTargets=[];
 const selectResidentialTargets=()=>{
  const candidates=[];
  for(let i=0;i<n;i++){const p=position(i),radial=Math.hypot(p.xM,p.yM);if(!dry[i]||p.xM%30||p.yM%30||radial<75||radial>190)continue;
   const patch=[];let complete=true;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=i+dy*w+dx;if(q<0||q>=n||!dry[q])complete=false;else patch.push(z[q]);}if(!complete)continue;
   const relief=Math.max(...patch)-Math.min(...patch);if(relief>2.4)continue;
   const distanceToStreetM=Math.min(...[...used].map(q=>{const a=position(q);return Math.hypot(a.xM-p.xM,a.yM-p.yM);}));if(distanceToStreetM<50)continue;
   candidates.push({i,...p,reliefM:relief,distanceToStreetM,score:relief*10+Math.abs(distanceToStreetM-90)*.1});
  }
  // Select separate dry building catchments. No arbitrary bends are added to
  // roads: the existing grade/water-aware routing still determines each path.
  const count=gateNames?Math.max(2,4-gateNames.length):4;
  while(residentialTargets.length<count&&candidates.length){candidates.sort((a,b)=>a.score-b.score||a.i-b.i);const c=candidates.shift();if(residentialTargets.some(t=>Math.hypot(c.xM-t.xM,c.yM-t.yM)<90))continue;residentialTargets.push(c);}
  return residentialTargets.map(c=>[`residential:${c.i}`,c.xM,c.yM]);
 };
 const activeTargets=residentialCatchments&&branchFromNetwork?(function*(){yield*targets.slice(0,4).filter(t=>!gateNames||gateNames.includes(t[0]));yield*selectResidentialTargets();})():legacyTargets;
 for(const [name,x,y]of activeTargets){const target=cell(x,y);if(!dry[target]){connections.push({gate:name,status:'blocked-water-or-reservation'});continue;}
  let indices=null;
  for(let attempt=0;attempt<(branchFromNetwork?16:1);attempt++){
  const distance=new Float64Array(n).fill(Infinity),previous=new Int32Array(n).fill(-1),closed=new Uint8Array(n),queue=[];
  const push=v=>{let i=queue.length;queue.push(v);while(i){const p=(i-1)>>1;if(queue[p][0]<v[0]||queue[p][0]===v[0]&&queue[p][1]<=v[1])break;queue[i]=queue[p];i=p;}queue[i]=v;};
  const pop=()=>{const first=queue[0],last=queue.pop();if(queue.length){let i=0;while(i*2+1<queue.length){let j=i*2+1;if(j+1<queue.length&&(queue[j+1][0]<queue[j][0]||queue[j+1][0]===queue[j][0]&&queue[j+1][1]<queue[j][1]))j++;if(queue[j][0]>last[0]||queue[j][0]===last[0]&&queue[j][1]>=last[1])break;queue[i]=queue[j];i=j;}queue[i]=last;}return first;};
  if(branchFromNetwork){for(const i of [...used].sort((a,b)=>a-b)){distance[i]=0;push([0,i]);}}else{distance[center]=0;push([0,center]);}
  while(queue.length){const [cost,i]=pop();if(closed[i]||cost!==distance[i])continue;closed[i]=1;if(i===target)break;for(const [j,d,g]of neighbors(i)){// Following an existing road is cheaper than a second parallel route.
    const next=cost+d*(1+g*g*180)*(used.has(j)?.55:1);if(next<distance[j]){distance[j]=next;previous[j]=i;push([next,j]);}}
  }
  if(!Number.isFinite(distance[target]))break;
  const candidate=[];for(let i=target;i>=0;i=previous[i]){candidate.push(i);if(branchFromNetwork?previous[i]<0:i===center)break;}candidate.reverse();let safe=true;for(let k=1;k<candidate.length;k++){const a=position(candidate[k-1]),b=position(candidate[k]);if(!safeEdge(candidate[k-1],candidate[k],Math.hypot(b.xM-a.xM,b.yM-a.yM)))safe=false;}if(safe){indices=candidate;break;}
  }
  if(!indices){connections.push({gate:name,status:branchFromNetwork?'blocked-grade-water-or-survey-budget':'blocked-grade-or-water'});continue;}
  if(indices.length===1){connections.push({gate:name,status:'connected',lengthM:0});continue;}let length=0;
  const samples=indices.map((i,k)=>{const p=position(i);if(k){const q=position(indices[k-1]);length+=Math.hypot(p.xM-q.xM,p.yM-q.yM);}used.add(i);return{...p,distanceM:length,roadElevationM:z[i]+.06,structureKind:'fill',segmentKind:'fill'};});
  roads.push({surfaceMaterial:'compacted-earth',roadId:`terrain-street:${districtIndex}:${name}`,halfWidthM:['west','east','south','north'].includes(name)?3:2,samples});connections.push({gate:name,status:'connected',lengthM:length});
 }
 const refinement=refineLattice?refineStreetLattice(roads,{ground,safeSegment:(a,b)=>safeEdge(cell(a.xM,a.yM),cell(b.xM,b.yM),Math.hypot(b.xM-a.xM,b.yM-a.yM))}):null;
 if(refinement){roads.splice(0,roads.length,...refinement.roads);for(const c of connections){const r=roads.find(r=>r.roadId===`terrain-street:${districtIndex}:${c.gate}`);if(r)c.lengthM=r.samples.at(-1).distanceM;}}
 return{...(refinement?{refinement:{policy:refinement.policy,shortcuts:refinement.shortcuts}}:{}),method:gateNames?'network-led-village-streets@1':branchFromNetwork?'terrain-led-branches@2':'terrain-led-streets@1',roads,center:position(center),connections,...(residentialCatchments?{residentialBranches:{method:'surveyed-residential-catchments@1',targets:residentialTargets,scope:'Dry low-relief frontage candidates; actual house plots still require their own survey'}}:{}),reason:null};
}

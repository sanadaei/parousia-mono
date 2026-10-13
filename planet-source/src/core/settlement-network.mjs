import {greatCircle} from './spherical.mjs';
/** Coarse planning only. No climate/soil inference and no constructed-road claim. */
export const SETTLEMENT_NETWORK_SCHEMA='settlement-network@1';
class Heap{constructor(){this.a=[];}push(v){const a=this.a;let i=a.length;a.push(v);while(i){const p=(i-1)>>1;if(a[p][0]<=v[0])break;a[i]=a[p];i=p;}a[i]=v;}pop(){const a=this.a,v=a[0],last=a.pop();if(a.length){let i=0;while(i*2+1<a.length){let j=i*2+1;if(j+1<a.length&&a[j+1][0]<a[j][0])j++;if(a[j][0]>=last[0])break;a[i]=a[j];i=j;}a[i]=last;}return v;}}
export function planSettlementNetwork(snapshot,{count=128,minSpacingM=80000,maxGrade=.12,neighborsPerSite=3,anchors=[],population=null}={}){
 const {columns:w,rows:h}=snapshot.grid,n=w*h,radius=snapshot.frame.radiusM,z=snapshot.fields.groundElevationM,sea=snapshot.references.sea?.levelElevationM??0;
 if(!Number.isSafeInteger(count)||count<0||count>512||n>32768||!Number.isFinite(minSpacingM)||minSpacingM<1000||!Number.isFinite(maxGrade)||maxGrade<=0||maxGrade>1||!Number.isSafeInteger(neighborsPerSite)||neighborsPerSite<1||neighborsPerSite>6)throw new RangeError('Invalid settlement planning budget');
 const point=i=>({latDeg:90-(Math.floor(i/w)+.5)*180/h,lonDeg:(i%w+.5)*360/w});
 const points=Array.from({length:n},(_,i)=>point(i));
 const adjacent=i=>{const x=i%w,y=Math.floor(i/w),a=[y*w+(x+w-1)%w,y*w+(x+1)%w];if(y>0)a.push(i-w);if(y<h-1)a.push(i+w);return a;};
 const wet=Array.from({length:n},(_,i)=>!snapshot.fields.landMask[i]|| (snapshot.fields.lakeFillDepthM?.[i]??0)>0);
 const fresh=new Set((snapshot.references.lakes??[]).flatMap(l=>l.cells));
 for(const p of snapshot.references.rivers?.profiles??[])for(const q of p.points){const y=Math.max(0,Math.min(h-1,Math.floor((90-q.latDeg)/180*h))),x=((Math.floor(q.lonDeg/360*w)%w)+w)%w;fresh.add(y*w+x);}
 const distances=points.map((p,i)=>adjacent(i).map(j=>[j,greatCircle(p,points[j],radius).distanceM]));
 const waterDistance=Array(n).fill(Infinity),heap=new Heap();for(const i of fresh){waterDistance[i]=0;heap.push([0,i]);}
 while(heap.a.length){const [d,i]=heap.pop();if(d!==waterDistance[i])continue;for(const[j,m]of distances[i]){const nd=d+m;if(nd<waterDistance[j]){waterDistance[j]=nd;heap.push([nd,j]);}}}
 const grade=z.map((v,i)=>Math.max(...distances[i].map(([j,m])=>Math.abs(z[j]-v)/Math.max(1,m))));
 if(population&&(population.sourceWorldId!==snapshot.worldId||population.cells.length!==n))throw new Error("Population geography mismatch");
 const score=z.map((v,i)=>{if(wet[i])return 0;const relief=Math.max(0,1-grade[i]/.08),elevation=Math.max(0,1-Math.max(0,v-sea)/4000),water=Number.isFinite(waterDistance[i])?Math.exp(-waterDistance[i]/100000):0;return Math.round(100*(.45*relief+.30*elevation+.25*water)*(population?population.cells[i].suitability:1));});
 if(!Array.isArray(anchors)||anchors.length>32||anchors.some(p=>typeof p.id!=='string'||![p.latDeg,p.lonDeg].every(Number.isFinite)))throw new TypeError('Invalid detailed-settlement anchors');
 const candidates=Array.from({length:n},(_,i)=>i).filter(i=>(!population||population.cells[i].population>0)&&score[i]>=35&&Math.abs(points[i].latDeg)<=65&&!wet[i]&&grade[i]<=maxGrade).sort((a,b)=>score[b]-score[a]||a-b),sites=anchors.map(p=>{const y=Math.max(0,Math.min(h-1,Math.floor((90-p.latDeg)/180*h))),x=((Math.floor(p.lonDeg/360*w)%w)+w)%w,i=y*w+x;return{id:p.id,name:p.name,latDeg:p.latDeg,lonDeg:p.lonDeg,cellIndex:i,score:score[i],status:'generated-settlement',buildings:p.buildings,elevationM:z[i],waterDistanceM:Number.isFinite(waterDistance[i])?waterDistance[i]:null};});
 for(const i of candidates){if(sites.length>=count)break;if(sites.some(s=>s.cellIndex===i||greatCircle(points[i],s,radius).distanceM<minSpacingM))continue;sites.push({id:`macro-settlement:${i}`,name:`集落候補 ${sites.length+1}`,...points[i],cellIndex:i,score:score[i],status:'planned-location',buildings:null,elevationM:z[i],waterDistanceM:Number.isFinite(waterDistance[i])?waterDistance[i]:null});}
 const pairs=new Set();for(let a=0;a<sites.length;a++){const nearest=sites.map((s,b)=>({b,d:b===a?Infinity:greatCircle(sites[a],s,radius).distanceM})).sort((x,y)=>x.d-y.d||x.b-y.b).slice(0,neighborsPerSite);for(const{b,d}of nearest)if(Number.isFinite(d))pairs.add([Math.min(a,b),Math.max(a,b)].join(':'));}
 const routes=[],unconnected=[];
 for(let a=0;a<sites.length;a++){
  const targets=[...pairs].map(p=>p.split(':').map(Number)).filter(p=>p[0]===a).map(p=>p[1]);if(!targets.length)continue;
  const remaining=new Set(targets.map(b=>sites[b].cellIndex)),cost=Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),q=new Heap(),start=sites[a].cellIndex;cost[start]=0;q.push([0,start]);
  while(q.a.length&&remaining.size){const[d,i]=q.pop();if(d!==cost[i])continue;remaining.delete(i);for(const[j,m]of distances[i]){if(wet[j]||wet[i])continue;const g=Math.abs(z[j]-z[i])/Math.max(1,m);if(g>maxGrade)continue;const edge=m*(1+8*g+Math.max(0,(z[i]+z[j])/2-sea)/4000),next=d+edge;if(next<cost[j]){cost[j]=next;prev[j]=i;q.push([next,j]);}}}
  for(const b of targets){const end=sites[b].cellIndex;if(!Number.isFinite(cost[end])){unconnected.push({from:sites[a].id,to:sites[b].id,reason:'no-dry-grid-path-within-grade-limit'});continue;}
   const cells=[];for(let i=end;i>=0;i=prev[i]){cells.push(i);if(i===start)break;}cells.reverse();let lengthM=0;for(let k=1;k<cells.length;k++)lengthM+=greatCircle(points[cells[k-1]],points[cells[k]],radius).distanceM;
   routes.push({id:`route:${sites[a].cellIndex}:${sites[b].cellIndex}`,from:sites[a].id,to:sites[b].id,status:'coarse-proposed-corridor',cells,points:cells.map((i,k)=>({...points[i],...(k===0?{latDeg:sites[a].latDeg,lonDeg:sites[a].lonDeg}:k===cells.length-1?{latDeg:sites[b].latDeg,lonDeg:sites[b].lonDeg}:{}),elevationM:z[i]})),lengthM,costM:cost[end],requiresLocalSurvey:true});
  }
 }
 return{schema:SETTLEMENT_NETWORK_SCHEMA,method:population?'climate-food-terrain-screening@1':'terrain-water-screening@1',grid:{columns:w,rows:h},settings:{count,minSpacingM,maxGrade,neighborsPerSite},score,macroSlope:grade,waterDistanceM:waterDistance.map(v=>Number.isFinite(v)?v:null),wetMask:wet.map(Number),sites,routes,unconnected,
  populationId:population?.id??null, coverage:{used:['source-grid-elevation','neighbor-grade','ocean-and-lake-mask','distance-to-modeled-river-or-lake','candidate-latitude-limit-65deg',...(population?['monthly-temperature','growing-season-rainfall','rain-fed-cereal-capacity']:[])],missing:[...(population?[]:['temperature','precipitation']),'measured-soil-fertility','calibrated-food-yield','potable-water-confirmation','resources','politics','local-flood-risk'],scale:'source-grid; not metre-scale siting'},
  limitations:['Routes are possible coarse land corridors, not constructed traversable roads.','Cell edges may cross unresolved water or steep local relief; local surveys and bridge design remain necessary.','Islands remain disconnected; ferry routes are not invented.','Suitability weights are explicit game heuristics, not calibrated human habitability.','Planned sites have no buildings until separately materialized.']};
}

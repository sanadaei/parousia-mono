import {resolveRoadEndpoint} from './road-endpoints.mjs';
import {fitLocalRiverCrossings} from './local-road-crossings.mjs';
import {buildBridgeStructure} from './bridge-structures.mjs';
import {WATER_SCHEMA} from './water-model.mjs';
import {createSphericalProjection,greatCircle} from './spherical.mjs';
class Heap{constructor(){this.a=[];}push(v){let i=this.a.length;this.a.push(v);while(i){const p=(i-1)>>1;if(this.a[p][0]<=v[0])break;this.a[i]=this.a[p];i=p;}this.a[i]=v;}pop(){const v=this.a[0],last=this.a.pop();if(this.a.length){let i=0;while(2*i+1<this.a.length){let c=2*i+1;if(c+1<this.a.length&&this.a[c+1][0]<this.a[c][0])c++;if(this.a[c][0]>=last[0])break;this.a[i]=this.a[c];i=c;}this.a[i]=last;}return v;}}
/** Fixed-resolution terrain routing, independent of camera/LOD. Water and
 * excessive grades are barriers. Resolution and survey gaps are reported. */
export function* iterateLocalRoadRoute(base,link,{cells=65,maxGrade=.12,marginM=500,maxDistanceM=60000,probeSpacingM=20,allowRiverBridges=false,extendedDirections=false,environmentCostAt=null,wideWaterReferral=false}={}){
 if(!Number.isInteger(cells)||cells<9||cells>129||!Number.isFinite(maxGrade)||maxGrade<=0||maxGrade>1||!Number.isFinite(probeSpacingM)||probeSpacingM<5||!Number.isFinite(marginM)||marginM<100)throw new RangeError('Invalid local road survey budget');
 if(environmentCostAt!==null&&typeof environmentCostAt!=='function')throw new TypeError('Invalid environment cost sampler');
 const environmentCost=(point,surface)=>{const cost=environmentCostAt?environmentCostAt(point,surface):1;if(!Number.isFinite(cost)||cost<1||cost>100)throw new RangeError('Invalid local environment resistance');return cost;};
 link={...link,fromPoint:resolveRoadEndpoint(base,link.fromPoint,link.toPoint),toPoint:resolveRoadEndpoint(base,link.toPoint,link.fromPoint)};
 const distance=greatCircle(link.fromPoint,link.toPoint,base.frame.radiusM).distanceM;
 if(distance>maxDistanceM)return{...link,status:'requires-regional-corridor',points:[],reason:'distance-exceeds-local-survey-budget'};
 if(distance<.01)return{...link,status:'coincident-endpoints',points:[]};
 const projection=createSphericalProjection({centerLatDeg:link.fromPoint.latDeg,centerLonDeg:link.fromPoint.lonDeg,radiusM:base.frame.radiusM,maxRadiusM:Math.min(base.frame.radiusM*.1,distance+marginM*3)}),end=projection.toLocal(link.toPoint.latDeg,link.toPoint.lonDeg);
 // The common open-country case needs a linear survey, not a grid search.
 const direct=[],directSteps=Math.max(1,Math.ceil(distance/probeSpacingM));let directValid=true,previous=null,directCheap=true;
 for(let k=0;k<=directSteps;k++){const t=k/directSteps,p=projection.toGeographic(end.xM*t,end.yM*t),surface=base.sampleSurfaceAt(p.latDeg,p.lonDeg),grade=previous?Math.abs(surface.groundElevationM-previous.elevationM)/(distance/directSteps):0;
  if(surface.waterDepthM>0||surface.landReserved||grade>maxGrade){directValid=false;break;}directCheap&&=environmentCost(p,surface)<=1.001;const q={...p,elevationM:surface.groundElevationM,distanceM:distance*t};direct.push(q);previous=q;if(k&&k%128===0)yield{phase:'direct-survey',probes:k};}
 if(directValid&&directCheap)return{...link,status:'surveyed-local-route',points:direct,lengthM:distance,probes:direct.length,survey:{method:'direct-ground-survey',maxGrade,probeSpacingM,limitations:['Sub-probe obstacles unresolved','No bridges or drainage construction']}};
 if(allowRiverBridges&&!environmentCostAt){const crossingSamples=[],steps=Math.max(1,Math.ceil(distance/5));
  for(let k=0;k<=steps;k++){const t=k/steps,p=projection.toGeographic(end.xM*t,end.yM*t),surface=base.sampleSurfaceAt(p.latDeg,p.lonDeg);crossingSamples.push({...p,elevationM:surface.groundElevationM,distanceM:distance*t,waterDepthM:surface.waterDepthM,waterLevelElevationM:surface.waterLevelElevationM,waterSourceIds:surface.waterSourceIds,landReserved:surface.landReserved});if(k&&k%128===0)yield{phase:'crossing-survey',probes:k};}
  const crossing=crossingSamples.some(p=>p.landReserved)?null:fitLocalRiverCrossings(crossingSamples,{maxGrade,allowLakeBridges:true});if(crossing)return{...link,...crossing,status:'surveyed-local-route',lengthM:distance,probes:crossingSamples.length,survey:{method:'river-crossing-survey',maxGrade,probeSpacingM:5}};
 }
 const minX=Math.min(0,end.xM)-marginM,minY=Math.min(0,end.yM)-marginM,width=Math.abs(end.xM)+2*marginM,height=Math.abs(end.yM)+2*marginM,spacing=Math.max(width,height)/(cells-1),columns=Math.max(3,Math.ceil(width/spacing)+1),rows=Math.max(3,Math.ceil(height/spacing)+1),n=columns*rows;
 const pos=i=>({xM:minX+(i%columns)*width/(columns-1),yM:minY+Math.floor(i/columns)*height/(rows-1)}),index=p=>Math.max(0,Math.min(rows-1,Math.round((p.yM-minY)/height*(rows-1))))*columns+Math.max(0,Math.min(columns-1,Math.round((p.xM-minX)/width*(columns-1))));
 const start=index({xM:0,yM:0}),nearestGoal=index(end),goal=nearestGoal===start?(start%columns+1<columns?start+1:start-1):nearestGoal,positions=new Map([[start,{xM:0,yM:0}],[goal,end]]),samples=new Map();let probes=0;
 const at=i=>positions.get(i)??pos(i),sample=p=>{const g=projection.toGeographic(p.xM,p.yM);probes++;const s=base.sampleSurfaceAt(g.latDeg,g.lonDeg);return{...p,...g,z:s.groundElevationM,resistance:environmentCost(g,s),wet:s.waterDepthM>0||s.landReserved};};
 const get=i=>{if(!samples.has(i))samples.set(i,sample(at(i)));return samples.get(i);};
 let edgeProbeWork=0;const edgeRoutes=new Map();const costs=new Float64Array(n).fill(Infinity),prev=new Int32Array(n).fill(-1),heap=new Heap();costs[start]=0;heap.push([distance,0,start]);
 const directions=extendedDirections?Array.from({length:9},(_,y)=>Array.from({length:9},(_,x)=>[x-4,y-4])).flat().filter(([x,y])=>{const gcd=(a,b)=>b?gcd(b,a%b):a;return gcd(Math.abs(x),Math.abs(y))===1;}):[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
 let expanded=0;while(heap.a.length){if(++expanded%64===0)yield{expanded,probes};const [,cost,i]=heap.pop();if(cost!==costs[i])continue;if(i===goal)break;const a=get(i);if(a.wet)continue;
  for(const [dx,dy]of directions){const x=i%columns+dx,y=Math.floor(i/columns)+dy;if(x<0||y<0||x>=columns||y>=rows)continue;const j=y*columns+x,b=get(j);if(b.wet)continue;const length=Math.hypot(b.xM-a.xM,b.yM-a.yM);if(cost+length>=costs[j])continue;const steps=Math.max(1,Math.ceil(length/probeSpacingM));let prior=a,valid=true,max=0,resistanceSum=a.resistance;
   for(let k=1;k<=steps;k++){const q=k===steps?b:sample({xM:a.xM+(b.xM-a.xM)*k/steps,yM:a.yM+(b.yM-a.yM)*k/steps}),grade=Math.abs(q.z-prior.z)/(length/steps);if(++edgeProbeWork%128===0)yield{phase:'edge-survey',expanded,probes};if(q.wet||grade>maxGrade){valid=false;break;}max=Math.max(max,grade);resistanceSum+=q.resistance;prior=q;}let crossing=null;if(!valid&&allowRiverBridges){const fine=[],count=Math.ceil(length/5);for(let k=0;k<=count;k++){const p=projection.toGeographic(a.xM+(b.xM-a.xM)*k/count,a.yM+(b.yM-a.yM)*k/count),surface=base.sampleSurfaceAt(p.latDeg,p.lonDeg);if(++edgeProbeWork%128===0)yield{phase:'bridge-edge-survey',expanded,probes};if(surface.landReserved){fine.length=0;break;}fine.push({...p,elevationM:surface.groundElevationM,distanceM:length*k/count,waterDepthM:surface.waterDepthM,waterLevelElevationM:surface.waterLevelElevationM,waterSourceIds:surface.waterSourceIds});}crossing=fitLocalRiverCrossings(fine,{maxGrade,allowLakeBridges:true});if(crossing){valid=true;max=maxGrade;}}if(!valid)continue;
   const next=cost+length*(1+10*max)*(crossing?Math.max(a.resistance,b.resistance):resistanceSum/(steps+1));if(next<costs[j]){costs[j]=next;prev[j]=i;if(crossing)edgeRoutes.set(j,crossing);else edgeRoutes.delete(j);heap.push([next+Math.hypot(end.xM-b.xM,end.yM-b.yM),next,j]);}
  }
 }
 if(!Number.isFinite(costs[goal])){
 // A regional connection may cross a major river. This bounded preflight
 // records that planning requirement rather than spending the fine-grid budget
 // pretending that a local timber bridge is the only transport option. It is
 // not an impossibility proof and does not invent a ferry or a finished road.
 if(wideWaterReferral&&marginM===500){
  const stepM=20,count=Math.max(1,Math.ceil(distance/stepM)),runs=[];let run=null;
  for(let k=0;k<=count;k++){
   const p=projection.toGeographic(end.xM*k/count,end.yM*k/count),surface=base.sampleSurfaceAt(p.latDeg,p.lonDeg);
   if(surface.waterDepthM>0){if(!run){run={startDistanceM:distance*k/count,endDistanceM:distance*k/count,sourceIds:[],maximumSampledDepthM:0};runs.push(run);}run.endDistanceM=distance*k/count;run.maximumSampledDepthM=Math.max(run.maximumSampledDepthM,surface.waterDepthM);for(const id of surface.waterSourceIds??[])if(!run.sourceIds.includes(id))run.sourceIds.push(id);}else run=null;
   if(k&&k%128===0)yield{phase:'transport-water-preflight',probes:k};
  }
  // Four times the local bridge span is a declared referral heuristic, not a
  // geological threshold. Smaller crossings still get the existing detour search.
  const major=runs.filter(r=>r.endDistanceM-r.startDistanceM>=640);
  if(major.length)return{...link,status:'requires-regional-crossing-plan',points:[],reason:'wide-water-on-proposed-corridor',probes:probes+count+1,crossingAssessment:{schema:'transport-water-referral@1',localSearch:{cells,marginM,status:'no-route-in-initial-local-grid'},sampleSpacingM:distance/count,localBridgeSpanLimitM:160,referralWetRunM:640,runs:major.map(r=>({...r,sampledWetLengthM:r.endDistanceM-r.startDistanceM})),alternatives:['survey-upstream-or-downstream-crossing','assess-ferry-and-landings','assess-major-bridge'],built:false,limitations:['Only the proposed straight corridor was sampled','Does not establish that all land detours are impossible','No crossing location, ferry, bridge or approach road has been approved or built']}};
 }
if(marginM<10000){const nextMargin=marginM<2000?2000:10000;const wider=yield* iterateLocalRoadRoute(base,link,{cells:nextMargin===10000?129:cells,maxGrade,marginM:nextMargin,maxDistanceM,probeSpacingM,allowRiverBridges,extendedDirections,environmentCostAt,wideWaterReferral:false});return{...wider,probes:probes+(wider.probes??0),surveyAttempts:1+(wider.surveyAttempts??1)};}if(!extendedDirections){const refined=yield* iterateLocalRoadRoute(base,link,{cells,maxGrade,marginM,maxDistanceM,probeSpacingM,allowRiverBridges,extendedDirections:true,environmentCostAt,wideWaterReferral:false});return{...refined,probes:probes+(refined.probes??0)};}return{...link,status:'blocked-within-survey',points:[],reason:'no-dry-path-within-grade-and-search-bounds',probes};}
 const indices=[];for(let i=goal;i>=0;i=prev[i]){indices.push(i);if(i===start)break;}indices.reverse();let lengthM=0;const points=[],bridgeSpans=[];
 for(let k=0;k<indices.length;k++){const p=get(indices[k]);if(!k){points.push({latDeg:p.latDeg,lonDeg:p.lonDeg,elevationM:p.z,roadElevationM:p.z+.06,distanceM:0});continue;}const a=get(indices[k-1]),length=Math.hypot(p.xM-a.xM,p.yM-a.yM),crossing=edgeRoutes.get(indices[k]);if(crossing){for(const q of crossing.points.slice(1))points.push({...q,distanceM:lengthM+q.distanceM});for(const span of crossing.bridgeSpans)bridgeSpans.push({...span,startDistanceM:lengthM+span.startDistanceM,endDistanceM:lengthM+span.endDistanceM});}else{const steps=Math.ceil(length/probeSpacingM);for(let j=1;j<=steps;j++){const q=j===steps?p:sample({xM:a.xM+(p.xM-a.xM)*j/steps,yM:a.yM+(p.yM-a.yM)*j/steps});points.push({latDeg:q.latDeg,lonDeg:q.lonDeg,elevationM:q.z,roadElevationM:q.z+.06,distanceM:lengthM+length*j/steps});if(++edgeProbeWork%128===0)yield{phase:'route-profile',probes};}}lengthM+=length;}
 return{...link,status:'surveyed-local-route',points,bridgeSpans,lengthM,probes,survey:{...(environmentCostAt?{environmentRouting:"sampled-cover-resistance@1"}:{}),cells,columns,rows,extendedDirections,maxGrade,probeSpacingM,marginM,limitations:['Sub-probe obstacles unresolved','Bounded inland-water bridges; foundations and drainage unresolved']}};
}

/** A thin, surveyed unpaved road follows the actual land. No bridge is added.
 * The returned canonical profile is shared by rendering and surface queries. */
export function createLocalRoadRecipe(base,link,options={}){
 const route=options.route??routeLocalRoad(base,link,options),projection=createSphericalProjection({centerLatDeg:route.fromPoint.latDeg,centerLonDeg:route.fromPoint.lonDeg,radiusM:base.frame.radiusM,maxRadiusM:Math.min(base.frame.radiusM*.1,Math.max(2000,link.distanceM+10000))});
 const samples=[];let distanceM=0;
 for(let i=1;i<route.points.length;i++){const a=projection.toLocal(route.points[i-1].latDeg,route.points[i-1].lonDeg),b=projection.toLocal(route.points[i].latDeg,route.points[i].lonDeg),length=Math.hypot(b.xM-a.xM,b.yM-a.yM),steps=Math.max(1,Math.ceil(length/20));
  for(let k=i===1?0:1;k<=steps;k++){const xM=a.xM+(b.xM-a.xM)*k/steps,yM=a.yM+(b.yM-a.yM)*k/steps,p=projection.toGeographic(xM,yM);samples.push({xM,yM,distanceM:distanceM+length*k/steps,roadElevationM:route.points[i].roadElevationM!=null?(route.points[i-1].roadElevationM+(route.points[i].roadElevationM-route.points[i-1].roadElevationM)*k/steps):base.groundElevationAt(p.latDeg,p.lonDeg)+.06,structureKind:(k===steps?route.points[i].structureKind:route.points[i-1].structureKind)??'fill',segmentKind:(k===steps?route.points[i].segmentKind:route.points[i-1].segmentKind)??'fill'});}distanceM+=length;
 }
 const bridgeStructures=(route.bridgeSpans??[]).map((span,index)=>buildBridgeStructure({id:`${link.id}/bridge:${index}`,roadId:link.id,start:projection.toLocal(span.start.latDeg,span.start.lonDeg),end:projection.toLocal(span.end.latDeg,span.end.lonDeg),deckElevationM:span.deckElevationM,widthM:5,groundAt:(x,y)=>{const p=projection.toGeographic(x,y);return base.groundElevationAt(p.latDeg,p.lonDeg);}}));
 if(bridgeStructures.some(s=>s.assessment.status!=='within-input-model')){route.status='bridge-design-rejected';route.reason='beam-assessment';samples.length=0;bridgeStructures.length=0;}
 const xs=samples.map(p=>p.xM),ys=samples.map(p=>p.yM);
 return{id:link.id,projection:projection.contract,bounds:samples.length?{minXM:Math.min(...xs)-20,maxXM:Math.max(...xs)+20,minYM:Math.min(...ys)-20,maxYM:Math.max(...ys)+20}:{minXM:-10,maxXM:10,minYM:-10,maxYM:10},model:{schema:WATER_SCHEMA,construction:'strip-with-smooth-banks@4',nodes:[],edges:[],bodies:[],topologyOrder:[],basins:null},roadCenterlineProfiles:samples.length?[{roadId:link.id,halfWidthM:2.5,...(bridgeStructures.length?{deckThicknessM:.8}:{}),samples}]:[],buildingPads:[],buildings:[],bridgeStructures,routeStatus:route,sparseRoadOverlay:true};
}

export function routeLocalRoad(base,link,options){const run=iterateLocalRoadRoute(base,link,options);let step;do{step=run.next();}while(!step.done);return step.value;}

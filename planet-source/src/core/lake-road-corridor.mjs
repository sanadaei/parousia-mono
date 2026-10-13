import {createSphericalProjection,greatCircle} from './spherical.mjs';
/** Coarse land corridor before local road subdivision. Large lakes cannot be
 * bypassed after a straight line has already been split into underwater ends.
 * Rivers are deferred to the local bridge survey, not treated as free dry land. */
export function planLandRoadCorridor(base,link,{cells=65,probeSpacingM=1000,marginFactor=.6}={}){
 if(!Number.isInteger(cells)||cells<9||cells>129||!Number.isFinite(probeSpacingM)||probeSpacingM<100||probeSpacingM>10000)throw new RangeError('Invalid corridor survey budget');
 const R=base.frame.radiusM,distance=greatCircle(link.fromPoint,link.toPoint,R).distanceM;
 if(distance<1000)return link;
 if(distance>=R*.09)return{...link,corridorStatus:'requires-global-scale-corridor'};
 const margin=Math.min((R*.1-distance)/3,Math.max(Math.min(20000,R*.01),distance*marginFactor)),projection=createSphericalProjection({centerLatDeg:link.fromPoint.latDeg,centerLonDeg:link.fromPoint.lonDeg,radiusM:R,maxRadiusM:R*.1}),end=projection.toLocal(link.toPoint.latDeg,link.toPoint.lonDeg);
 const wet=p=>{const g=projection.toGeographic(p.xM,p.yM),s=base.sampleSurfaceAt(g.latDeg,g.lonDeg);return s.waterDepthM>0&&!(s.waterSourceIds?.length&&s.waterSourceIds.every(id=>id.startsWith('river:')));};
 const clear=(a,b)=>{const count=Math.ceil(Math.hypot(b.xM-a.xM,b.yM-a.yM)/probeSpacingM);for(let k=0;k<=count;k++)if(wet({xM:a.xM+(b.xM-a.xM)*k/Math.max(1,count),yM:a.yM+(b.yM-a.yM)*k/Math.max(1,count)}))return false;return true;};
 if(clear({xM:0,yM:0},end))return link;
 const x0=Math.min(0,end.xM)-margin,y0=Math.min(0,end.yM)-margin,w=Math.abs(end.xM)+2*margin,h=Math.abs(end.yM)+2*margin,n=cells*cells;
 const point=i=>({xM:x0+(i%cells)*w/(cells-1),yM:y0+Math.floor(i/cells)*h/(cells-1)}),index=p=>Math.round((p.yM-y0)/h*(cells-1))*cells+Math.round((p.xM-x0)/w*(cells-1)),start=index({xM:0,yM:0}),goal=index(end),positions=new Map([[start,{xM:0,yM:0}],[goal,end]]),at=i=>positions.get(i)??point(i),valid=new Map(),dry=i=>{if(!valid.has(i))valid.set(i,!wet(at(i)));return valid.get(i);};
 if(start===goal)return{...link,corridorStatus:'requires-finer-corridor-grid'};
 const cost=new Float64Array(n).fill(Infinity),previous=new Int32Array(n).fill(-1),open=new Set([start]),closed=new Set();cost[start]=0;
 while(open.size){let current=-1,best=Infinity;for(const i of open){const p=at(i),score=cost[i]+Math.hypot(p.xM-end.xM,p.yM-end.yM);if(score<best){best=score;current=i;}}if(current===goal)break;open.delete(current);closed.add(current);if(!dry(current))continue;const a=at(current);
  for(const [dx,dy]of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){const x=current%cells+dx,y=Math.floor(current/cells)+dy;if(x<0||y<0||x>=cells||y>=cells)continue;const j=y*cells+x;if(closed.has(j)||!dry(j))continue;const b=at(j),next=cost[current]+Math.hypot(b.xM-a.xM,b.yM-a.yM);if(next>=cost[j]||!clear(a,b))continue;cost[j]=next;previous[j]=current;open.add(j);}
 }
 if(!Number.isFinite(cost[goal])){if(marginFactor<2)return planLandRoadCorridor(base,link,{cells,probeSpacingM,marginFactor:2});return{...link,corridorStatus:'no-land-corridor-within-survey'};}
 const chain=[];for(let i=goal;i>=0;i=previous[i]){chain.push(i);if(i===start)break;}chain.reverse();const points=chain.map((i,k)=>k===0?link.fromPoint:k===chain.length-1?link.toPoint:projection.toGeographic(at(i).xM,at(i).yM));
 return{...link,points,distanceM:cost[goal],corridorStatus:'coarse-lake-bypass-requires-local-survey',corridorSurvey:{cells,probeSpacingM,marginM:margin}};
}

import {metricRoads} from './road-geometry.mjs';
/** Existing saved street graph. No straight-line shortcut across a river. */
export function villageTransportDistance(recipe){
 const roads=metricRoads(recipe.roadCenterlineProfiles??[]),nodes=[],junctions=recipe.roadJunctions??[];
 for(const road of roads){nodes.push({roadId:road.id,station:0});nodes.push({roadId:road.id,station:road.lengthM});}
 for(const j of junctions)for(const m of j.members)nodes.push({roadId:m.roadId,station:m.distanceM,junctionId:j.junctionId});
 if(nodes.length>256)throw new RangeError('Street graph budget exceeded');
 const costs=nodes.map((a,i)=>nodes.map((b,k)=>i===k?0:a.roadId===b.roadId?Math.abs(a.station-b.station):a.junctionId&&a.junctionId===b.junctionId?0:Infinity));
 for(let k=0;k<nodes.length;k++)for(let i=0;i<nodes.length;i++)for(let j=0;j<nodes.length;j++)costs[i][j]=Math.min(costs[i][j],costs[i][k]+costs[k][j]);
 return(a,b)=>{const x=a.access,y=b.access;if(!x||!y||![x.stationM,y.stationM,x.distanceM,y.distanceM].every(Number.isFinite))return Infinity;
  let best=x.roadId===y.roadId?Math.abs(x.stationM-y.stationM):Infinity;
  for(let i=0;i<nodes.length;i++)if(nodes[i].roadId===x.roadId)for(let j=0;j<nodes.length;j++)if(nodes[j].roadId===y.roadId)best=Math.min(best,Math.abs(nodes[i].station-x.stationM)+costs[i][j]+Math.abs(nodes[j].station-y.stationM));
  return best+x.distanceM+y.distanceM;
 };
}

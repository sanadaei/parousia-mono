import {hashJson} from './json-contract.mjs';

/** The committed L1 drainage is the topology authority. Channel centre lines
 * are coarse corridors, not surveyed banks. Keep uphill/closed/lake cases
 * visible instead of silently turning every sink into an ocean outlet. */
export function createL1WaterNetwork(parent) {
  const {snapshot:s,climate:c}=parent??{},w=s?.grid?.columns,h=s?.grid?.rows,n=w*h;
  if(s?.layer!=='L1'||c?.sourceLayerId!==s.layerId||!Number.isSafeInteger(n)||n>131072||!Number.isFinite(s.frame?.radiusM)||s.frame.radiusM<=0)throw Error('Matching bounded L1 parent required');
  const z=s.fields.groundElevationM,land=s.fields.landMask,down=s.fields.downstream;
  const area=c.cellAreaM2,volume=c.catchmentWater?.annualRoutedYieldM3;
  for(const a of [z,land,down,area,volume])if(!Array.isArray(a)||a.length!==n)throw Error('Complete L1 water fields required');
  if(!z.every(Number.isFinite)||!area.every(v=>Number.isFinite(v)&&v>0)||!volume.every(v=>Number.isFinite(v)&&v>=0)||!land.every(v=>v===0||v===1))throw Error('Invalid L1 water fields');
  const donors=Array.from({length:n},()=>[]),degree=new Uint32Array(n),order=[];
  for(let i=0;i<n;i++) {const j=down[i];if(!Number.isInteger(j)||j< -1||j>=n||j===i)throw Error('Invalid L1 receiver');if(j>=0){const dx=Math.abs(i%w-j%w),dy=Math.abs(Math.floor(i/w)-Math.floor(j/w));if(Math.min(dx,w-dx)>1||dy>1)throw Error('Nonadjacent L1 receiver');donors[j].push(i);degree[j]++;}}
  for(let i=0;i<n;i++)if(!degree[i])order.push(i);
  for(let k=0;k<order.length;k++){const j=down[order[k]];if(j>=0&&!--degree[j])order.push(j);}
  if(order.length!==n)throw Error('Cyclic L1 water network');
  const upstreamArea=area.map((a,i)=>land[i]?a:0),streamOrder=Array(n).fill(1),basin=Array(n).fill(-1);
  for(const i of order){const ds=donors[i].filter(j=>land[j]);if(ds.length){const m=Math.max(...ds.map(j=>streamOrder[j]));streamOrder[i]=m+(ds.filter(j=>streamOrder[j]===m).length>=2?1:0);}if(down[i]>=0)upstreamArea[down[i]]+=upstreamArea[i];}
  for(let k=order.length-1;k>=0;k--){const i=order[k],j=down[i];basin[i]=j<0||!land[i]?i:basin[j];}
  // Euler intervals let a finer window debit its own rainfall from an imported
  // upstream volume without scanning an entire catchment for every boundary.
  const tin=Array(n),tout=Array(n);let clock=0;
  for(let root=0;root<n;root++)if(down[root]<0){const stack=[[root,0]];while(stack.length){const [i,exit]=stack.pop();if(exit){tout[i]=clock;continue;}tin[i]=clock++;stack.push([i,1]);for(let k=donors[i].length-1;k>=0;k--)stack.push([donors[i][k],0]);}}
  const lakeAt=new Map();for(const l of s.references.lakes??[])for(const i of l.cells)lakeAt.set(i,l.id);
  const point=i=>({latDeg:90-(Math.floor(i/w)+.5)*180/h,lonDeg:(i%w+.5)*360/w,elevationM:z[i]});
  const edges=[];let uphill=0;
  for(let i=0;i<n;i++){const j=down[i];if(!land[i]||j<0)continue;const supported=z[i]>=z[j];if(!supported)uphill++;
    edges.push({id:`${s.layerId}:water:${i}:${j}`,fromCell:i,toCell:j,from:point(i),to:point(j),annualSupplyM3:volume[i],meanPotentialFlowM3PerSecond:volume[i]/31536000,upstreamAreaM2:upstreamArea[i],streamOrder:streamOrder[i],basinCell:basin[i],destination:lakeAt.has(basin[i])?{kind:'lake',id:lakeAt.get(basin[i])}:land[basin[i]]?{kind:'terminal',cell:basin[i]}:{kind:'sea',cell:basin[i]},bedStatus:supported?'downhill-coarse-corridor':'unresolved-uphill-ground'});
  }
  return {schema:'l1-water-network@1',id:hashJson({layerId:s.layerId,climateId:c.id,method:'water-corridors@1'}),sourceLayerId:s.layerId,sourceWorldId:s.worldId,climateId:c.id,grid:{columns:w,rows:h},radiusM:s.frame.radiusM,edges,basinCell:basin,upstreamAreaM2:upstreamArea,tin,tout,diagnostics:{edges:edges.length,uphillGroundEdges:uphill,terminalBasins:new Set(basin.filter((_,i)=>land[i])).size},limits:['Grid centre lines are broad corridors, not surveyed river geometry','Annual potential supply is not seasonal discharge','Uphill ground corridors require a lake or valley decision before local adoption']};
}

/** Clip L1 corridors to a local metric window. Shared boundary positions come
 * from the parent edge, independent of which neighbour is requested first. */
export function clipL1WaterNetwork(network,{latDeg,lonDeg,columns,rows,cellSizeM,minFlowM3PerSecond=1}) {
  if(![latDeg,lonDeg,cellSizeM,minFlowM3PerSecond].every(Number.isFinite)||Math.abs(latDeg)>80||cellSizeM<=0||minFlowM3PerSecond<0||!Number.isInteger(columns)||!Number.isInteger(rows)||columns<3||rows<3||columns*rows>65536)throw Error('Bounded nonpolar water window required');
  const rad=Math.PI/180,R=network.radiusM,width=(columns-1)*cellSizeM,height=(rows-1)*cellSizeM;
  const wrap=d=>((d+180)%360+360)%360-180;
  const project=p=>({x:wrap(p.lonDeg-lonDeg)*rad*R*Math.cos(latDeg*rad),y:(latDeg-p.latDeg)*rad*R});
  const reaches=[],crossings=[];
  for(const e of network.edges){if(e.meanPotentialFlowM3PerSecond<minFlowM3PerSecond)continue;
    const a=project(e.from),b=project(e.to);if(Math.abs(b.x-a.x)>Math.PI*R*Math.cos(latDeg*rad))continue;
    const dx=b.x-a.x,dy=b.y-a.y;let lo=0,hi=1,valid=true;
    for(const [p,q] of [[-dx,a.x+width/2],[dx,width/2-a.x],[-dy,a.y+height/2],[dy,height/2-a.y]]){if(p===0){if(q<0)valid=false;}else{const t=q/p;if(p<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);}}
    if(!valid||hi-lo<1e-10)continue;
    const at=t=>{const x=a.x+t*dx,y=a.y+t*dy;return{xM:x,yM:y,latDeg:latDeg-y/R/rad,lonDeg:((lonDeg+x/(R*Math.cos(latDeg*rad))/rad)%360+360)%360,elevationM:e.from.elevationM+t*(e.to.elevationM-e.from.elevationM),cell:Math.round((y+height/2)/cellSizeM)*columns+Math.round((x+width/2)/cellSizeM)};};
    const start=at(lo),end=at(hi),reach={...e,tStart:lo,tEnd:hi,start,end};reaches.push(reach);
    for(const [t,direction,point] of [[lo,'in',start],[hi,'out',end]])if(direction==='in'?t>1e-10:t<1-1e-10){const canonicalT=Math.round(t*1e12)/1e12;crossings.push({id:hashJson({edge:e.id,t:canonicalT}),edgeId:e.id,fromCell:e.fromCell,toCell:e.toCell,t:canonicalT,direction,...point,annualSupplyM3:e.annualSupplyM3,bedStatus:e.bedStatus});}
  }
  return{schema:'l1-water-window@1',sourceNetworkId:network.id,sourceLayerId:network.sourceLayerId,settings:{latDeg,lonDeg,columns,rows,cellSizeM,minFlowM3PerSecond},reaches,crossings,limits:['Boundary beds are linear coarse ground estimates, not surveyed water levels','Exact geographic ports and snapped raster cells are both retained','Filtered headwaters still contribute through local rainfall']};
}

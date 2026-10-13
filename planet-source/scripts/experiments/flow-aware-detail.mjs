import {anchoredGeneratedSurface,sampleMetric} from './anchored-regional-surface.mjs';
export const DETAIL_METHOD_VERSION='bounded-flow-aware-residual@1';
export const DETAIL_METHODS=['baseline','quarter-strength','flow-aware-positive'];
/** Modify only newly proposed detail. Corridors are rebuilt from the current
 * parent graph at every stage, with radius equal to that parent's cell diagonal.
 * Positive residual fades to 1/4 on a high-flow edge and reaches full strength
 * at the corridor edge. Negative residual and all adopted anchors are unchanged. */
export function fineDetailSurface(parent,source,{factor=2,detailMethod='baseline'}={}){
 if(!DETAIL_METHODS.includes(detailMethod))throw Error('Unknown bounded detail method');
 const surface=anchoredGeneratedSurface(parent,source,{factor});
 const g=parent.grid,s=surface.grid,radius=Math.hypot(g.cellSizeM,g.cellSizeYM),threshold=Math.max(...parent.annualFlowM3)*.01;
 const distance=new Float64Array(surface.elevation.length).fill(Infinity);let corridorEdges=0;
 if(detailMethod==='flow-aware-positive')for(let i=0;i<parent.receiver.length;i++){
  const j=parent.receiver[i];if(j<0||parent.annualFlowM3[i]<threshold)continue;corridorEdges++;
  const ax=i%g.columns*g.cellSizeM,ay=Math.floor(i/g.columns)*g.cellSizeYM,bx=j%g.columns*g.cellSizeM,by=Math.floor(j/g.columns)*g.cellSizeYM,vx=bx-ax,vy=by-ay,den=vx*vx+vy*vy;
  for(let y=Math.max(0,Math.floor((Math.min(ay,by)-radius)/s.cellSizeYM));y<=Math.min(s.rows-1,Math.ceil((Math.max(ay,by)+radius)/s.cellSizeYM));y++)for(let x=Math.max(0,Math.floor((Math.min(ax,bx)-radius)/s.cellSizeM));x<=Math.min(s.columns-1,Math.ceil((Math.max(ax,bx)+radius)/s.cellSizeM));x++){
   const px=x*s.cellSizeM-ax,py=y*s.cellSizeYM-ay,t=Math.max(0,Math.min(1,(px*vx+py*vy)/den)),k=y*s.columns+x;distance[k]=Math.min(distance[k],Math.hypot(px-t*vx,py-t*vy));
  }
 }
 let sum2=0,count=0,maxHeight=0,attenuated=0,maxSlope=0,maxMean=0;const details=[];
 for(let i=0;i<surface.elevation.length;i++){
  const x=i%s.columns,y=Math.floor(i/s.columns),base=sampleMetric(g,parent.elevation,x*s.cellSizeM,y*s.cellSizeYM),d=surface.elevation[i]-base;
  const u=Math.min(1,distance[i]/radius),scale=detailMethod==='quarter-strength'?.25:detailMethod==='flow-aware-positive'&&d>0?.25+.75*u*u*(3-2*u):1;
  surface.elevation[i]=base+d*scale;if(x%factor===0&&y%factor===0)surface.elevation[i]=parent.elevation[y/factor*g.columns+x/factor];
  const added=surface.elevation[i]-base;details.push(added);sum2+=added*added;if(Math.abs(added)>1e-9)count++;maxHeight=Math.max(maxHeight,Math.abs(added));if(scale<1&&Math.abs(d)>1e-9)attenuated++;
 }
 for(let y=0;y<s.rows;y++)for(let x=0;x<s.columns;x++)for(const [a,b]of [[1,0],[0,1],[1,1],[-1,1]])if(x+a>=0&&x+a<s.columns&&y+b<s.rows)maxSlope=Math.max(maxSlope,Math.abs(details[(y+b)*s.columns+x+a]-details[y*s.columns+x])/Math.hypot(a*s.cellSizeM,b*s.cellSizeYM));
 for(let y=0;y<g.rows-1;y++)for(let x=0;x<g.columns-1;x++){let sum=0,weight=0;for(let yy=0;yy<=factor;yy++)for(let xx=0;xx<=factor;xx++){const a=(xx===0||xx===factor?.5:1)*(yy===0||yy===factor?.5:1);sum+=details[(y*factor+yy)*s.columns+x*factor+xx]*a;weight+=a;}maxMean=Math.max(maxMean,Math.abs(sum/weight));}
 surface.detailMethod={version:DETAIL_METHOD_VERSION,name:detailMethod,corridorRadiusM:detailMethod==='flow-aware-positive'?radius:null,highFlowThresholdAnnualM3:threshold,corridorEdges,attenuatedCells:attenuated};
 surface.diagnostics={...surface.diagnostics,nonzeroDetailCells:count,rmsAddedHeightM:Math.sqrt(sum2/details.length),maxAddedHeightM:maxHeight,maxAddedSlopeMPerM:maxSlope,totalSlopeUpperBoundMPerM:surface.diagnostics.inheritedMaxSlopeMPerM+maxSlope,maxAbsParentCellMeanShiftM:maxMean};
 return surface;
}

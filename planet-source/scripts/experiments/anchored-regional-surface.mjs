import {generateLandformCandidate} from './conditional-landform-candidate.mjs';
import {hashJson,copyJson} from '../../src/core/json-contract.mjs';
export const SURFACE_VERSION='parent-anchored-generated-residual@1';
// Conservative experiment envelope: Tuscany comparison P90 slope 7.854° and
// P05–P95 relief 299.67m. These bound ADDED detail, not inherited slopes.
export const DEFAULT_ENVELOPE=Object.freeze({maxAddedSlopeMPerM:Math.tan(7.85398237488336*Math.PI/180),maxDetailReliefM:299.6707819999999/4});
export function sampleMetric(grid,z,xM,yM){
 const dx=grid.cellSizeM,dy=grid.cellSizeYM??dx,w=grid.columns,h=grid.rows,x=xM/dx,y=yM/dy;
 if(x< -1e-9||y< -1e-9||x>w-1+1e-9||y>h-1+1e-9)throw Error('Sample outside physical source support');
 const xx=Math.max(0,Math.min(w-1,x)),yy=Math.max(0,Math.min(h-1,y)),ix=Math.min(w-2,Math.floor(xx)),iy=Math.min(h-2,Math.floor(yy)),u=xx-ix,v=yy-iy,i=iy*w+ix;
 return z[i]*(1-u)*(1-v)+z[i+1]*u*(1-v)+z[i+w]*(1-u)*v+z[i+w+1]*u*v;
}
export function generateSharedDetailSource(parent,{seed='muna-atlas-001',nativeCellSizeM=120}={}){
 if(nativeCellSizeM!==120)throw Error('This trial requires native 120 m source');
 const g=parent.grid,widthM=(g.columns-1)*g.cellSizeM,heightM=(g.rows-1)*(g.cellSizeYM??g.cellSizeM);
 const columns=Math.max(24,Math.ceil(widthM/nativeCellSizeM)+1),rows=Math.max(24,Math.ceil(heightM/nativeCellSizeM)+1);
 if(columns*rows>32768)throw Error('Native generated source exceeds bounded 32768-cell budget');
 const raw=generateLandformCandidate({seed,columns,rows,cellSizeM:nativeCellSizeM});
 const content={schema:'shared-native-detail@1',seed,grid:raw.grid,elevation:raw.elevation,widthM,heightM,offsetXM:((columns-1)*nativeCellSizeM-widthM)/2,offsetYM:((rows-1)*nativeCellSizeM-heightM)/2};
 return {...content,id:hashJson(copyJson(content))};
}
export function anchoredGeneratedSurface(parent,source,{factor=2,...envelope}={}){
 if(![2,4].includes(factor))throw Error('Stage factor must be 2 or 4; compose larger gaps');
 const {maxAddedSlopeMPerM,maxDetailReliefM}={...DEFAULT_ENVELOPE,...envelope};
 if(![maxAddedSlopeMPerM,maxDetailReliefM].every(v=>Number.isFinite(v)&&v>0))throw Error('Finite positive detail envelope required');
 const {id:sourceId,...sourceContent}=source;
 if(hashJson(copyJson(sourceContent))!==sourceId)throw Error('Generated source content identity mismatch');
 if(Math.abs(source.widthM-(parent.grid.columns-1)*parent.grid.cellSizeM)>1e-7||Math.abs(source.heightM-(parent.grid.rows-1)*(parent.grid.cellSizeYM??parent.grid.cellSizeM))>1e-7)throw Error('Generated source must share the parent physical extent');
 const g=parent.grid,w=(g.columns-1)*factor+1,h=(g.rows-1)*factor+1,dx=g.cellSizeM/factor,dy=(g.cellSizeYM??g.cellSizeM)/factor;
 if(w*h>65536)throw Error('Fine shared context exceeds bounded 65536-cell budget');
 if(dx<source.grid.cellSizeM-1e-9||dy<(source.grid.cellSizeYM??source.grid.cellSizeM)-1e-9)throw Error('Requested detail finer than native source; interpolation is not new terrain');
 const sourceSample=(x,y)=>sampleMetric(source.grid,source.elevation,x+source.offsetXM,y+source.offsetYM),qParent=[];
 for(let y=0;y<g.rows;y++)for(let x=0;x<g.columns;x++)qParent.push(sourceSample(x*g.cellSizeM,y*(g.cellSizeYM??g.cellSizeM)));
 const base=[],residual=[];
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const xm=x*dx,ym=y*dy;base.push(sampleMetric(g,parent.elevation,xm,ym));residual.push(sourceSample(xm,ym)-sampleMetric(g,qParent,xm,ym));}
 let rawMaxSlope=0,inheritedMaxSlope=0,maxResidual=0;
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;maxResidual=Math.max(maxResidual,Math.abs(residual[i]));for(const [a,b] of [[1,0],[0,1],[1,1],[-1,1]])if(x+a>=0&&x+a<w&&y+b<h){const j=(y+b)*w+x+a,d=Math.hypot(a*dx,b*dy);rawMaxSlope=Math.max(rawMaxSlope,Math.abs(residual[j]-residual[i])/d);inheritedMaxSlope=Math.max(inheritedMaxSlope,Math.abs(base[j]-base[i])/d);}}
 const alpha=Math.min(1,maxResidual?maxDetailReliefM/maxResidual:1,rawMaxSlope?maxAddedSlopeMPerM/rawMaxSlope:1);
 const elevation=base.map((z,i)=>z+alpha*residual[i]);
 for(let y=0;y<g.rows;y++)for(let x=0;x<g.columns;x++)elevation[y*factor*w+x*factor]=parent.elevation[y*g.columns+x];
 let nonzeroDetailCells=0,sum2=0,maxAddedHeightM=0,maxAbsParentCellMeanShiftM=0;
 for(let i=0;i<elevation.length;i++){const d=elevation[i]-base[i];if(Math.abs(d)>1e-9)nonzeroDetailCells++;sum2+=d*d;maxAddedHeightM=Math.max(maxAddedHeightM,Math.abs(d));}
 for(let y=0;y<g.rows-1;y++)for(let x=0;x<g.columns-1;x++){let sum=0,weight=0;for(let yy=0;yy<=factor;yy++)for(let xx=0;xx<=factor;xx++){const k=(y*factor+yy)*w+x*factor+xx,a=(xx===0||xx===factor?.5:1)*(yy===0||yy===factor?.5:1);sum+=(elevation[k]-base[k])*a;weight+=a;}maxAbsParentCellMeanShiftM=Math.max(maxAbsParentCellMeanShiftM,Math.abs(sum/weight));}
 const diagnostics={alpha,nativeSpacingM:source.grid.cellSizeM,outputSpacingM:{x:dx,y:dy},nonzeroDetailCells,rmsAddedHeightM:Math.sqrt(sum2/elevation.length),maxAddedHeightM,maxAddedSlopeMPerM:alpha*rawMaxSlope,inheritedMaxSlopeMPerM:inheritedMaxSlope,totalSlopeUpperBoundMPerM:inheritedMaxSlope+alpha*rawMaxSlope,maxAbsParentCellMeanShiftM};
 return {schema:SURFACE_VERSION,sourceId:source.id,parentId:parent.id,factor,grid:{columns:w,rows:h,cellSizeM:dx,cellSizeYM:dy},elevation,envelope:{maxAddedSlopeMPerM,maxDetailReliefM},diagnostics,limits:['Point anchors preserved; parent-cell mean and sediment volume are not conserved','Native source is physically sampled without horizontal stretching','Added-detail envelope is a conservative Tuscany-based experiment setting, not a geology calibration','No erosion conditioning after anchoring; routing heads remain separate from ground']};
}

/** Adopt one immutable full-domain proposal; callers may use a coarser native
 * source to bridge broad gaps. No implicit metric stretching or resampling. */
export function fixedDetailSource({grid,elevation,widthM,heightM,offsetXM=0,offsetYM=0,provenance=null}){
 const g={...grid,cellSizeYM:grid?.cellSizeYM??grid?.cellSizeM},n=g.columns*g.rows;
 if(!Number.isSafeInteger(g.columns)||!Number.isSafeInteger(g.rows)||g.columns<3||g.rows<3||n>32768||!Array.isArray(elevation)||elevation.length!==n||!elevation.every(Number.isFinite)||![g.cellSizeM,g.cellSizeYM,widthM,heightM].every(v=>Number.isFinite(v)&&v>0)||![offsetXM,offsetYM].every(v=>Number.isFinite(v)&&v>=0)||offsetXM+widthM>(g.columns-1)*g.cellSizeM+1e-7||offsetYM+heightM>(g.rows-1)*g.cellSizeYM+1e-7)throw Error('Bounded fixed physical detail source required');
 const content={schema:'shared-native-detail@1',grid:g,elevation:[...elevation],widthM,heightM,offsetXM,offsetYM,provenance};return {...content,id:hashJson(copyJson(content))};
}

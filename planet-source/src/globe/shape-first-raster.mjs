import {sampleShapeHeight} from './shape-first-model.mjs';
/** Fixed shared palette and lighting; never changes source elevations. */
export function shapeFirstRaster(model,tile,levelIndex,{maxDimension=640}={}) {
  if(!Number.isSafeInteger(maxDimension)||maxDimension<8||maxDimension>2048)throw new RangeError('Raster dimension must be 8..2048');
  const level=tile.levels[levelIndex],whole=model.levels[levelIndex];
  if(!level||!whole)throw new RangeError('Unknown shape-first level');
  const width=Math.ceil(maxDimension*tile.extent.widthM/model.extent.widthM),height=Math.ceil(maxDimension*tile.extent.heightM/model.extent.heightM);
  const data=new Uint8ClampedArray(width*height*4),range=Math.max(1,model.maxElevationM-model.minElevationM);
  const palette=[[50,93,73],[148,161,116],[185,174,131],[226,223,201]];
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const xm=(x+.5)/width*tile.extent.widthM,ym=(y+.5)/height*tile.extent.heightM,gx=xm+tile.originM.xM,gy=ym+tile.originM.yM;
    const h=sampleShapeHeight(level,xm,ym),dx=whole.grid.cellSizeM/2,dy=whole.grid.cellSizeYM/2;
    const sx=(sampleShapeHeight(whole,gx+dx,gy)-sampleShapeHeight(whole,gx-dx,gy))/(2*dx)*2,sy=(sampleShapeHeight(whole,gx,gy+dy)-sampleShapeHeight(whole,gx,gy-dy))/(2*dy)*2;
    const light=Math.max(.35,Math.min(1.25,.48+.72*(.45*sx+.5*sy+.74)/Math.hypot(sx,sy,1)));
    const t=Math.max(0,Math.min(2.999999,(h-model.minElevationM)/range*3)),i=Math.floor(t),f=t-i,k=(y*width+x)*4;
    for(let c=0;c<3;c++)data[k+c]=Math.min(255,(palette[i][c]*(1-f)+palette[i+1][c]*f)*light);data[k+3]=255;
  }
  return {width,height,data};
}

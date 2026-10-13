import {meshHeightLifts,displayNormal} from './height-exaggeration.mjs';
import {mapColorAt,screenContourFactor} from './thematic-map.mjs';
/** Diagnostic CPU rasterizer for machines without WebGL. Shares the exact
 * generated meshes and camera; intentionally not a GPU performance substitute. */
/** The diagnostic image has a bounded physical framebuffer, independently of
 * the CSS size used to display it. LOD must use the pixels actually rendered. */
export function softwareViewportSize(cw,ch,{scale=.35,maxDimension=420}={}){
  if(!Number.isFinite(scale)||scale<=0||scale>1||!Number.isSafeInteger(maxDimension)||maxDimension<160||maxDimension>2048)throw new RangeError('Invalid bounded software resolution');
  if(!Number.isFinite(cw)||!Number.isFinite(ch)||cw<=0||ch<=0)return [0,0];
  const desiredWidth=Math.min(maxDimension,Math.max(160,Math.round(cw*scale))),desiredHeight=desiredWidth*ch/cw,fit=Math.min(1,maxDimension/desiredHeight);
  return [Math.max(1,Math.round(desiredWidth*fit)),Math.max(1,Math.round(desiredHeight*fit))];
}
export class SoftwareRenderer {
  constructor(canvas,{shading='smooth',now=()=>performance.now(),pixelScale=.35,maxDimension=420}={}){if(!['smooth','flat-legacy'].includes(shading))throw new RangeError('Invalid software shading');if(typeof now!=='function')throw new TypeError('Renderer clock required');softwareViewportSize(1,1,{scale:pixelScale,maxDimension});this.resolution={scale:pixelScale,maxDimension};this.now=now;this.nextDrawAt=-Infinity;this.shading=shading;this.canvas=canvas;this.gl=null;this.ctx=canvas.getContext('2d');if(!this.ctx)throw new Error('Canvas 2D unavailable');this.device='CPU diagnostic rasterizer';this.gpuBytes=0;this.peakGpuBytes=0;this.allocations=0;this.deletions=0;this.lost=false;this.timer=null;this.pendingQueries=[];this.gpuMs=null;this.lastTime=-Infinity;this.renderTimes=[];this.renderCount=0;}
  upload(mesh){if(this.radiusM){mesh.heightLifts??=meshHeightLifts(mesh.vertex,mesh.anchor,this.radiusM);mesh.overlayHeightLifts??=meshHeightLifts(mesh.overlayVertex,mesh.anchor,this.radiusM);}const bytes=(mesh.heightLifts?.byteLength??0)+(mesh.overlayHeightLifts?.byteLength??0)+(mesh.edgeMask?.byteLength??0)+mesh.vertex.byteLength+mesh.index.byteLength+mesh.overlayVertex.byteLength+mesh.overlayIndex.byteLength;this.gpuBytes+=bytes;this.peakGpuBytes=Math.max(this.peakGpuBytes,this.gpuBytes);this.allocations++;return {...mesh,bytes,branchMorph:0,ground:{count:mesh.index.length},overlay:mesh.overlayIndex.length?{count:mesh.overlayIndex.length}:null};}
  dispose(tile){this.gpuBytes-=tile.bytes;this.deletions++;this.frameTiles=null;}
  draw(camera,tiles,time){
    const sun=camera.sun??[-.35,.45,.82], shade=v=>camera.sun?.length===3 ? .08+.92*Math.max(0,v) : .42+.58*Math.abs(v);
    const canvas=this.canvas,cw=canvas.clientWidth,ch=canvas.clientHeight;
    if(!Number.isFinite(cw)||!Number.isFinite(ch)||cw<=0||ch<=0)return {drawTiles:0,triangles:0,gpuMs:null,viewport:[0,0],renderer:'software-diagnostic',renderCount:this.renderCount,drawFPS:0,suspended:true};
    if(time<this.nextDrawAt&&this.result)return this.result;this.lastTime=time;const drawStarted=this.now();
    const [w,h]=softwareViewportSize(cw,ch,this.resolution);
    const cameraKey=JSON.stringify([w,h,camera.eye,camera.right,camera.up,camera.forward,camera.near,camera.focal,camera.sun,camera.thematicMap?.key,camera.contourInterval,camera.heightScale]);
    if(this.shading!=='flat-legacy'&&this.frameCameraKey===cameraKey&&this.frameTiles?.length===tiles.length&&tiles.every((e,i)=>{
      const previous=this.frameTiles[i];return previous.tile===e.tile&&previous.morph===e.morph&&previous.stitchMask===(e.stitchMask??0);
    }))return this.result={...this.result,cachedFrame:true,drawFPS:0};
    this.frameCameraKey=cameraKey;this.frameTiles=tiles.map(e=>({tile:e.tile,morph:e.morph,stitchMask:e.stitchMask??0}));
    this.renderTimes.push(time);this.renderTimes=this.renderTimes.filter(t=>time-t<=2000);this.renderCount++;
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    // Reuse bounded framebuffer storage until the viewport changes. Per-frame
    // image/depth allocations caused avoidable garbage-collection pressure.
    if(!this.pixels||this.bufferWidth!==w||this.bufferHeight!==h){this.pixels=this.ctx.createImageData(w,h);this.depth=new Float64Array(w*h);this.bufferWidth=w;this.bufferHeight=h;}
    const pixels=this.pixels,data=pixels.data,depth=this.depth;depth.fill(Infinity);
    for(let i=0;i<data.length;i+=4){data[i]=4;data[i+1]=7;data[i+2]=13;data[i+3]=255;}
    const frustumX=w/h/camera.focal,frustumY=1/camera.focal;let triangles=0;
    const outside=(a,b,c)=>
      (a[2]<camera.near&&b[2]<camera.near&&c[2]<camera.near)||
      (a[0]<-a[2]*frustumX&&b[0]<-b[2]*frustumX&&c[0]<-c[2]*frustumX)||
      (a[0]>a[2]*frustumX&&b[0]>b[2]*frustumX&&c[0]>c[2]*frustumX)||
      (a[1]<-a[2]*frustumY&&b[1]<-b[2]*frustumY&&c[1]<-c[2]*frustumY)||
      (a[1]>a[2]*frustumY&&b[1]>b[2]*frustumY&&c[1]>c[2]*frustumY);
    const raster=(points,color,screenPoints=null)=>{
      const smooth=this.shading==='smooth';
      // Near-plane clipping in camera space avoids holes at ground level.
      let poly=points.every(p=>p[2]>=camera.near)?points:[];
      if(poly!==points)for(let k=0;k<3;k++){const a=points[k],b=points[(k+1)%3],ia=a[2]>=camera.near,ib=b[2]>=camera.near;if(ia)poly.push(a);if(ia!==ib){const t=(camera.near-a[2])/(b[2]-a[2]);poly.push(a.map((v,i)=>v+(b[i]-v)*t));}}
      if(poly.length<3)return;
      const project=p=>[(p[0]*camera.focal/(w/h)/p[2]+1)*w*.5,(1-p[1]*camera.focal/p[2])*h*.5,1/p[2],...p.slice(3).map(v=>v/p[2])];
      poly=screenPoints??poly.map(project);
      const red=Math.round(255*Math.max(0,Math.min(1,color[0]))),green=Math.round(255*Math.max(0,Math.min(1,color[1]))),blue=Math.round(255*Math.max(0,Math.min(1,color[2])));
      for(let k=1;k<poly.length-1;k++){
        const [a,b,c]=[poly[0],poly[k],poly[k+1]],edge=(p,q,x,y)=>(q[0]-p[0])*(y-p[1])-(q[1]-p[1])*(x-p[0]),area=edge(a,b,c[0],c[1]);if(Math.abs(area)<1e-8)continue;
        // Independent Float32 tile anchors can straddle an exact pixel centre.
        // Cover only subpixel roundoff (0.0001 px), never a visible terrain gap.
        const tolerance=smooth?1e-4/Math.abs(area):0,ea=tolerance*Math.hypot(b[0]-c[0],b[1]-c[1]),eb=tolerance*Math.hypot(c[0]-a[0],c[1]-a[1]),ec=tolerance*Math.hypot(a[0]-b[0],a[1]-b[1]);
        const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(w-1,Math.ceil(Math.max(a[0],b[0],c[0]))),y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(h-1,Math.ceil(Math.max(a[1],b[1],c[1])));
        const dax=(b[1]-c[1])/area,dbx=(c[1]-a[1])/area,day=(c[0]-b[0])/area,dby=(a[0]-c[0])/area,hnx=dax*(a[9]-c[9])+dbx*(b[9]-c[9]),hny=day*(a[9]-c[9])+dby*(b[9]-c[9]),dnx=dax*(a[2]-c[2])+dbx*(b[2]-c[2]),dny=day*(a[2]-c[2])+dby*(b[2]-c[2]);
        for(let y=y0;y<=y1;y++){const rowA=edge(b,c,x0+.5,y+.5)/area,rowB=edge(c,a,x0+.5,y+.5)/area;for(let x=x0;x<=x1;x++){const wa=smooth?rowA+(x-x0)*dax:edge(b,c,x+.5,y+.5)/area,wb=smooth?rowB+(x-x0)*dbx:edge(c,a,x+.5,y+.5)/area,wc=1-wa-wb;if(wa < -ea||wb < -eb||wc < -ec)continue;const z=1/(wa*a[2]+wb*b[2]+wc*c[2]),i=y*w+x;if(z>=depth[i])continue;depth[i]=z;const pixel=i*4;if(!smooth){data[pixel]=red;data[pixel+1]=green;data[pixel+2]=blue;}
          else {const nx=(wa*a[6]+wb*b[6]+wc*c[6])*z,ny=(wa*a[7]+wb*b[7]+wc*c[7])*z,nz=(wa*a[8]+wb*b[8]+wc*c[8])*z;
            const normalLength=Math.hypot(nx,ny,nz),rawLight=shade(normalLength?(sun[0]*nx+sun[1]*ny+sun[2]*nz)/normalLength:0),height=(wa*a[9]+wb*b[9]+wc*c[9])*z,
            light=(camera.thematicMap?.65+.35*rawLight:rawLight)*screenContourFactor(height,camera.contourInterval,(Math.abs(hnx-height*dnx)+Math.abs(hny-height*dny))*z);
            let mapped=null;if(camera.thematicMap){const vx=((x+.5)/w*2-1)*z*(w/h)/camera.focal,vy=(1-(y+.5)/h*2)*z/camera.focal;const wp=camera.eye.map((e,k)=>e+camera.right[k]*vx+camera.up[k]*vy+camera.forward[k]*z);mapped=mapColorAt(camera.thematicMap,...wp);}
            for(let channel=0;channel<3;channel++){const value=(mapped?mapped[channel]:(wa*a[3+channel]+wb*b[3+channel]+wc*c[3+channel])*z)*light;data[pixel+channel]=Math.round(255*Math.max(0,Math.min(1,value)));}}
}}
        triangles++;
      }
    };
    for(const {tile,morph,stitchMask=0} of tiles){const offset=tile.anchor.map((v,i)=>v-camera.eye[i]);
      const draw=(vertices,indices,m,edges=null,contours=true,lifts=null)=>{
        // Reuse one per-draw scratch pool across every mesh rather than allocate
        // multiple short-lived arrays for every visible vertex on every frame.
        const projected=this.projected??(this.projected=[]),count=vertices.length/12;
        while(projected.length<count)projected.push(new Float64Array(10));
        const screen=this.screenProjected??(this.screenProjected=[]);
        while(screen.length<count)screen.push(new Float64Array(10));
        for(let i=0,j=0;i<vertices.length;i+=12,j++){
          const blend=((edges?.[j]??0)&stitchMask)?0:m,extra=(camera.heightScale??1)-1,lift=k=>lifts?extra*(lifts[j*6+k+3]*(1-blend)+lifts[j*6+k]*blend):0,x=vertices[i+3]*(1-blend)+vertices[i]*blend+offset[0]+lift(0),y=vertices[i+4]*(1-blend)+vertices[i+1]*blend+offset[1]+lift(1),z=vertices[i+5]*(1-blend)+vertices[i+2]*blend+offset[2]+lift(2),p=projected[j];
          p[0]=x*camera.right[0]+y*camera.right[1]+z*camera.right[2];p[1]=x*camera.up[0]+y*camera.up[1]+z*camera.up[2];p[2]=x*camera.forward[0]+y*camera.forward[1]+z*camera.forward[2];
          for(let k=3;k<9;k++)p[k]=vertices[i+k+3];
          const wx=vertices[i]+tile.anchor[0],wy=vertices[i+1]+tile.anchor[1],wz=vertices[i+2]+tile.anchor[2];
          if(extra){const len=Math.hypot(wx,wy,wz),n=displayNormal([p[6],p[7],p[8]],[wx/len,wy/len,wz/len],camera.heightScale);p.set(n,6);}
          p[9]=contours?Math.hypot(wx,wy,wz)-(camera.radiusM??0):-1;
          if(camera.thematicMap){const color=mapColorAt(camera.thematicMap,wx,wy,wz);for(let k=0;k<3;k++)p[3+k]=color[k];}
          if(this.shading==='smooth'&&p[2]>=camera.near){
            const q=screen[j];q[0]=(p[0]*camera.focal/(w/h)/p[2]+1)*w*.5;q[1]=(1-p[1]*camera.focal/p[2])*h*.5;q[2]=1/p[2];
            for(let k=3;k<10;k++)q[k]=p[k]/p[2];
          }
        }
        for(let i=0;i<indices.length;i+=3){const a=indices[i],p=projected[a],q=projected[indices[i+1]],r=projected[indices[i+2]];
          // Reject before clipping/projection/color allocations. Preserve the
          // legacy triangle-count witnesses in the explicit old shading mode.
          if(this.shading!=='flat-legacy'&&outside(p,q,r))continue;
          const base=a*12,light=shade(sun[0]*vertices[base+9]+sun[1]*vertices[base+10]+sun[2]*vertices[base+11]);
          const screenPoints=this.shading==='smooth'&&p[2]>=camera.near&&q[2]>=camera.near&&r[2]>=camera.near?[screen[a],screen[indices[i+1]],screen[indices[i+2]]]:null;
          raster([p,q,r],[vertices[base+6]*light,vertices[base+7]*light,vertices[base+8]*light],screenPoints);}
      };
      draw(tile.vertex,tile.index,morph,tile.edgeMask,true,tile.heightLifts);const surfaceIndices=morph>.99?tile.overlayIndex:tile.overlayIndex.subarray(0,tile.waterIndexCount??0);if(surfaceIndices.length)draw(tile.overlayVertex,surfaceIndices,1,null,false,tile.overlayHeightLifts);
    }
    this.ctx.putImageData(pixels,0,0);const drawCpuMs=Math.max(0,this.now()-drawStarted);
    // Keep UI time available: target up to 30 actual CPU frames/s, but yield
    // at least the previous raster cost again. Legacy witnesses retain 180ms.
    this.nextDrawAt=time+(this.shading==='flat-legacy'?180:Math.max(1000/30,drawCpuMs*2));
    return this.result={drawTiles:tiles.length,triangles,gpuMs:null,viewport:[w,h],renderer:'software-diagnostic',drawCpuMs,drawIntervalMs:this.nextDrawAt-time,renderCount:this.renderCount,drawFPS:this.renderTimes.length>1?(this.renderTimes.length-1)*1000/(time-this.renderTimes[0]):0};
  }
  destroy(){this.frameTiles=null;this.frameCameraKey=null;this.projected=null;this.screenProjected=null;this.pixels=null;this.depth=null;this.result=null;this.renderTimes.length=0;}
}

/* Selected terrain-only functions from the user-supplied dynamic-world-viewer prototype.
 * Experimental candidate, NOT adopted planet terrain. No settlements, roads,
 * micro scenes, social simulation, or browser code included.
 * Source SHA256 recorded in docs/L1_REGIONAL_DESIGN.md.
 * Kept original algorithm to evaluate quality before imposing world contracts. */
const TAU=Math.PI*2;

const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));

const lerp=(a,b,t)=>a+(b-a)*t;

function hash32(text){let h=2166136261>>>0;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);h^=h>>>16;return h>>>0;}

function rngFrom(seed){let s=hash32(String(seed))||1;return()=>{s|=0;s=(s+0x6D2B79F5)|0;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}

function smooth(t){return t*t*(3-2*t);}

function lattice(seed,label,x,y){return (hash32(`${seed}|${label}|${x}|${y}`)&0xffffff)/0xffffff;}

function valueNoise(seed,label,x,y,scale=1){const gx=x/scale,gy=y/scale,x0=Math.floor(gx),y0=Math.floor(gy),tx=smooth(gx-x0),ty=smooth(gy-y0);const a=lerp(lattice(seed,label,x0,y0),lattice(seed,label,x0+1,y0),tx),b=lerp(lattice(seed,label,x0,y0+1),lattice(seed,label,x0+1,y0+1),tx);return lerp(a,b,ty)*2-1;}

function fbm(seed,label,x,y,base=64,octaves=4){let amp=1,sum=0,norm=0,scale=base;for(let i=0;i<octaves;i++){sum+=valueNoise(seed,`${label}.${i}`,x,y,scale)*amp;norm+=amp;amp*=.5;scale*=.5;}return sum/norm;}

function idx(x,y,w){return y*w+x;}

function xy(i,w){return [i%w,Math.floor(i/w)];}

const D8=[[-1,-1,Math.SQRT2],[0,-1,1],[1,-1,Math.SQRT2],[-1,0,1],[1,0,1],[-1,1,Math.SQRT2],[0,1,1],[1,1,Math.SQRT2]];

const ROAD_K16=[...D8,...[[-2,-1,Math.sqrt(5)],[-1,-2,Math.sqrt(5)],[1,-2,Math.sqrt(5)],[2,-1,Math.sqrt(5)],[2,1,Math.sqrt(5)],[1,2,Math.sqrt(5)],[-1,2,Math.sqrt(5)],[-2,1,Math.sqrt(5)]]];

class MinHeap{
  constructor(){this.a=[];}
  get size(){return this.a.length;}
  push(item,score){const n={item,score};this.a.push(n);let i=this.a.length-1;while(i>0){const p=(i-1)>>1;if(this.a[p].score<=score)break;this.a[i]=this.a[p];i=p;}this.a[i]=n;}
  pop(){if(!this.a.length)return null;const root=this.a[0],last=this.a.pop();if(this.a.length){let i=0;while(true){let l=i*2+1,r=l+1;if(l>=this.a.length)break;let c=r<this.a.length&&this.a[r].score<this.a[l].score?r:l;if(this.a[c].score>=last.score)break;this.a[i]=this.a[c];i=c;}this.a[i]=last;}return root;}
}

function pointSegmentDistance(px,py,a,b){const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy||1,t=clamp(((px-a.x)*dx+(py-a.y)*dy)/d),qx=a.x+dx*t,qy=a.y+dy*t;return{distance:Math.hypot(px-qx,py-qy),t,x:qx,y:qy};}

function ridgeDistance(px,py,points){let best={distance:Infinity,along:0,signed:0,tx:1,ty:0};let walked=0,total=0;const lens=[];for(let i=1;i<points.length;i++){const d=Math.hypot(points[i].x-points[i-1].x,points[i].y-points[i-1].y);lens.push(d);total+=d;}for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],q=pointSegmentDistance(px,py,a,b),along=(walked+q.t*lens[i-1])/Math.max(1,total),len=lens[i-1]||1,tx=(b.x-a.x)/len,ty=(b.y-a.y)/len,signed=tx*(py-q.y)-ty*(px-q.x);if(q.distance<best.distance)best={...q,along,signed,tx,ty};walked+=lens[i-1];}return best;}

function makeRidges(seed,w,h,cell){
  // v0.5: coherent curved orogenic belts rather than a handful of straight Gaussian bars.
  // The belt is only an uplift prior; fluvial incision still determines the final valleys.
  const rng=rngFrom(`${seed}|orogenic-belts`),rows=[],W=w*cell,H=h*cell,diag=Math.hypot(W,H);
  const beltCount=2;
  for(let bi=0;bi<beltCount;bi++){
    const angle=(.10+rng()*.80)*Math.PI,cx=(.32+rng()*.36)*W,cy=(.25+rng()*.50)*H,len=diag*(bi===0?.92:.68),ux=Math.cos(angle),uy=Math.sin(angle),nx=-uy,ny=ux,knots=bi===0?11:8,phase=rng()*TAU,curveAmp=(bi===0?.070:.095)*diag;
    const points=[];
    for(let k=0;k<knots;k++){const t=k/(knots-1),along=(t-.5)*len,arc=Math.sin(t*Math.PI)*Math.sin(t*TAU*(.52+rng()*.16)+phase)*curveAmp,slow=fbm(seed,`orogen.${bi}.curve`,t*1000,bi*101,410,3)*curveAmp*.34;points.push({x:cx+ux*along+nx*(arc+slow),y:cy+uy*along+ny*(arc+slow)});}
    const massifCount=bi===0?5:4,massifs=[];
    for(let mi=0;mi<massifCount;mi++)massifs.push({center:(mi+.45+rng()*.16)/massifCount,sigma:.038+rng()*.048,amp:.68+rng()*.58});
    rows.push({id:`belt.${bi+1}`,points,height:bi===0?360+rng()*150:220+rng()*140,width:bi===0?900+rng()*430:640+rng()*380,kind:'belt',massifs});
    const spurCount=bi===0?4:2;
    for(let si=0;si<spurCount;si++){const ki=1+Math.floor(rng()*(knots-3)),a=points[ki],b=points[ki+1],tx=b.x-a.x,ty=b.y-a.y,tl=Math.hypot(tx,ty)||1,sx=tx/tl,sy=ty/tl,sign=rng()<.5?-1:1,branchAngle=sign*(.42+rng()*.42),vx=sx*Math.cos(branchAngle)-sy*Math.sin(branchAngle),vy=sx*Math.sin(branchAngle)+sy*Math.cos(branchAngle),spurLen=diag*(.13+rng()*.12),sp=[];for(let k=0;k<5;k++){const t=k/4,bend=Math.sin(t*Math.PI)*fbm(seed,`orogen.${bi}.spur.${si}`,t*500,si*91,220,2)*spurLen*.10;sp.push({x:a.x+vx*spurLen*t-vy*bend,y:a.y+vy*spurLen*t+vx*bend});}rows.push({id:`spur.${bi+1}.${si+1}`,points:sp,height:150+rng()*150,width:260+rng()*260,kind:'spur'});}
  }
  return rows;
}

function priorityFlood(elev,w,h){const out=new Float64Array(elev),seen=new Uint8Array(w*h),heap=new MinHeap();const add=(x,y)=>{const i=idx(x,y,w);if(seen[i])return;seen[i]=1;heap.push(i,out[i]);};for(let x=0;x<w;x++){add(x,0);add(x,h-1);}for(let y=1;y<h-1;y++){add(0,y);add(w-1,y);}while(heap.size){const cur=heap.pop(),i=cur.item,[x,y]=xy(i,w),z=out[i];for(const [dx,dy] of D8){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=idx(nx,ny,w);if(seen[ni])continue;seen[ni]=1;if(out[ni]<=z)out[ni]=z+1e-4;heap.push(ni,out[ni]);}}return out;}

function flowField(elev,rain,w,h,cell){
  // Tarboton D-infinity motivates this angular two-receiver routing: use the local
  // downslope vector to split contributing area between its two bracketing D8
  // neighbours instead of forcing all area into one of eight directions. This is a
  // reduced implementation, not a claim of reproducing Tarboton's facet solver.
  const receiver=new Int32Array(w*h),receiver2=new Int32Array(w*h),weight1=new Float64Array(w*h),weight2=new Float64Array(w*h),slope=new Float64Array(w*h);receiver.fill(-1);receiver2.fill(-1);
  const dirs=D8.map(([dx,dy,d],di)=>({dx,dy,d,di,angle:(Math.atan2(dy,dx)+TAU)%TAU})).sort((a,b)=>a.angle-b.angle);
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
    const i=idx(x,y,w),z=elev[i],gx=(elev[idx(x+1,y,w)]-elev[idx(x-1,y,w)])/(2*cell),gy=(elev[idx(x,y+1,w)]-elev[idx(x,y-1,w)])/(2*cell),mag=Math.hypot(gx,gy);let best=-1,bestS=0;
    for(const [dx,dy,d] of D8){const ni=idx(x+dx,y+dy,w),ss=(z-elev[ni])/(cell*d);if(ss>bestS){bestS=ss;best=ni;}}
    slope[i]=bestS;if(best<0)continue;
    if(mag<1e-12){receiver[i]=best;weight1[i]=1;continue;}
    const ang=(Math.atan2(-gy,-gx)+TAU)%TAU;let hi=dirs.findIndex(q=>q.angle>=ang);if(hi<0)hi=0;const lo=(hi-1+dirs.length)%dirs.length,d0=dirs[lo],d1=dirs[hi];let a0=d0.angle,a1=d1.angle,aa=ang;if(lo>hi){a1+=TAU;if(aa<a0)aa+=TAU;}const span=Math.max(1e-9,a1-a0),t=clamp((aa-a0)/span),n0=idx(x+d0.dx,y+d0.dy,w),n1=idx(x+d1.dx,y+d1.dy,w),s0=(z-elev[n0])/(cell*d0.d),s1=(z-elev[n1])/(cell*d1.d);
    let w0=s0>0?(1-t)*s0:0,w1=s1>0?t*s1:0;if(w0+w1<1e-12){receiver[i]=best;weight1[i]=1;continue;}const norm=w0+w1;w0/=norm;w1/=norm;if(w1>w0){receiver[i]=n1;weight1[i]=w1;if(w0>1e-6){receiver2[i]=n0;weight2[i]=w0;}}else{receiver[i]=n0;weight1[i]=w0;if(w1>1e-6){receiver2[i]=n1;weight2[i]=w1;}}
  }
  const order=Array.from({length:w*h},(_,i)=>i).sort((a,b)=>elev[b]-elev[a]||a-b),accum=new Float64Array(w*h);for(let i=0;i<accum.length;i++)accum[i]=Math.max(.05,rain[i]);for(const i of order){const r=receiver[i],r2=receiver2[i];if(r>=0)accum[r]+=accum[i]*(weight1[i]||1);if(r2>=0)accum[r2]+=accum[i]*weight2[i];}return{receiver,receiver2,weight1,weight2,slope,accum};}

function terrainSlopeField(elev,w,h,cell){const out=new Float64Array(w*h);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const gx=(elev[idx(x+1,y,w)]-elev[idx(x-1,y,w)])/(2*cell),gy=(elev[idx(x,y+1,w)]-elev[idx(x,y-1,w)])/(2*cell);out[idx(x,y,w)]=Math.hypot(gx,gy);}for(let x=0;x<w;x++){out[idx(x,0,w)]=out[idx(x,1,w)];out[idx(x,h-1,w)]=out[idx(x,h-2,w)];}for(let y=0;y<h;y++){out[idx(0,y,w)]=out[idx(1,y,w)];out[idx(w-1,y,w)]=out[idx(w-2,y,w)];}return out;}

function thermalRelax(elev,w,h,cell,iterations=1){const z=new Float64Array(elev),talus=.55;for(let it=0;it<iterations;it++){const delta=new Float64Array(z.length);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=idx(x,y,w);for(const [dx,dy,d] of D8.slice(0,4)){const ni=idx(x+dx,y+dy,w),limit=talus*cell*d,diff=z[i]-z[ni];if(Math.abs(diff)>limit){const excess=(Math.abs(diff)-limit)*.06*Math.sign(diff);delta[i]-=excess;delta[ni]+=excess;}}}for(let i=0;i<z.length;i++)z[i]+=delta[i];}return z;}

function distanceTransform(mask,w,h){const inf=1e9,d=new Float64Array(w*h);for(let i=0;i<d.length;i++)d[i]=mask[i]?0:inf;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=idx(x,y,w);if(x)d[i]=Math.min(d[i],d[i-1]+1);if(y)d[i]=Math.min(d[i],d[i-w]+1);if(x&&y)d[i]=Math.min(d[i],d[i-w-1]+Math.SQRT2);if(x<w-1&&y)d[i]=Math.min(d[i],d[i-w+1]+Math.SQRT2);}for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=idx(x,y,w);if(x<w-1)d[i]=Math.min(d[i],d[i+1]+1);if(y<h-1)d[i]=Math.min(d[i],d[i+w]+1);if(x<w-1&&y<h-1)d[i]=Math.min(d[i],d[i+w+1]+Math.SQRT2);if(x&&y<h-1)d[i]=Math.min(d[i],d[i+w-1]+Math.SQRT2);}return d;}

function makeInitialElevation(seed,w,h,cell){const ridges=makeRidges(seed,w,h,cell),e=new Float64Array(w*h),rain=new Float64Array(w*h);for(let y=0;y<h;y++)for(let x=0;x<w;x++){const wx=x*cell,wy=y*cell,warpX=fbm(seed,'warp.x',wx,wy,2450,3)*310,warpY=fbm(seed,'warp.y',wx,wy,2450,3)*310;let z=72+(1-y/(h-1))*72+(1-x/(w-1))*18;for(const r of ridges){const q=ridgeDistance(wx+warpX,wy+warpY,r.points),along=q.along,baseWidth=r.width*(.76+.24*(.5+.5*fbm(seed,`${r.id}.width`,along*1800,0,540,2))),sidePhase=fbm(seed,`${r.id}.foreland`,along*1200,71,390,2),foreland=q.signed>=0?(0.70+.14*(.5+.5*sidePhase)):(1.10+.18*(.5-.5*sidePhase)),width=baseWidth*foreland,amp=r.height*(.66+.34*(.5+.5*fbm(seed,`${r.id}.height`,along*1700,33,430,3))),massifNoise=Math.pow(.5+.5*fbm(seed,`${r.id}.massif`,along*3600,17,330,4),1.35),massifLobeSum=r.massifs?.length?r.massifs.reduce((acc,m)=>acc+m.amp*Math.exp(-Math.pow(along-m.center,2)/(2*m.sigma*m.sigma)),0):massifNoise,saddles=.68+.38*Math.pow(.5+.5*fbm(seed,`${r.id}.saddles`,along*4700,93,290,3),1.15),massif=r.kind==='belt'?clamp((.47+Math.min(1.25,massifLobeSum)*.34+massifNoise*.19)*saddles,.34,1.24):(.54+.46*massifNoise),ad=Math.abs(q.distance)/Math.max(1,width),core=Math.exp(-Math.pow(ad,1.34)),shoulder=Math.exp(-Math.pow(ad/2.05,1.18)),fold=.86+.20*(.5+.5*fbm(seed,`${r.id}.fold`,wx+warpX*.3,wy+warpY*.3,520,4));z+=amp*massif*(core*.74+shoulder*.26)*fold;}
    const continental=fbm(seed,'continental.relief',wx,wy,3600,4)*52,meso=fbm(seed,'meso.relief',wx+warpX*.25,wy+warpY*.25,920,5)*32,rough=fbm(seed,'rough',wx-warpY*.12,wy+warpX*.12,310,3)*7;z+=continental+meso+rough;const edge=Math.min(x,y,w-1-x,h-1-y);/* No artificial low moat at all four array edges. */e[idx(x,y,w)]=z;rain[idx(x,y,w)]=clamp(.70+fbm(seed,'rain',wx,wy,2600,4)*.28+(y/h-.5)*.08,.15,1.25);}return{e,rain,ridges};}

function erodeTerrain(seed,elev,rain,w,h,cell){let z=new Float64Array(elev);for(let it=0;it<14;it++){const filled=priorityFlood(z,w,h),flow=flowField(filled,rain,w,h,cell),next=new Float64Array(z);let maxA=1;for(const a of flow.accum)maxA=Math.max(maxA,a);const logMax=Math.log1p(maxA);for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=idx(x,y,w),rawA=flow.accum[i],a=clamp((Math.log1p(rawA)-Math.log(2))/Math.max(.1,logMax-Math.log(2))),s=flow.slope[i],channel=clamp((Math.log1p(rawA)-Math.log(5))/(Math.log(150)-Math.log(5))),k=.38;next[i]-=k*Math.pow(a,.62)*Math.pow(Math.max(0,s),.72)*cell*(.18+.82*channel);}
    z=thermalRelax(next,w,h,cell,1);
  }return z;}

function normalizeField(a){let lo=Infinity,hi=-Infinity;for(const v of a){lo=Math.min(lo,v);hi=Math.max(hi,v);}const out=new Float64Array(a.length),d=hi-lo||1;for(let i=0;i<a.length;i++)out[i]=(a[i]-lo)/d;return{values:out,lo,hi};}

function blurField(a,w,h,passes=2){
  // Small separable-like neighbourhood relaxation.  The purpose is not to erase
  // massif structure, but to remove the 60 m solver lattice before the continuous
  // drainage graph is carved back into the surface.
  let cur=new Float64Array(a);
  for(let pass=0;pass<passes;pass++){
    const next=new Float64Array(cur.length);
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const i=idx(x,y,w);let sum=cur[i]*4,wt=4;
      for(const [dx,dy,d] of D8){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const q=d===1?2:1;sum+=cur[idx(nx,ny,w)]*q;wt+=q;}
      next[i]=sum/wt;
    }
    cur=next;
  }
  return cur;
}

function graphDistanceField(world,graph,maxCells=15){
  // v0.18: continuous channel-distance field.  v0.16 propagated distance through a
  // K16 lattice, which was fast but could imprint Voronoi/facet structure into the
  // visible hillslopes when graph morphology was given more authority.  Here the
  // drainage graph is sampled densely in continuous metres, indexed into coarse
  // buckets, and each Regional cell measures Euclidean distance to nearby channel
  // samples.  The graph remains the topology source; this is only a smooth geometry
  // support field for valley/hillslope reconstruction.
  const {w,h,cell}=world,n=w*h,dist=new Float64Array(n),flow=new Float64Array(n),channelZ=new Float64Array(n),valleyWidth=new Float64Array(n),streamOrder=new Uint8Array(n);dist.fill(Infinity);channelZ.fill(NaN);
  const samples=[],step=Math.max(10,cell*.28),bucketSize=cell*4,buckets=new Map(),key=(bx,by)=>`${bx},${by}`;
  for(const edge of graph.edges){const line=edge.curvePoints??edge.points,pts=samplePolyline(line,step),order=edge.strahlerOrder??1;for(const p of pts){const f=p.flow??edge.flowMax??1,z=sampleRegionalElevation(world,p.x,p.y),sl=world.slope?.[idx(clamp(Math.round(p.x/cell-.5),0,w-1),clamp(Math.round(p.y/cell-.5),0,h-1),w)]??0,ratio=Math.max(1,f/Math.max(1,world.riverThreshold)),flat=1-clamp((sl-.012)/.14),widthCells=clamp(.42+Math.pow(ratio,.46)*.34*(.70+flat*.88)+(order-1)*.14,.42,4.35),q={x:p.x,y:p.y,flow:f,z,widthCells,order};samples.push(q);const bx=Math.floor(p.x/bucketSize),by=Math.floor(p.y/bucketSize),k=key(bx,by),arr=buckets.get(k)??[];arr.push(q);buckets.set(k,arr);}}
  const maxDist=maxCells*cell,reach=Math.ceil(maxDist/bucketSize);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=idx(x,y,w),wx=(x+.5)*cell,wy=(y+.5)*cell,bx=Math.floor(wx/bucketSize),by=Math.floor(wy/bucketSize);let best=Infinity,bestQ=null;
    for(let oy=-reach;oy<=reach;oy++)for(let ox=-reach;ox<=reach;ox++){const arr=buckets.get(key(bx+ox,by+oy));if(!arr)continue;for(const q of arr){const dx=wx-q.x,dy=wy-q.y,d2=dx*dx+dy*dy;if(d2<best){best=d2;bestQ=q;}}}
    if(bestQ&&best<=maxDist*maxDist){dist[i]=Math.sqrt(best);flow[i]=bestQ.flow;channelZ[i]=bestQ.z;valleyWidth[i]=bestQ.widthCells;streamOrder[i]=bestQ.order;}
  }
  return{distance:dist,flow,channelZ,valleyWidth,streamOrder};
}

function distanceFieldWithStrength(mask,strength,w,h){
  const dist=new Float64Array(w*h),outStrength=new Float64Array(w*h),heap=new MinHeap();dist.fill(Infinity);
  for(let i=0;i<mask.length;i++)if(mask[i]){dist[i]=0;outStrength[i]=strength?.[i]??1;heap.push(i,0);}
  while(heap.size){const q=heap.pop(),i=q.item;if(q.score!==dist[i])continue;const [x,y]=xy(i,w);for(const [dx,dy,d] of ROAD_K16){const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;const ni=idx(nx,ny,w),nd=q.score+d;if(nd<dist[ni]){dist[ni]=nd;outStrength[ni]=outStrength[i];heap.push(ni,nd);}}}
  return{distance:dist,strength:outStrength};
}

function buildMajorDivides(world,graph){
  // v0.14: derive catchment hierarchy from Horton-Strahler order instead of a raw
  // flow threshold. Consecutive equal-order edges share a branchId, so one trunk is
  // not accidentally split into many pseudo-catchments. Order-2+ tributary branches
  // and the highest-order trunk then define the major divide skeleton.
  const {w,h,flowReceiver,flowAccum,riverMask}=world,n=w*h,source=new Int32Array(n),sourceStrength=new Float64Array(n);source.fill(-1);
  const maxOrder=Math.max(1,graph.maxStrahlerOrder??1),minOrder=Math.max(2,maxOrder-1),branchMap=new Map(),branchOrders=[];
  const major=graph.edges.filter(e=>(e.strahlerOrder??1)>=minOrder&&e.points.length>=2);
  for(const e of major){let lab=branchMap.get(e.branchId);if(lab===undefined){lab=branchMap.size;branchMap.set(e.branchId,lab);branchOrders[lab]=e.strahlerOrder??1;}else branchOrders[lab]=Math.max(branchOrders[lab]??1,e.strahlerOrder??1);for(const p of e.points){const ci=p.cellIndex;if(ci===undefined)continue;const f=flowAccum[ci];if(f>=sourceStrength[ci]){source[ci]=lab;sourceStrength[ci]=f;}}}
  const catchment=new Int32Array(n);catchment.fill(-2);
  const resolve=start=>{let cur=start,path=[],guard=0,root=-1;while(cur>=0&&catchment[cur]===-2&&guard++<n){if(source[cur]>=0){root=source[cur];break;}path.push(cur);const r=flowReceiver[cur];if(r<0||r===cur){root=-1;break;}cur=r;}if(cur>=0&&catchment[cur]>=-1)root=catchment[cur];for(let k=path.length-1;k>=0;k--)catchment[path[k]]=root;if(start>=0&&source[start]>=0)catchment[start]=source[start];return root;};
  for(let i=0;i<n;i++)resolve(i);
  const riverDist=distanceTransform(riverMask,w,h),boundary=new Uint8Array(n),boundaryStrength=new Float64Array(n);let boundaryCells=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=idx(x,y,w),a=catchment[i];if(a<0||riverDist[i]<2.3)continue;let s=0;for(const [dx,dy] of D8){const b=catchment[idx(x+dx,y+dy,w)];if(b>=0&&b!==a)s=Math.max(s,Math.min(branchOrders[a]??1,branchOrders[b]??1)/maxOrder);}if(s>0){boundary[i]=1;boundaryStrength[i]=s;boundaryCells++;}}
  const field=distanceFieldWithStrength(boundary,boundaryStrength,w,h);
  return{catchment,boundary,distance:field.distance,strength:field.strength,majorEdgeCount:major.length,majorBranchCount:branchMap.size,catchmentCount:branchMap.size,boundaryCells,minOrder,maxOrder};
}

function buildSecondaryDivides(world,graph){
  // v0.18: derive a lower-relief interfluve/spur skeleton from a bounded subset of
  // stable drainage branches.  This is intentionally weaker than the major divide
  // system: its job is to organize rounded uplift masses into tributary-scale spurs,
  // not to create a ridge for every first-order raster channel.
  const {w,h,cell,flowReceiver,flowAccum,riverMask}=world,n=w*h,stats=new Map();
  for(const e of graph.edges){const id=e.branchId??e.id,st=stats.get(id)??{id,order:e.strahlerOrder??1,length:0,flowMax:0,points:[]};st.order=Math.max(st.order,e.strahlerOrder??1);st.flowMax=Math.max(st.flowMax,e.flowMax??0);const pts=e.curvePoints??e.points;for(let i=1;i<pts.length;i++)st.length+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y);st.points.push(...e.points);stats.set(id,st);}
  const branches=[...stats.values()].map(st=>({...st,score:(1+.72*(st.order-1))*Math.log1p(st.flowMax/Math.max(1,world.riverThreshold))*Math.sqrt(Math.max(cell,st.length)/cell)})).filter(st=>st.order>=2||st.length>=cell*4).sort((a,b)=>b.score-a.score).slice(0,48);
  const source=new Int32Array(n),sourceStrength=new Float64Array(n);source.fill(-1);const orderBy=[];
  for(let lab=0;lab<branches.length;lab++){const st=branches[lab];orderBy[lab]=st.order;for(const p of st.points){const ci=p.cellIndex;if(ci===undefined)continue;const f=flowAccum[ci];if(f>=sourceStrength[ci]){source[ci]=lab;sourceStrength[ci]=f;}}}
  const catchment=new Int32Array(n);catchment.fill(-2);const resolve=start=>{let cur=start,path=[],guard=0,root=-1;while(cur>=0&&catchment[cur]===-2&&guard++<n){if(source[cur]>=0){root=source[cur];break;}path.push(cur);const r=flowReceiver[cur];if(r<0||r===cur){root=-1;break;}cur=r;}if(cur>=0&&catchment[cur]>=-1)root=catchment[cur];for(let k=path.length-1;k>=0;k--)catchment[path[k]]=root;if(start>=0&&source[start]>=0)catchment[start]=source[start];return root;};
  for(let i=0;i<n;i++)resolve(i);
  const riverDist=distanceTransform(riverMask,w,h),boundary=new Uint8Array(n),strength=new Float64Array(n);let boundaryCells=0;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=idx(x,y,w),a=catchment[i];if(a<0||riverDist[i]<1.7)continue;let s=0;for(const [dx,dy] of D8){const b=catchment[idx(x+dx,y+dy,w)];if(b>=0&&b!==a){const oa=orderBy[a]??1,ob=orderBy[b]??1;s=Math.max(s,.24+.18*Math.min(oa,ob));}}if(s>0){boundary[i]=1;strength[i]=clamp(s,.20,.68);boundaryCells++;}}
  const field=distanceFieldWithStrength(boundary,strength,w,h);return{catchment,boundary,distance:field.distance,strength:field.strength,branchCount:branches.length,boundaryCells};
}

function graphMorphologyTerrain(seed,initial,eroded,preWorld){
  // v0.18: drainage-competition mountain reconstruction. The prescribed orogenic
  // surface is retained as a broad tectonic boundary condition, while the visible
  // meso-scale landform is increasingly determined by continuous distance to the
  // drainage graph, channel base level, Strahler hierarchy, and divide/spur fields.
  // This is inspired by stream-power + hillslope-diffusion landscape evolution, but
  // remains a bounded deterministic proxy suitable for interactive world generation.
  const {w,h,cell}=preWorld,
    discovery=blurField(eroded,w,h,28),
    uplift=blurField(initial,w,h,10),
    g=graphDistanceField(preWorld,preWorld.riverGraph,18),
    divide=preWorld.majorDivides?.distance,divideStrength=preWorld.majorDivides?.strength,
    secondaryDivide=preWorld.secondaryDivides?.distance,secondaryStrength=preWorld.secondaryDivides?.strength,
    out=new Float64Array(eroded.length),uNorm=normalizeField(uplift).values;
  let maxFlow=1;for(const v of g.flow)maxFlow=Math.max(maxFlow,v);const logMax=Math.log1p(maxFlow);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=idx(x,y,w),wx=(x+.5)*cell,wy=(y+.5)*cell,
      fn=g.flow[i]>0?clamp(Math.log1p(g.flow[i])/logMax):0,
      d=Number.isFinite(g.distance[i])?g.distance[i]/cell:99,un=uNorm[i],order=g.streamOrder?.[i]??1,
      floorWidth=Math.max(.42,g.valleyWidth?.[i]??(.72+fn*2.1)),
      inheritedResidual=Math.max(0,initial[i]-uplift[i]),
      longAsym=fbm(seed,'v17.hillslope.asymmetry',wx,wy,1700,3)*(1-Math.exp(-d/4.5))*1.8,
      base=uplift[i]*.72+discovery[i]*.28+inheritedResidual*.07+longAsym;
    let shaped=base;
    if(Number.isFinite(g.channelZ[i])&&d<18){
      // Build a continuous valley-to-interfluve profile from channel base level.
      // Low-gradient/high-discharge trunks receive a wider alluvial floor; relief
      // rises concave-up through the footslope and then more slowly toward divides.
      const floor=Math.max(.48,floorWidth*.76),rel=d/floor,
        floodRelief=.22+fn*.72+Math.max(0,order-1)*.12,
        foot=Math.max(0,d-floor),
        concavity=.66+.12*(1-fn),
        riseScale=(2.55+un*6.6+fn*2.2)*(1+.12*Math.max(0,order-1)),
        hillslopeRise=riseScale*Math.pow(foot,concavity),
        target=rel<=1?g.channelZ[i]+floodRelief*Math.pow(rel,1.8):g.channelZ[i]+floodRelief+hillslopeRise,
        reach=floorWidth*4.0+3.5,
        influence=Math.exp(-Math.pow(d/reach,1.35))*(.56+.28*fn+.035*Math.max(0,order-1)),
        vb=clamp(influence,0,.88),delta=target-shaped;
      // Incision can strongly lower inherited uplift, while interfluve support can
      // raise a too-rounded surface moderately. Continuous distance prevents the
      // polygonal catchment facets seen in the rejected v0.16c experiment.
      if(delta<0)shaped=lerp(shaped,target,vb*.95);
      else shaped+=Math.min(delta,12+un*18)*vb*.52;
    }
    if(divide&&Number.isFinite(divide[i])){
      const ds=clamp(divideStrength?.[i]??.55,.20,1),dd=divide[i],sigma=2.7+ds*2.5,
        ridge=Math.exp(-Math.pow(dd/sigma,2))*(3.4+ds*(7.2+un*14.5))*clamp((d-1.0)/5.2),
        edgeFade=clamp(Math.min(x,y,w-1-x,h-1-y)/4);
      shaped+=ridge*edgeFade;
    }
    if(secondaryDivide&&Number.isFinite(secondaryDivide[i])){
      const ds=clamp(secondaryStrength?.[i]??.32,.18,.70),dd=secondaryDivide[i],sigma=1.35+ds*1.75,
        highland=clamp((un-.14)/.62),away=clamp((d-.70)/4.2),
        ridge=Math.exp(-Math.pow(dd/sigma,2))*(.65+ds*(2.35+un*4.4))*highland*away,
        edgeFade=clamp(Math.min(x,y,w-1-x,h-1-y)/4);
      shaped+=ridge*edgeFade;
    }
    out[i]=shaped;
  }
  // Hillslope diffusion proxy: suppress cell-scale facets without erasing trunk
  // channels or major divides. This mimics diffusive soil/creep smoothing at a much
  // cheaper bounded cost than evolving the complete landscape through geologic time.
  let cur=out;
  for(let pass=0;pass<3;pass++){
    const next=new Float64Array(cur);
    for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){
      const i=idx(x,y,w),d=Number.isFinite(g.distance[i])?g.distance[i]/cell:99;
      if(d<.75)continue;
      let sum=0,wt=0;for(const [dx,dy,dd] of D8){const q=dd===1?1:.70;sum+=cur[idx(x+dx,y+dy,w)]*q;wt+=q;}
      const avg=sum/Math.max(1e-9,wt),far=clamp((d-.75)/7.0),mix=.035+.070*far;
      next[i]=lerp(cur[i],avg,mix);
    }
    cur=next;
  }
  return thermalRelax(cur,w,h,cell,1);
}

function refineRegionalRiverCurve(world,points,edgeId){
  // Procedural Riverscapes / hydrology-graph inspired conversion from a discrete
  // drainage trace into continuous geometry. Topology stays fixed at graph nodes;
  // interior samples may move only inside a sub-cell corridor and are attracted
  // toward the locally lower part of the regional surface. This is deliberately
  // a geometry refinement, not a second hydrology simulation.
  if(points.length<2)return points.map(p=>({...p}));
  const step=Math.max(10,world.cell*.20),sampled=samplePolyline(points,step),smoothLine=chaikinPolyline(sampled,2),out=[],n=smoothLine.length;
  let walked=0;
  for(let i=0;i<n;i++){
    const p=smoothLine[i];
    if(i===0||i===n-1){out.push({...p});continue;}
    walked+=Math.hypot(p.x-smoothLine[i-1].x,p.y-smoothLine[i-1].y);
    const a=smoothLine[Math.max(0,i-2)],b=smoothLine[Math.min(n-1,i+2)],dx=b.x-a.x,dy=b.y-a.y,dl=Math.hypot(dx,dy)||1,nx=-dy/dl,ny=dx/dl;
    const d=world.cell*.30,zx1=sampleRegionalElevation(world,p.x+d,p.y),zx0=sampleRegionalElevation(world,p.x-d,p.y),zy1=sampleRegionalElevation(world,p.x,p.y+d),zy0=sampleRegionalElevation(world,p.x,p.y-d),localSlope=Math.hypot((zx1-zx0)/(2*d),(zy1-zy0)/(2*d));
    const flat=1-clamp((localSlope-.025)/.18,0,1),maxOffset=world.cell*(.11+.40*flat),meander=fbm(world.seed,`river.curve.${edgeId}`,walked,0,world.cell*8.8,3)*maxOffset*.68;
    let best={...p},bestCost=Infinity;
    for(let k=-4;k<=4;k++){
      const off=meander+(k/4)*maxOffset*.66,qx=p.x+nx*off,qy=p.y+ny*off,z=sampleRegionalElevation(world,qx,qy),corridorPenalty=Math.abs(off-meander)*.022,continuity=out.length?Math.max(0,Math.hypot(qx-out.at(-1).x,qy-out.at(-1).y)-step*2.0)*.025:0,cost=z+corridorPenalty+continuity;
      if(cost<bestCost){bestCost=cost;best={...p,x:qx,y:qy};}
    }
    out.push(best);
  }
  out[0]={...points[0]};out[out.length-1]={...points.at(-1)};
  let rounded=out;for(let pass=0;pass<32;pass++){rounded=snapSmooth(rounded);rounded[0]={...points[0]};rounded[rounded.length-1]={...points.at(-1)};}
  return chaikinPolyline(rounded,1);
}

function buildDrainageGraph(world){
  const {w,h,cell,riverMask,flowReceiver,flowAccum}=world,n=w*h,up=new Int16Array(n);
  for(let i=0;i<n;i++){if(!riverMask[i])continue;const r=flowReceiver[i];if(r>=0&&riverMask[r])up[r]++;}
  const nodeByCell=new Map(),nodes=[];
  const classify=i=>{const r=flowReceiver[i],u=up[i];if(u===0)return'source';if(r<0||!riverMask[r])return'outlet';if(u>1)return'confluence';return'through';};
  for(let i=0;i<n;i++)if(riverMask[i]&&(up[i]!==1||flowReceiver[i]<0||!riverMask[flowReceiver[i]])){const [x,y]=xy(i,w),kind=classify(i),id=`river.node.${nodes.length+1}`;nodeByCell.set(i,id);nodes.push({id,cellIndex:i,x,y,xMeters:(x+.5)*cell,yMeters:(y+.5)*cell,kind,upstreamCount:up[i],flow:flowAccum[i]});}
  const edges=[];for(const node of nodes){let cur=node.cellIndex,r=flowReceiver[cur];if(r<0||!riverMask[r])continue;const cells=[cur],seen=new Set([cur]);let guard=0;while(r>=0&&riverMask[r]&&guard++<n){cells.push(r);if(nodeByCell.has(r))break;if(seen.has(r))break;seen.add(r);cur=r;r=flowReceiver[cur];}const end=cells.at(-1);if(!nodeByCell.has(end)||end===node.cellIndex)continue;const points=cells.map(ci=>{const [x,y]=xy(ci,w);return{x:(x+.5)*cell,y:(y+.5)*cell,flow:flowAccum[ci],cellIndex:ci};});const curve=points.length>2?refineRegionalRiverCurve(world,points,`edge.${edges.length+1}`):points.map(p=>({...p}));if(curve.length){curve[0]={...points[0]};curve[curve.length-1]={...points.at(-1)};}edges.push({id:`river.edge.${edges.length+1}`,from:node.id,to:nodeByCell.get(end),points,curvePoints:curve,flowMin:Math.min(...points.map(p=>p.flow)),flowMax:Math.max(...points.map(p=>p.flow))});}
  // Horton-Strahler order plus Shreve-like magnitude are attached to the stable
  // graph topology.  Equal-order continuation inherits one branchId; a junction of
  // equal-order tributaries creates a new higher-order branch.  This branch identity
  // is what the divide pass uses, not every short raster-derived edge separately.
  const incoming=new Map();for(const e of edges){if(!incoming.has(e.to))incoming.set(e.to,[]);incoming.get(e.to).push(e);}const byId=new Map(edges.map(e=>[e.id,e]));
  const orderMemo=new Map(),magMemo=new Map(),visiting=new Set();
  const solve=e=>{if(orderMemo.has(e.id))return orderMemo.get(e.id);if(visiting.has(e.id)){orderMemo.set(e.id,1);magMemo.set(e.id,1);return 1;}visiting.add(e.id);const ins=incoming.get(e.from)??[];let order=1,mag=1;if(ins.length){const os=ins.map(solve),max=Math.max(...os),ties=os.filter(v=>v===max).length;order=max+(ties>=2?1:0);mag=ins.reduce((sum,q)=>sum+(magMemo.get(q.id)??1),0);}visiting.delete(e.id);orderMemo.set(e.id,order);magMemo.set(e.id,mag);return order;};for(const e of edges)solve(e);
  let nextBranch=1;const branchMemo=new Map();const branchFor=e=>{if(branchMemo.has(e.id))return branchMemo.get(e.id);const ins=incoming.get(e.from)??[],same=ins.filter(q=>(orderMemo.get(q.id)??1)===(orderMemo.get(e.id)??1));let id;if(same.length===1)id=branchFor(same[0]);else id=`stream.branch.${nextBranch++}`;branchMemo.set(e.id,id);return id;};
  const orderCounts={};let maxStrahlerOrder=1;for(const e of edges){e.strahlerOrder=orderMemo.get(e.id)??1;e.shreveMagnitude=magMemo.get(e.id)??1;e.branchId=branchFor(e);maxStrahlerOrder=Math.max(maxStrahlerOrder,e.strahlerOrder);orderCounts[e.strahlerOrder]=(orderCounts[e.strahlerOrder]??0)+1;}
  const outgoing=new Map(edges.map(e=>[e.from,e]));for(const n of nodes){const e=outgoing.get(n.id),ins=incoming.get(n.id)??[];n.strahlerOrder=e?.strahlerOrder??Math.max(1,...ins.map(q=>q.strahlerOrder??1));n.shreveMagnitude=e?.shreveMagnitude??ins.reduce((a,q)=>a+(q.shreveMagnitude??1),0);}
  const counts={sources:nodes.filter(n=>n.kind==='source').length,confluences:nodes.filter(n=>n.kind==='confluence').length,outlets:nodes.filter(n=>n.kind==='outlet').length};
  return{nodes,edges,...counts,maxStrahlerOrder,orderCounts,streamBranches:new Set(edges.map(e=>e.branchId)).size};
}

function sampleRegionalElevation(world,wx,wy){
  // Regional cells are materialized in world space at cell centres: (x+.5,y+.5)*cell.
  // Older prototypes sampled the array as if entries lived at x*cell/y*cell, shifting
  // every Micro query by half a Regional cell (30 m at the default 60 m resolution).
  // Keep one coordinate convention across settlements, roads, rivers and refinement.
  const gx=clamp(wx/world.cell-.5,0,world.w-1.001),gy=clamp(wy/world.cell-.5,0,world.h-1.001),x0=Math.floor(gx),y0=Math.floor(gy),tx=gx-x0,ty=gy-y0,x1=Math.min(world.w-1,x0+1),y1=Math.min(world.h-1,y0+1);
  return lerp(lerp(world.elevation[idx(x0,y0,world.w)],world.elevation[idx(x1,y0,world.w)],tx),lerp(world.elevation[idx(x0,y1,world.w)],world.elevation[idx(x1,y1,world.w)],tx),ty);
}

function localSlope(world,wx,wy){return terrainGradient(world,wx,wy,world.cell*.25).slope;}

function terrainGradient(world,wx,wy,d=24){
  const gx=(sampleRegionalElevation(world,wx+d,wy)-sampleRegionalElevation(world,wx-d,wy))/(2*d);
  const gy=(sampleRegionalElevation(world,wx,wy+d)-sampleRegionalElevation(world,wx,wy-d))/(2*d);
  return {gx,gy,slope:Math.hypot(gx,gy)};
}

function samplePolyline(line,step=6){const out=[];for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],d=Math.hypot(b.x-a.x,b.y-a.y),n=Math.max(1,Math.ceil(d/step));for(let k=i===1?0:1;k<=n;k++){const t=k/n;out.push({x:lerp(a.x,b.x,t),y:lerp(a.y,b.y,t),flow:lerp(a.flow??1,b.flow??1,t)});}}return out;}

function chaikinPolyline(line,passes=2){let out=line.map(p=>({...p}));for(let pass=0;pass<passes;pass++){if(out.length<3)break;const next=[out[0]];for(let i=0;i<out.length-1;i++){const a=out[i],b=out[i+1],flowA=a.flow??1,flowB=b.flow??1;next.push({x:lerp(a.x,b.x,.25),y:lerp(a.y,b.y,.25),flow:lerp(flowA,flowB,.25)});next.push({x:lerp(a.x,b.x,.75),y:lerp(a.y,b.y,.75),flow:lerp(flowA,flowB,.75)});}next.push(out.at(-1));out=next;}return out;}

function snapSmooth(line){if(line.length<4)return line;const out=line.map(p=>({...p}));for(let i=1;i<line.length-1;i++){out[i].x=(line[i-1].x+2*line[i].x+line[i+1].x)/4;out[i].y=(line[i-1].y+2*line[i].y+line[i+1].y)/4;}return out;}
export {makeInitialElevation,erodeTerrain,priorityFlood,flowField,terrainSlopeField,normalizeField,buildDrainageGraph,buildMajorDivides,buildSecondaryDivides,graphMorphologyTerrain,distanceTransform};

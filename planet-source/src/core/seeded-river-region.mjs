/** Constructive, seeded valley design. Browser-safe; metres, NW origin.
 * Plan the connected river tree first, then shape its surrounding heightfield.
 * No DEM, fixed river-control-point fixture, drainage budget or old anchor gate.
 */
export const SEEDED_RIVER_GENERATOR = 'seeded-river-region@1';
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function randomFor(seed){let s=2166136261;for(const c of String(seed)){s^=c.charCodeAt(0);s=Math.imul(s,16777619);}return ()=>{s+=0x6D2B79F5;let t=s;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
const distance=(a,b)=>Math.hypot(a.xM-b.xM,a.yM-b.yM);
function segmentSample(p,a,b){const dx=b.xM-a.xM,dy=b.yM-a.yM;const t=clamp(((p.xM-a.xM)*dx+(p.yM-a.yM)*dy)/(dx*dx+dy*dy||1),0,1);return {d:Math.hypot(p.xM-a.xM-t*dx,p.yM-a.yM-t*dy),t};}
function nearest(p,path){let d=Infinity,bed=0,f=0;for(let i=1;i<path.points.length;i++){const q=segmentSample(p,path.points[i-1],path.points[i]);if(q.d<d){d=q.d;bed=path.bed[i-1]+q.t*(path.bed[i]-path.bed[i-1]);f=(path.s[i-1]+q.t*(path.s[i]-path.s[i-1]))/path.s.at(-1);}}return {d,bed,f};}
function cubic(a,b,c,d,t){const u=1-t;return {xM:u*u*u*a.xM+3*u*u*t*b.xM+3*u*t*t*c.xM+t*t*t*d.xM,yM:u*u*u*a.yM+3*u*u*t*b.yM+3*u*t*t*c.yM+t*t*t*d.yM};}
/** Geometry is independent of requested raster resolution. hints are design choices,
 * not promises of a hydrologically validated outlet or immutable old anchors. */
export function createSeededRiverDesign({seed=271828,widthM=8847.575822166944,heightM=9772.99159961942,hints={},reliefScale=1,valleyWidthScale=1}={}){
  if(!['string','number'].includes(typeof seed)||(typeof seed==='number'&&!Number.isFinite(seed)))throw new TypeError('seed must be a finite number or string');
  if(![widthM,heightM].every(v=>Number.isFinite(v)&&v>=1000&&v<=100000))throw new RangeError('region dimensions must be 1,000..100,000 metres');
  if(![reliefScale,valleyWidthScale].every(v=>Number.isFinite(v)&&v>=.2&&v<=3))throw new RangeError('reliefScale and valleyWidthScale must be 0.2..3');
  const rand=randomFor(seed),range=(a,b)=>a+(b-a)*rand();
  const sides=['south','east','north','west'];const side=hints.outlet?.side??sides[Math.floor(rand()*4)];
  if(!sides.includes(side))throw new TypeError('outlet side must be north, east, south or west');
  const position=hints.outlet?.position??range(.28,.72);
  if(!Number.isFinite(position)||position<.1||position>.9)throw new RangeError('outlet position must be a fraction in [0.1,0.9]');
  // Canonical coordinates run from downstream south to upstream north; transform
  // before sampling so every exported dimension and grade remains in metres.
  function transform(x,y){let u=x,v=y;if(side==='north'){u=1-x;v=1-y;}if(side==='east'){u=y;v=1-x;}if(side==='west'){u=1-y;v=x;}return {xM:clamp(u,0,1)*widthM,yM:clamp(v,0,1)*heightM};}
  const paths=[];
  function bend(points){
    const original=points.map(p=>({...p})),length=original.slice(1).reduce((s,p,i)=>s+distance(p,original[i]),0);
    const phase=range(0,Math.PI*2),cycles=range(1.2,2.7),amplitude=Math.min(95,length*.045);
    for(let i=1;i<points.length-1;i++){const t=i/(points.length-1),a=original[i-1],b=original[i+1],dx=b.xM-a.xM,dy=b.yM-a.yM,l=Math.hypot(dx,dy);const shift=amplitude*Math.sin(Math.PI*t)*(Math.sin(t*Math.PI*2*cycles+phase)+.28*Math.sin(t*29+phase));points[i]={xM:clamp(original[i].xM-dy/l*shift,0,widthM),yM:clamp(original[i].yM+dx/l*shift,0,heightM)};}
    return points;
  }
  function add(points,parent,order,bed0,grade){const s=[0];for(let i=1;i<points.length;i++)s.push(s.at(-1)+distance(points[i],points[i-1]));const total=s.at(-1);const bed=s.map(d=>bed0+grade*reliefScale*d*(.72+.28*d/total));const p={id:`river-${paths.length}`,parentId:parent?.id??null,order,points,bed,s,floorScale:range(.65,1.25)};paths.push(p);return p;}
  const canonicalPosition=['north','east'].includes(side)?1-position:position;
  const headX=range(.30,.70),amp=range(.05,.15),phase=range(0,Math.PI*2),frequency=range(.8,1.6),base=range(45,100),scale=Math.min(widthM,heightM);
  const mainPoints=[];const mainCount=Math.max(90,Math.ceil(Math.max(widthM,heightM)/75));
  for(let i=0;i<=mainCount;i++){const t=i/mainCount;const x=canonicalPosition*(1-t)+headX*t+amp*Math.sin(Math.PI*t)*Math.sin(t*Math.PI*2*frequency+phase)+.015*Math.sin(t*31+phase)*Math.sin(Math.PI*t);mainPoints.push(transform(x,1-.97*t));}
  const trunk=add(mainPoints,null,3,base,range(.0055,.009));
  // Separate upstream-growing catchment strips prevent random wandering and
  // crossing tributaries. Unequal spacing/length keeps the tree asymmetric.
  const major=[];
  for(const sign of [-1,1]){
    const count=4+Math.floor(rand()*3),positions=[];
    for(let trial=0;trial<80&&positions.length<count;trial++){const f=range(.10,.88);if(positions.every(p=>Math.abs(p-f)>.085))positions.push(f);}
    positions.sort((a,b)=>a-b);
    for(const f of positions){
      const j=Math.floor(f*mainCount),a=mainPoints[j];
      const localY=1-.97*j/mainCount;
      const end=transform(sign<0?range(.025,.12):range(.88,.975),clamp(localY-range(.06,.27),.025,.95));
      const ahead=mainPoints[Math.min(mainCount,j+7)];const dx=end.xM-a.xM,dy=end.yM-a.yM;
      const b={xM:a.xM+.22*dx+.30*(ahead.xM-a.xM),yM:a.yM+.22*dy+.30*(ahead.yM-a.yM)};
      const c={xM:a.xM+.70*dx+(ahead.xM-a.xM)*range(-.4,.9),yM:a.yM+.70*dy+(ahead.yM-a.yM)*range(-.4,.9)};
      const n=Math.max(18,Math.ceil(distance(a,end)/75));const pts=bend(Array.from({length:n+1},(_,i)=>cubic(a,b,c,end,i/n)));
      if(pts.slice(4).some(p=>paths.some(path=>nearest(p,path).d<scale*.012)))continue;
      major.push(add(pts,trunk,2,trunk.bed[j],range(.010,.017)));
    }
  }
  // Side gullies are short tributaries with matched confluence beds. Reject
  // candidates entering another valley, rather than drawing a tangled overlay.
  for(const parent of [trunk,...major]){
    const count=parent===trunk?5:3+Math.floor(rand()*3);
    for(let k=0;k<count;k++){
      const j=Math.floor(range(.22,.84)*(parent.points.length-1)),a=parent.points[j],up=parent.points[Math.min(j+2,parent.points.length-1)],down=parent.points[Math.max(j-2,0)];
      const vx=up.xM-down.xM,vy=up.yM-down.yM,l=Math.hypot(vx,vy),sign=rand()<.5?-1:1;
      const length=scale*range(.055,.14),ux=(vx*.42-vy*sign*.907)/l,uy=(vy*.42+vx*sign*.907)/l;
      const end={xM:a.xM+ux*length,yM:a.yM+uy*length};
      if(end.xM<scale*.015||end.xM>widthM-scale*.015||end.yM<scale*.015||end.yM>heightM-scale*.015)continue;
      const b={xM:a.xM+ux*length*.30+vx/l*length*.14,yM:a.yM+uy*length*.30+vy/l*length*.14};const c={xM:a.xM+ux*length*.72,yM:a.yM+uy*length*.72};
      const n=Math.max(12,Math.ceil(length/65)),pts=bend(Array.from({length:n+1},(_,i)=>cubic(a,b,c,end,i/n)));
      if(pts.slice(4).some(p=>paths.some(path=>nearest(p,path).d<scale*.016)))continue;
      add(pts,parent,1,parent.bed[j],range(.021,.035));
    }
  }
  const waves=Array.from({length:30},(_,i)=>({kx:range(-1,1)*[1/1400,1/400,1/100][i%3],ky:range(-1,1)*[1/1400,1/400,1/100][i%3],phase:range(0,Math.PI*2),amplitude:reliefScale*[7,3.8,1.2][i%3]}));
  return {schema:'seeded-river-design@1',generator:SEEDED_RIVER_GENERATOR,seed,reliefScale,valleyWidthScale,extent:{widthM,heightM},outlet:{side,position,...mainPoints[0]},paths,waves,uplandM:base+reliefScale*scale*range(.0175,.0226)};
}
export function sampleSeededRiverElevation(design,xM,yM){
  const noise=design.waves.reduce((v,w)=>v+w.amplitude*Math.sin(xM*w.kx+yM*w.ky+w.phase),0);
  let z=design.uplandM+noise,mind=Infinity;const p={xM,yM};
  for(const path of design.paths){const {d,bed,f}=nearest(p,path);mind=Math.min(mind,d);const floor=({3:85,2:43,1:12}[path.order])*path.floorScale*design.valleyWidthScale*(1-.60*f)*(1+.14*Math.sin(f*11));const dd=Math.max(0,d-floor);const rise=design.reliefScale*(.006*Math.min(d,floor)+.105*dd**.94)*(1+.12*Math.sin(xM/1700+yM/2300)+noise/design.reliefScale*.003);const thalweg=.9*design.reliefScale*Math.exp(-((d/({3:36,2:27,1:19}[path.order]))**2));z=Math.min(z,bed+rise-thalweg);}
  return z+noise*.45*Math.min(1,mind/300);
}
export function generateSeededRiverRegion(options={}){
  const {columns=161,rows=129}=options;
  if(![columns,rows].every(v=>Number.isSafeInteger(v)&&v>=2)||columns*rows>2000000)throw new RangeError('grid requires 2..2,000,000 nodes');
  const design=createSeededRiverDesign(options),{widthM,heightM}=design.extent;
  const dx=widthM/(columns-1),dy=heightM/(rows-1);
  const elevation=Array.from({length:columns*rows},(_,i)=>Number(sampleSeededRiverElevation(design,(i%columns)*dx,Math.floor(i/columns)*dy).toFixed(5)));
  return {schema:'shape-first-candidate@1',seed:design.seed,generator:{schema:SEEDED_RIVER_GENERATOR,recipe:'connected river tree → graded valley cross-sections → coherent upland relief',hints:options.hints??{},reliefScale:design.reliefScale,valleyWidthScale:design.valleyWidthScale,outlet:design.outlet},extent:design.extent,grid:{columns,rows,cellSizeM:dx,cellSizeYM:dy,row0:'north',yDirection:'south'},elevation,rivers:design.paths.map(p=>p.points),riverDesign:{schema:'seeded-river-design-metadata@1',pointOrder:'downstream_to_upstream',rivers:design.paths.map(p=>({id:p.id,parentId:p.parentId,order:p.order,designBedElevationM:p.bed,lengthM:p.s.at(-1)}))},notes:'Fictional seeded constructive river/valley shape. Horizontal and vertical units: metres. Designed beds rise upstream with matching confluences. Raster drainage, discharge, erosion and water budgets are not certified. Physical extent is explicit; raster resolution never rescales geometry.'};
}

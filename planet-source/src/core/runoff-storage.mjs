/** Piecewise-linear reservoir storage around non-overlapping vertical prisms.
 * The finite-volume cell floor remains flat at its sampled elevation. */
const areaOf=p=>p.length<3?0:Math.abs(p.reduce((a,v,i)=>{const q=p[(i+1)%p.length];return a+(v[0]-p[0][0])*(q[1]-p[0][1])-(v[1]-p[0][1])*(q[0]-p[0][0]);},0))/2;
function clip(poly,axis,limit,sign){const result=[];for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length],da=sign*(a[axis]-limit),db=sign*(b[axis]-limit);if(da>=0)result.push(a);if((da>=0)!==(db>=0)){const t=da/(da-db);result.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}}return result;}
function intersection(a,b){let result=a;for(let i=0;i<b.length&&result.length;i++){const p=b[i],q=b[(i+1)%b.length],input=result;result=[];const side=r=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);for(let j=0;j<input.length;j++){const u=input[j],v=input[(j+1)%input.length],du=side(u),dv=side(v);if(du>=0)result.push(u);if((du>=0)!==(dv>=0)){const t=du/(du-dv);result.push([u[0]+(v[0]-u[0])*t,u[1]+(v[1]-u[1])*t]);}}}return result;}
export function mapSupportStorage(state,boxes=[]){
 const {columns:w,rows:h,cellSizeM:s,originXM:ox,originYM:oy}=state;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<2||h<2||w*h>131072||![s,ox,oy].every(Number.isFinite)||s<=0||!Array.isArray(boxes)||boxes.length>4096)throw new RangeError('Invalid support storage grid');
 const cells=new Map(),ids=new Set(),mapped=new Set();let checks=0;
 for(const b of boxes){const {center:c,direction:d,lengthM:L,widthM:B,bottomElevationM:bottom,topElevationM:top}=b;
  if(typeof b.id!=='string'||!b.id||ids.has(b.id)||![c?.xM,c?.yM,d?.xM,d?.yM,L,B,bottom,top].every(Number.isFinite)||L<=0||B<=0||top<=bottom||Math.abs(Math.hypot(d.xM,d.yM)-1)>1e-8)throw new TypeError('Invalid storage support');ids.add(b.id);
  const polygon=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[c.xM+u*L/2*d.xM-v*B/2*d.yM,c.yM+u*L/2*d.yM+v*B/2*d.xM]);
  const minX=Math.max(0,Math.floor((Math.min(...polygon.map(p=>p[0]))-ox)/s)),maxX=Math.min(w-1,Math.floor((Math.max(...polygon.map(p=>p[0]))-ox)/s)),minY=Math.max(0,Math.floor((Math.min(...polygon.map(p=>p[1]))-oy)/s)),maxY=Math.min(h-1,Math.floor((Math.max(...polygon.map(p=>p[1]))-oy)/s));
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){
   if(++checks>2000000)throw new RangeError('Storage intersection budget exceeded');
   let p=polygon;for(const [axis,limit,sign]of [[0,ox+x*s,1],[0,ox+(x+1)*s,-1],[1,oy+y*s,1],[1,oy+(y+1)*s,-1]])p=clip(p,axis,limit,sign);
   const areaM2=areaOf(p);if(areaM2<=1e-10)continue;const cell=y*w+x,list=cells.get(cell)??[];
   for(const old of list)if(bottom<old.topElevationM&&top>old.bottomElevationM&&areaOf(intersection(p,old.polygon))>1e-8)throw new RangeError('Overlapping solid volumes require a union model');
   list.push({areaM2,bottomElevationM:bottom,topElevationM:top,polygon:p});cells.set(cell,list);mapped.add(b.id);
  }
 }
 const storage=[...cells].sort((a,b)=>a[0]-b[0]).map(([cell,solids])=>({cell,solids:solids.map(({polygon,...p})=>p)}));
 compileStorage(storage,state);
 return{storage,mappedSupportIds:[...mapped],outsideSupportIds:boxes.filter(b=>!mapped.has(b.id)).map(b=>b.id),scope:'clipped non-overlapping vertical prism volumes on sampled flat cell floors; not within-cell currents, erosion or multi-layer water'};
}
export function compileStorage(entries=[],state){
 const n=state.columns*state.rows,area=state.cellSizeM**2,g=state.groundElevationM,map=new Map();let minimumAreaM2=area;
 if(!Number.isSafeInteger(state.columns)||!Number.isSafeInteger(state.rows)||state.columns<2||state.rows<2||n>131072||!Number.isFinite(area)||area<=0||!Array.isArray(g)||g.length!==n||!g.every(Number.isFinite)||!Array.isArray(entries)||entries.length>32768)throw new RangeError('Invalid storage contract');
 for(const e of entries){if(!Number.isSafeInteger(e.cell)||e.cell<0||e.cell>=n||map.has(e.cell)||!Array.isArray(e.solids)||e.solids.length>64||!Number.isFinite(g[e.cell]))throw new TypeError('Invalid storage cell');
  const cuts=[g[e.cell]];
  for(const s of e.solids){if(![s.areaM2,s.bottomElevationM,s.topElevationM].every(Number.isFinite)||s.areaM2<=0||s.areaM2>area||s.topElevationM<=s.bottomElevationM)throw new RangeError('Invalid storage prism');if(s.bottomElevationM>g[e.cell])cuts.push(s.bottomElevationM);if(s.topElevationM>g[e.cell])cuts.push(s.topElevationM);}
  cuts.sort((a,b)=>a-b);const unique=[...new Set(cuts)],segments=[];
  for(let i=1;i<unique.length;i++){const bottom=unique[i-1],top=unique[i],mid=(bottom+top)/2,openAreaM2=area-e.solids.filter(s=>s.bottomElevationM<mid&&s.topElevationM>mid).reduce((sum,s)=>sum+s.areaM2,0);
   if(openAreaM2<area*1e-6)throw new RangeError('Fully blocked or nearly solid cells are outside this storage model');minimumAreaM2=Math.min(minimumAreaM2,openAreaM2);segments.push({bottom,top,area:openAreaM2});}
  map.set(e.cell,{segments,top:unique.at(-1)});
 }
 function volumeAtLevel(i,level){const depth=Math.max(0,level-g[i]),entry=map.get(i);if(!entry)return depth*area;let volume=0;for(const s of entry.segments){if(level<=s.bottom)break;volume+=Math.max(0,Math.min(level,s.top)-s.bottom)*s.area;}return volume+Math.max(0,level-entry.top)*area;}
 function levelAtVolume(i,volume){const entry=map.get(i);if(!entry)return g[i]+volume/area;let remaining=volume;for(const s of entry.segments){const capacity=(s.top-s.bottom)*s.area;if(remaining<=capacity)return s.bottom+remaining/s.area;remaining-=capacity;}return entry.top+remaining/area;}
 return{volumeAtLevel,levelAtVolume,minimumAreaM2};
}
export function runoffWaterDepths(state){const storage=compileStorage(state.storageObstructions??[],state);return state.waterVolumeM3.map((v,i)=>Math.max(0,storage.levelAtVolume(i,v)-state.groundElevationM[i]));}

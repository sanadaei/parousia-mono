/** Exact intersections of saved vertical support boxes with finite-volume
 * cell faces. This is a face-conductance obstruction model: it does not model
 * displaced cell storage, wake momentum, erosion or pressure drag. */
export function mapSupportFaceObstructions(state,boxes=[]){
 const {columns:w,rows:h,cellSizeM:s,originXM:ox,originYM:oy}=state;
 if(!Number.isSafeInteger(w)||!Number.isSafeInteger(h)||w<2||h<2||w*h>131072||![s,ox,oy].every(Number.isFinite)||s<=0)throw new RangeError('Invalid obstruction grid');
 if(!Array.isArray(boxes)||boxes.length>4096)throw new RangeError('Support obstruction budget exceeded');
 const faces=new Map(),hitIds=new Set(),ids=new Set();let faceChecks=0;
 for(const box of boxes){
  const {center:c,direction:d,lengthM:L,widthM:B,bottomElevationM:bottom,topElevationM:top}=box;
  if(typeof box.id!=='string'||ids.has(box.id)||![c?.xM,c?.yM,d?.xM,d?.yM,L,B,bottom,top].every(Number.isFinite)||L<=0||B<=0||top<=bottom||Math.abs(Math.hypot(d.xM,d.yM)-1)>1e-8)throw new TypeError('Invalid vertical support box');ids.add(box.id);
  const rx=(Math.abs(d.xM)*L+Math.abs(d.yM)*B)/2,ry=(Math.abs(d.yM)*L+Math.abs(d.xM)*B)/2;
  const loX=Math.max(0,Math.floor((c.xM-rx-ox)/s)-1),hiX=Math.min(w-1,Math.floor((c.xM+rx-ox)/s)+1),loY=Math.max(0,Math.floor((c.yM-ry-oy)/s)-1),hiY=Math.min(h-1,Math.floor((c.yM+ry-oy)/s)+1);
  const intersect=(x0,y0,x1,y1)=>{
   let lo=0,hi=1;const px=x0-c.xM,py=y0-c.yM,dx=x1-x0,dy=y1-y0;
   for(const [a,b,r]of [[px*d.xM+py*d.yM,dx*d.xM+dy*d.yM,L/2],[-px*d.yM+py*d.xM,-dx*d.yM+dy*d.xM,B/2]]){
    if(Math.abs(b)<1e-14){if(Math.abs(a)>r)return null;continue;}
    const t0=(-r-a)/b,t1=(r-a)/b;lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));if(hi<=lo)return null;
   }return[lo,hi];
  };
  const add=(a,b,x0,y0,x1,y1)=>{if(++faceChecks>2000000)throw new RangeError('Support face work budget exceeded');const range=intersect(x0,y0,x1,y1);if(!range)return;const key=`${a}/${b}`;let face=faces.get(key);if(!face){if(faces.size>=32768)throw new RangeError('Obstructed face budget exceeded');faces.set(key,face={fromCell:a,toCell:b,spans:[]});}face.spans.push({start:range[0],end:range[1],bottom,top});hitIds.add(box.id);};
  for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){const a=y*w+x;
   if(x+1<w)add(a,a+1,ox+(x+1)*s,oy+y*s,ox+(x+1)*s,oy+(y+1)*s);
   if(y+1<h)add(a,a+w,ox+x*s,oy+(y+1)*s,ox+(x+1)*s,oy+(y+1)*s);
  }
 }
 const obstructions=[];
 for(const face of faces.values()){
  const cuts=[...new Set(face.spans.flatMap(p=>[p.start,p.end]))].sort((a,b)=>a-b),pieces=[];
  for(let i=1;i<cuts.length;i++){const start=cuts[i-1],end=cuts[i],mid=(start+end)/2,active=face.spans.filter(p=>mid>=p.start&&mid<=p.end).sort((a,b)=>a.bottom-b.bottom),solidIntervals=[];
   for(const p of active){const last=solidIntervals.at(-1);if(last&&p.bottom<=last[1])last[1]=Math.max(last[1],p.top);else solidIntervals.push([p.bottom,p.top]);}
   if(solidIntervals.length)pieces.push({start,end,solidIntervals});
  }obstructions.push({fromCell:face.fromCell,toCell:face.toCell,pieces});
 }
 return {obstructions,coupledSupportIds:[...hitIds],unresolvedSupportIds:boxes.filter(b=>!hitIds.has(b.id)).map(b=>b.id),scope:'exact cell-face intersection of vertical boxes; cell storage displacement and subcell circulation unresolved'};
}
export function validateFaceObstructions(obstructions,w,h){
 if(!Array.isArray(obstructions)||obstructions.length>32768)throw new RangeError('Invalid face obstructions');
 const map=new Map();
 for(const f of obstructions){const a=f.fromCell,b=f.toCell,key=`${a}/${b}`;
  if(![a,b].every(i=>Number.isSafeInteger(i)&&i>=0&&i<w*h)||!(b===a+w||b===a+1&&Math.floor(a/w)===Math.floor(b/w))||map.has(key)||!Array.isArray(f.pieces)||f.pieces.length>8192)throw new TypeError('Invalid obstructed face');
  let previous=0;for(const p of f.pieces){if(!Number.isFinite(p.start)||!Number.isFinite(p.end)||p.start<previous||p.end>1||p.end<=p.start||!Array.isArray(p.solidIntervals)||p.solidIntervals.length>4096)throw new RangeError('Invalid obstruction face pieces');previous=p.end;let top=-Infinity;
   for(const interval of p.solidIntervals){if(!Array.isArray(interval)||interval.length!==2||!interval.every(Number.isFinite)||interval[0]<top||interval[1]<=interval[0])throw new RangeError('Invalid obstruction vertical intervals');top=interval[1];}
  }map.set(key,f);
 }return map;
}
/** Linear reservoir conductance integrated across the unobstructed face. */
export function openFaceHead(face,upstreamLevel,downstreamOrSill){
 const head=Math.max(0,upstreamLevel-downstreamOrSill);if(!face||head===0)return head;
 let blocked=0;for(const p of face.pieces)for(const [bottom,top]of p.solidIntervals)blocked+=(p.end-p.start)*Math.max(0,Math.min(upstreamLevel,top)-Math.max(downstreamOrSill,bottom));
 return Math.max(0,head-blocked);
}

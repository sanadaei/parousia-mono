/** Display only. Never passed to physical terrain/world samplers. */
export function validateHeightScale(v){if(!Number.isFinite(v)||v<1||v>50)throw new RangeError('Height scale must be 1..50');return v;}
export function radialLift(p,radius){const length=Math.hypot(...p);return p.map(v=>v/length*(length-radius));}
export function scaledPoint(p,radius,scale){validateHeightScale(scale);if(scale===1)return [...p];const lift=radialLift(p,radius);return p.map((v,i)=>v+(scale-1)*lift[i]);}
export function displayNormal(n,up,scale){const radial=n.reduce((s,v,i)=>s+v*up[i],0),out=n.map((v,i)=>up[i]*radial+(v-up[i]*radial)*scale),length=Math.hypot(...out);return out.map(v=>v/length);}
export function meshHeightLifts(vertex,anchor,radius,coarseLifts=null){const result=new Float32Array(vertex.length/2);for(let i=0,j=0;i<vertex.length;i+=12,j+=6){const fine=radialLift([0,1,2].map(k=>anchor[k]+vertex[i+k]),radius),coarse=coarseLifts?.slice(i/4,i/4+3)??radialLift([0,1,2].map(k=>anchor[k]+vertex[i+k+3]),radius);result.set(fine,j);result.set(coarse,j+3);}return result;}

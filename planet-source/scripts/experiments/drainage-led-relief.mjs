/** Research experiment, NOT a production terrain policy.
 * Hierarchical, fixed-coordinate branching is motivated by Gaillard et al. 2019
 * (https://www.mgaillard.fr/content/publications/pdfs/Gaillard19I3D.pdf).
 * This simplified distance-envelope reconstruction is OUR baseline, not Dendry.
 * No reference implementation source is copied. A graph is not a wet river map.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { requireVerificationMemory } from '../verification-runtime.mjs';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
function random(seed, level, x, y, axis) {
  let h = 2166136261;
  for (const c of `${seed}/${level}/${x}/${y}/${axis}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function project(p, s) {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const t = clamp(((p.x-s.a.x)*dx+(p.y-s.a.y)*dy)/(dx*dx+dy*dy), 0, 1);
  return { x:s.a.x+t*dx, y:s.a.y+t*dy, z:s.a.z+t*(s.b.z-s.a.z), t,
    distance:Math.hypot(p.x-s.a.x-t*dx,p.y-s.a.y-t*dy) };
}
function cross(a,b,c) { return (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x); }
function intersects(s,t) {
  return cross(s.a,s.b,t.a)*cross(s.a,s.b,t.b)<-1e-8 && cross(t.a,t.b,s.a)*cross(t.a,t.b,s.b)<-1e-8;
}
export function createExperiment({seed='research-1', extentM=8192, levels=3, hillSlope=.3,
  parent=[{x:4096,y:0,z:100},{x:3900,y:2048,z:118},{x:4500,y:4096,z:151},{x:4300,y:6144,z:199},{x:4600,y:8192,z:258}]}={}) {
  if (!Number.isInteger(levels)||levels<0||levels>4||!Number.isFinite(extentM)||extentM<=0||extentM>16384||!Number.isFinite(hillSlope)||hillSlope<=0||hillSlope>1) throw new RangeError('Bounded experiment parameters required');
  if (parent.length<2||parent.length>64||parent.some(p=>!['x','y','z'].every(k=>Number.isFinite(p[k])))) throw new TypeError('Explicit finite parent profile required');
  const segments=[];
  for(let i=1;i<parent.length;i++) {
    const a={...parent[i-1]},b={...parent[i]},length=Math.hypot(b.x-a.x,b.y-a.y);
    if(length<=0||b.z<a.z||(b.z-a.z)/length>=hillSlope) throw new RangeError('Parent must not fall upstream and must stay below the hillslope bound');
    segments.push({id:`parent/${i-1}`,parentId:i===1?null:`parent/${i-2}`,a,b,level:0});
  }
  const surface=(x,y,list=segments)=> {
    let z=Infinity;
    for(const s of list) {const q=project({x,y},s);z=Math.min(z,q.z+hillSlope*q.distance);}
    return z;
  };
  const rejected={crossing:0,short:0,bedConflict:0};
  for(let level=1;level<=levels;level++) {
    const cells=2**(level+1),step=extentM/cells,coarse=segments.slice();
    for(let y=0;y<cells;y++) for(let x=0;x<cells;x++) {
      const p={x:(x+.2+.6*random(seed,level,x,y,0))*step,y:(y+.2+.6*random(seed,level,x,y,1))*step};
      let nearest=null;
      for(const s of coarse) { const q=project(p,s);if(!nearest||q.distance<nearest.q.distance)nearest={s,q}; }
      const {s}=nearest;
      let q=nearest.q;
      // Dendry's slope-dependent confluence-angle idea, bounded to this segment.
      const parentLength=Math.hypot(s.b.x-s.a.x,s.b.y-s.a.y);
      const parentSlope=(s.b.z-s.a.z)/parentLength;
      const branchSlope=Math.min(hillSlope*.8,parentSlope*1.5+.015+.015*random(seed,level,x,y,2));
      const shift=q.distance*parentSlope/Math.sqrt(Math.max(1e-8,branchSlope**2-parentSlope**2));
      const t=clamp(q.t-shift/parentLength,0,1);
      q={x:s.a.x+t*(s.b.x-s.a.x),y:s.a.y+t*(s.b.y-s.a.y),z:s.a.z+t*(s.b.z-s.a.z)};
      q.distance=Math.hypot(p.x-q.x,p.y-q.y);
      if(q.distance<step*.22){rejected.short++;continue;}
      // Branch height is above its junction, and below the prior hillslope.
      p.z=q.z+q.distance*branchSlope;
      const candidate={id:`branch/${level}/${x}/${y}`,parentId:s.id,a:{x:q.x,y:q.y,z:q.z},b:p,level};
      if(segments.some(t=>intersects(candidate,t))){rejected.crossing++;continue;}
      // Sampled safeguard only: it does not prove continuous channel preservation.
      let conflict=false;
      for(const t of segments) for(let k=0;k<=8;k++) {
        const u=k/8,v={x:t.a.x+(t.b.x-t.a.x)*u,y:t.a.y+(t.b.y-t.a.y)*u,z:t.a.z+(t.b.z-t.a.z)*u};
        const f=project(v,candidate);
        if(f.z+hillSlope*f.distance<v.z-1e-5){conflict=true;break;}
      }
      // Also protect the candidate's own bed against earlier sibling valleys.
      // Checking only old beds lets a new branch float above existing relief.
      for(let k=1;k<=32;k++) {
        const t=k/32,x=q.x+(p.x-q.x)*t,y=q.y+(p.y-q.y)*t,z=q.z+(p.z-q.z)*t;
        if(surface(x,y)<z-1e-5){conflict=true;break;}
      }
      if(conflict){rejected.bedConflict++;continue;}
      segments.push(candidate);
    }
  }
  return {seed,extentM,segments,rejected,surface,parameters:{seed,extentM,levels,hillSlope,parent}};
}
// Compact, normalized constant-height primitives follow the reconstruction
// family discussed by Dendry/Genevaux. The input heights and channel preservation
// here are our experiment, not the full published construction.
export function smoothReconstruction(model,{spacingM=96,radiusCells=2.2,channelHalfWidthM=80}={}) {
  if(!(spacingM>=64&&spacingM<=1024&&radiusCells>=1.5&&radiusCells<=3&&channelHalfWidthM>0&&channelHalfWidthM<=1024))throw new RangeError('Positive reconstruction scales required');
  const cache=new Map(),{surface,segments}=model,reach=Math.ceil(radiusCells);
  const primitive=(x,y)=>{const key=`${x}/${y}`;if(!cache.has(key))cache.set(key,surface(x*spacingM,y*spacingM));return cache.get(key);};
  const sample=(x,y)=>{
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||y<0||x>model.extentM||y>model.extentM)throw new RangeError('Point outside canonical experiment region');
    const gx=x/spacingM,gy=y/spacingM,cx=Math.floor(gx),cy=Math.floor(gy);let sum=0,weights=0;
    for(let j=cy-reach;j<=cy+reach;j++)for(let i=cx-reach;i<=cx+reach;i++) {
      const r2=((gx-i)**2+(gy-j)**2)/radiusCells**2;if(r2>=1)continue;
      const w=(1-r2)**3;sum+=w*primitive(i,j);weights+=w;
    }
    const z=sum/weights;
    let distance=Infinity;
    for(const s of segments)distance=Math.min(distance,project({x,y},s).distance);
    const t=Math.min(1,distance/channelHalfWidthM),blend=t*t*(3-2*t);
    // Blend toward the already audited shared envelope, not sequential carving
    // by each channel (which lowered neighboring branch beds at confluences).
    return distance>=channelHalfWidthM?z:surface(x,y)*(1-blend)+z*blend;
  };
  return {sample,cache,parameters:{spacingM,radiusCells,channelHalfWidthM}};
}
export function auditExperiment(model,{resolution=129}={}) {
  if(!Number.isInteger(resolution)||resolution<3||resolution>257)throw new RangeError('Resolution must be 3..257');
  const {extentM,segments,surface}=model,heights=new Float64Array(resolution**2);
  let min=Infinity,max=-Infinity,interiorSinks=0;
  for(let y=0;y<resolution;y++)for(let x=0;x<resolution;x++) {
    const z=surface(x*extentM/(resolution-1),y*extentM/(resolution-1));heights[y*resolution+x]=z;min=Math.min(min,z);max=Math.max(max,z);
  }
  for(let y=1;y<resolution-1;y++)for(let x=1;x<resolution-1;x++) {
    const z=heights[y*resolution+x];let lower=false;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)if(heights[(y+j)*resolution+x+i]<z-1e-7)lower=true;
    if(!lower)interiorSinks++;
  }
  let maximumBedErrorM=0,uphillSurfaceSteps=0,crossings=0;
  for(let i=0;i<segments.length;i++) {
    const s=segments[i];let last=-Infinity;
    for(let k=0;k<=32;k++) {
      const t=k/32,z=surface(s.a.x+(s.b.x-s.a.x)*t,s.a.y+(s.b.y-s.a.y)*t);
      maximumBedErrorM=Math.max(maximumBedErrorM,Math.abs(z-s.a.z-(s.b.z-s.a.z)*t));
      if(z<last-1e-7)uphillSurfaceSteps++;last=z;
    }
    for(let j=0;j<i;j++)if(intersects(s,segments[j]))crossings++;
  }
  // Independent reconstruction, query order and overlapping display windows.
  const rebuilt=createExperiment(model.parameters);let sharedDifferenceM=0;
  for(let i=64;i>=0;i--) {
    const x=extentM*.4+extentM*.2*i/64,y=extentM*((i*23)%65)/64;
    sharedDifferenceM=Math.max(sharedDifferenceM,Math.abs(surface(x,y)-rebuilt.surface(x,y)));
  }
  return {heights,report:{seed:model.seed,segments:segments.length,rejected:model.rejected,resolution,
    reliefM:max-min,minM:min,maxM:max,crossings,maximumBedErrorM,uphillSurfaceSteps,interiorSinks,
    sharedDifferenceM,approximateNumericStorageBytes:heights.byteLength+segments.length*9*8,
    limitations:['Parent supplied by the caller; global downstream provenance must be checked separately','Piecewise distance envelopes have sharp divides and are not a Dendry reproduction','Sampled safeguards are not continuous hydrology proofs','No water, erosion, sediment, soils or vegetation generated','Window agreement uses one canonical region; independent catchment boundary stitching remains unimplemented']}};
}
export function reliefSvg(model,audit) {
  const n=Math.sqrt(audit.heights.length),minM=Math.min(...audit.heights),maxM=Math.max(...audit.heights),size=640,parts=[];
  for(let y=0;y<n-1;y++)for(let x=0;x<n-1;x++) {
    const i=y*n+x,z=audit.heights[i],fraction=(z-minM)/(maxM-minM||1);
    const dx=(audit.heights[i+1]-z),dy=(audit.heights[i+n]-z),shade=clamp(70-(dx*.5+dy*.8),28,86);
    parts.push(`<rect x="${x*size/(n-1)}" y="${size-(y+1)*size/(n-1)}" width="${size/(n-1)+.1}" height="${size/(n-1)+.1}" fill="hsl(${100-65*fraction} 25% ${shade}%)"/>`);
  }
  for(const s of model.segments)parts.push(`<path d="M${s.a.x/model.extentM*size},${size-s.a.y/model.extentM*size} L${s.b.x/model.extentM*size},${size-s.b.y/model.extentM*size}" fill="none" stroke="${s.level===0?'#9c211d':'#333333'}" stroke-width="${s.level===0?2:0.65}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="680" viewBox="0 0 640 680"><rect width="640" height="680" fill="white"/>${parts.join('')}<text x="12" y="662" font-size="14">Research comparison. NOT an adopted production terrain policy.</text></svg>`;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  requireVerificationMemory();
  const out=process.argv[2]||'/tmp/planet-drainage-experiment';mkdirSync(out,{recursive:true});const reports=[];
  for(const seed of ['research-1','research-2','research-3','research-4']) {
    const start=performance.now(),model=createExperiment({seed}),audit=auditExperiment(model);
    audit.report.runtimeMs=performance.now()-start;reports.push(audit.report);
    writeFileSync(`${out}/${seed}.svg`,reliefSvg(model,audit));
    writeFileSync(`${out}/${seed}-graph.json`,JSON.stringify(model.segments));
  }
  writeFileSync(`${out}/report.json`,JSON.stringify({status:'UNADOPTED RESEARCH EXPERIMENT',reports},null,2));
  console.log(JSON.stringify(reports,null,2));
}

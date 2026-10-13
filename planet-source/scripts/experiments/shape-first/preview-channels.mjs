import fs from 'node:fs/promises';
import {loadShapeFirstModel} from '../../../src/globe/shape-first-loader.mjs';
import {createShapeFirstCandidateChannels} from '../../../src/core/shape-first-channels.mjs';
const fetchImpl=async u=>{const b=await fs.readFile(u);return{ok:true,text:async()=>b.toString()};};
const m=await loadShapeFirstModel({fetchImpl}),c=createShapeFirstCandidateChannels(m.candidate,m.water,{nativeTerrain:m.nativeTerrain});
const r=c.rivers[0],i=Math.floor(r.points.length*.48),p=r.points[i],a=r.points[i-1],b=r.points[i+1],len=Math.hypot(b.xM-a.xM,b.yM-a.yM),nx=-(b.yM-a.yM)/len,ny=(b.xM-a.xM)/len,half=r.widthM[i]/2;
const cross=[];for(let k=-160;k<=160;k++){const d=k*half/40,s=c.sample(p.xM+nx*d,p.yM+ny*d);cross.push({distanceM:d,...s});}
const dir=new URL('../../../reports/shape-first-channels/',import.meta.url);await fs.mkdir(dir,{recursive:true});
const xmin=cross[0].distanceM,xmax=cross.at(-1).distanceM,zmin=Math.min(...cross.map(s=>s.groundElevationM))-1,zmax=Math.max(...cross.map(s=>s.groundElevationM))+1;
const x=d=>60+(d-xmin)/(xmax-xmin)*880,y=z=>340-(z-zmin)/(zmax-zmin)*230;
let svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="460" viewBox="0 0 1000 460"><rect width="1000" height="460" fill="#faf9f5"/><g font-family="sans-serif" fill="#20332e"><text x="40" y="38" font-size="23">Actual designed channel cross-section</text><text x="40" y="66">${r.id}: width ${r.widthM[i].toFixed(2)} m; depth ${r.depthM[i].toFixed(2)} m; datum ${r.waterLevelM[i].toFixed(2)} m</text><text x="40" y="412">Ground and water sampled from the same analytic field. Blue fill is positive water depth.</text><text x="40" y="438">Dimensions and water datum are procedural design choices, not measured or certified hydraulics.</text></g>`;
svg+=`<polyline points="${cross.map(s=>`${x(s.distanceM)},${y(s.groundElevationM)}`).join(' ')}" fill="none" stroke="#785836" stroke-width="3"/>`;
for(let j=1;j<cross.length;j++){const a=cross[j-1],b=cross[j];if(a.wet&&b.wet)svg+=`<polygon points="${x(a.distanceM)},${y(a.groundElevationM)} ${x(b.distanceM)},${y(b.groundElevationM)} ${x(b.distanceM)},${y(b.waterLevelM)} ${x(a.distanceM)},${y(a.waterLevelM)}" fill="#329bd5"/>`;}
svg+='</svg>';await fs.writeFile(new URL('cross-section.svg',dir),svg);
// Actual 2 m surface samples, rendered as an oblique surface without symbolic river lines.
const span=300,n=150,cells=[],z0=c.sample(p.xM,p.yM).groundElevationM;
const iso=(ix,iy,z)=>[500+(ix-iy)*2.7,90+(ix+iy)*1.35-(z-z0)*4];
for(let iy=0;iy<n;iy++)for(let ix=0;ix<n;ix++){
 const vals=[[ix,iy],[ix+1,iy],[ix+1,iy+1],[ix,iy+1]].map(([xx,yy])=>{const s=c.sample(p.xM-span/2+xx*span/n,p.yM-span/2+yy*span/n);return {xx,yy,s};}),avg=vals.reduce((v,p)=>v+p.s.groundElevationM,0)/4,wet=vals.every(v=>v.s.wet),light=Math.max(50,Math.min(78,64+(vals[0].s.groundElevationM-vals[2].s.groundElevationM)*4));
 const points=vals.map(v=>iso(v.xx,v.yy,wet?v.s.waterLevelM:v.s.groundElevationM).join(',')).join(' ');cells.push(`<polygon points="${points}" fill="${wet?'#349bd0':`hsl(82 23% ${light}%)`}"/>`);
}
svg=`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="650"><rect width="1000" height="650" fill="#faf9f5"/><g font-family="sans-serif" fill="#20332e"><text x="35" y="35" font-size="23">Actual terrain + water surface preview</text><text x="35" y="60">300 × 300 m native patch; 2 m samples; 4× vertical display scale</text></g>${cells.join('')}<g font-family="sans-serif" fill="#20332e"><text x="35" y="595">Blue polygons sit at the sampled water surface; ground is channel-carved in the same field.</text><text x="35" y="620">No conceptual river strokes. Procedural channel design, not a hydraulic simulation.</text></g></svg>`;
await fs.writeFile(new URL('surface-preview.svg',dir),svg);
await fs.writeFile(new URL('report.json',dir),JSON.stringify({schema:c.schema,status:c.status,method:c.method,sourceSeed:m.candidate.seed,riverCount:c.rivers.length,pointCount:c.rivers.reduce((n,r)=>n+r.points.length,0),confluences:c.confluences,designBounds:c.designBounds,crossSection:{riverId:r.id,pointIndex:i,center:p,samples:cross}},null,2));console.log('Wrote reports/shape-first-channels/{cross-section.svg,surface-preview.svg,report.json}');

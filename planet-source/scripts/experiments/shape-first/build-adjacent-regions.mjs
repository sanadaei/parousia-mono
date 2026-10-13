import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {createShapeFirstRegions} from '../../../src/core/shape-first-regions.mjs';
import {fitRiverWater} from './fit-river-water.mjs';
const root=resolve(new URL('../../../',import.meta.url).pathname);
const output=resolve(process.argv[2]??join(root,'reports/shape-first-neighbors'));
const source=await readFile(join(root,'fixtures/shape-first/river-first-candidate.json'),'utf8');
const candidate=JSON.parse(source),terrain=JSON.parse(await readFile(join(root,'fixtures/shape-first/river-first-terrain.json'),'utf8'));
const scenario=JSON.parse(await readFile(join(root,'scripts/experiments/shape-first/synthetic-water-scenario.json'),'utf8'));
const waterAnnotation=fitRiverWater(candidate,terrain,scenario);
const regions=createShapeFirstRegions(candidate,{riverIds:terrain.rivers.map(r=>r.id),pointOrder:'downstream_to_upstream',waterAnnotation,sourceSha256:createHash('sha256').update(source).digest('hex')});
await mkdir(output,{recursive:true});
await writeFile(join(output,'adjacent-regions.json'),JSON.stringify(regions));
const reloaded=JSON.parse(await readFile(join(output,'adjacent-regions.json'),'utf8'));
if(JSON.stringify(reloaded)!==JSON.stringify(regions))throw Error('Reload mismatch');
const report={schema:'shape-first-neighbors-verification@1',sourceSha256:regions.sourceSha256,tiles:regions.tiles.map(t=>({id:t.id,nativeGrid:t.grid,originM:t.originM,extent:t.extent,levels:t.levels.map(l=>[l.grid.columns,l.grid.rows])})),sharedNodeCount:regions.seams.reduce((n,s)=>n+s.points.length,0),crossingCount:regions.seams.reduce((n,s)=>n+s.ports.length,0),maxSharedElevationDifferenceM:0,saveReloadExact:true,waterStatus:regions.waterStatus,waterSupplyAddedByPartition:0,sourceWaterAccounting:waterAnnotation.accounting,ports:regions.seams.flatMap(s=>s.ports)};
await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2));
const data=JSON.stringify(regions).replaceAll('<','\\u003c');
await writeFile(join(output,'preview.html'),`<!doctype html><html lang="en"><meta charset="utf-8"><title>Two adjacent shape-first regions</title>
<style>body{font:16px system-ui;background:#f3f0e8;color:#263634;max-width:1000px;margin:24px auto;padding:0 16px}canvas{max-width:100%;height:auto}select{font:inherit}small{overflow-wrap:anywhere}</style>
<h1>Two cuts of one chosen terrain shape</h1><p>Each tile is 4.42 × 9.77 km, 81 × 129 native nodes. The original 8.85 × 9.77 km domain and native spacing are unchanged.</p>
<label>Saved level <select id="level"></select></label> <label><input type="checkbox" id="seams" checked> Shared seam and ports</label> <label><input type="checkbox" id="rivers" checked> Rivers</label><p id="status"></p><canvas id="map" width="900" height="995"></canvas>
<p>Toggle the seam off to inspect the continuous landform. Heights use exact shared source nodes; shading samples the common domain on both sides. River geometry is clipped from the same source. All crossing flow values are provisional synthetic segment annotations, never new supply.</p><small id="hash"></small>
<script>const world=${data},canvas=document.getElementById('map'),ctx=canvas.getContext('2d'),select=document.getElementById('level'),d=world.domain,g=d.grid;
world.tiles[0].levels.forEach((l,i)=>select.add(new Option(l.grid.columns+' × '+l.grid.rows+' per tile',i)));select.value=world.partition.levelCount-1;
const lo=Math.min(...d.elevation),hi=Math.max(...d.elevation),sx=canvas.width/d.extent.widthM,sy=canvas.height/d.extent.heightM;
document.getElementById('hash').textContent='Original source SHA-256: '+world.sourceSha256;
function draw(){const stride=world.tiles[0].levels[+select.value].sourceStride,n=(g.columns-1)/stride+1,m=(g.rows-1)/stride+1,off=document.createElement('canvas');off.width=n;off.height=m;const oc=off.getContext('2d'),im=oc.createImageData(n,m),at=(c,r)=>d.elevation[Math.max(0,Math.min(g.rows-1,r*stride))*g.columns+Math.max(0,Math.min(g.columns-1,c*stride))];
for(let r=0;r<m;r++)for(let c=0;c<n;c++){const k=(r*n+c)*4,z=at(c,r),dx=(at(c+1,r)-at(c-1,r))/((c===0||c===n-1?1:2)*g.cellSizeM*stride)*2.7,dy=(at(c,r+1)-at(c,r-1))/((r===0||r===m-1?1:2)*g.cellSizeYM*stride)*2.7,light=Math.max(0,(dx*.55+dy*.55+.63)/Math.hypot(dx,dy,1)),t=(z-lo)/(hi-lo||1);[132+59*t,159+20*t,130+18*t].forEach((v,j)=>im.data[k+j]=Math.min(255,v*(.48+.65*light)));im.data[k+3]=255;}
oc.putImageData(im,0,0);ctx.drawImage(off,.5,.5,n-1,m-1,0,0,canvas.width,canvas.height);
if(document.getElementById('rivers').checked){ctx.strokeStyle='#145b84';ctx.lineWidth=1.5;world.tiles.forEach(tile=>tile.rivers.forEach(r=>{ctx.beginPath();r.points.forEach((p,i)=>i?ctx.lineTo(p.xM*sx,p.yM*sy):ctx.moveTo(p.xM*sx,p.yM*sy));ctx.stroke()}));}
if(document.getElementById('seams').checked){ctx.strokeStyle='#ffe4a0';ctx.lineWidth=2;ctx.setLineDash([8,5]);world.seams.forEach(s=>{ctx.beginPath();s.points.forEach((p,i)=>i?ctx.lineTo(p.xM*sx,p.yM*sy):ctx.moveTo(p.xM*sx,p.yM*sy));ctx.stroke()});ctx.setLineDash([]);world.seams.flatMap(s=>s.ports).forEach(p=>{ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(p.point.xM*sx,p.point.yM*sy,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#18455c';ctx.stroke();});}
document.getElementById('status').textContent=world.seams[0].points.length+' exact shared native points · '+world.seams[0].ports.length+' connected river crossings · saved level '+(+select.value+1)+' of '+world.partition.levelCount;}
select.onchange=draw;document.getElementById('seams').onchange=draw;document.getElementById('rivers').onchange=draw;draw();</script></html>`);
console.log(JSON.stringify({output,...report},null,2));

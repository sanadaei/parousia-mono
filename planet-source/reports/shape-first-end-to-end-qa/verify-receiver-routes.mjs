// Independent QA: ensure added outlet routes do not cross back into chosen terrain.
import fs from 'node:fs';
import {createSeededRiverDesign} from '../../src/core/seeded-river-region.mjs';
import {createSphericalProjection} from '../../src/core/spherical.mjs';
import {chooseShapeFirstOutletReceiver,designShapeFirstOutletRoute} from '../../src/core/shape-first-outlet-connection.mjs';
const m=JSON.parse(fs.readFileSync(new URL('../../examples/planet/generated/manifest.json',import.meta.url))),extent={widthM:8847.575822166944,heightM:9772.99159961942};
const p=createSphericalProjection({centerLatDeg:m.focus.latDeg,centerLonDeg:m.focus.lonDeg,radiusM:m.base.frame.radiusM,maxRadiusM:50000});
const local=(lat,lon)=>{const q=p.toLocalIfWithin(lat,lon);return q?{xM:q.xM+extent.widthM/2,yM:extent.heightM/2-q.yM}:null;};
const results=[];
for(const side of ['north','east','south','west']){
 const d=createSeededRiverDesign({...extent,seed:'qa-four-sides',hints:{outlet:{side}}}),a=d.paths[0].points[0],b=d.paths[0].points[1],outlet={...a,direction:{xM:a.xM-b.xM,yM:a.yM-b.yM}};
 const receiver=chooseShapeFirstOutletReceiver(m.rivers,{local,extent,outlet});
 if(!receiver){results.push({side,status:'no receiver'});continue;}
 const route=designShapeFirstOutletRoute(outlet,receiver),inside=[];
 for(let i=1;i<route.points.length;i++)for(const t of [.25,.5,.75,1]){const a=route.points[i-1],b=route.points[i],p={xM:a.xM+(b.xM-a.xM)*t,yM:a.yM+(b.yM-a.yM)*t};if(p.xM>1e-7&&p.xM<extent.widthM-1e-7&&p.yM>1e-7&&p.yM<extent.heightM-1e-7)inside.push(p);}
 results.push({side,receiver:receiver.id,routeLengthM:route.lengthM,reenterSamples:inside.length,firstReentry:inside[0]??null});
}
console.log(JSON.stringify({scope:'Actual saved base river receiver; four generated outlet sides; sampled polyline interiors',results},null,2));
if(results.some(r=>r.reenterSamples>0))process.exitCode=1;

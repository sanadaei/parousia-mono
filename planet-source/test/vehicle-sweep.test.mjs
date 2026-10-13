import test from 'node:test';import assert from 'node:assert/strict';import {inspectVehicleSweep,traceVehicleTurn} from '../src/core/vehicle-sweep.mjs';
const p=(xM,yM,headingRad=0,bottomElevationM=0)=>({xM,yM,headingRad,bottomElevationM});
const box=(id,xM,yM,z=0)=>({id,...p(xM,yM,0,z),lengthM:.2,widthM:.2,heightM:2});
const car={lengthM:4,widthM:2,heightM:2};
test('continuous translation catches a thin obstacle between endpoint poses',()=>{const r=inspectVehicleSweep({...car,poses:[p(0,0),p(20,0)],obstacles:[box('wall',10,0)]});assert.equal(r.status,'possible-collision');assert.equal(r.conflicts[0].obstacleId,'wall');});
test('rotating corners are enclosed, including positions outside endpoint rectangles',()=>{const r=inspectVehicleSweep({...car,poses:[p(0,0),p(0,0,Math.PI/2)],obstacles:[box('corner',2.1,.7)]});assert.equal(r.status,'possible-collision');assert.ok(r.envelopes[0].enclosureErrorM>0);});
test('full vehicle height rejects low overpass but accepts genuinely separated deck',()=>{const poses=[p(0,0),p(20,0)];assert.equal(inspectVehicleSweep({...car,poses,obstacles:[box('low',10,0,1.9)]}).status,'possible-collision');assert.equal(inspectVehicleSweep({...car,poses,obstacles:[box('high',10,0,2.1)]}).status,'clear-for-specified-motion');});
test('analytic turning path carries chord error and can reverse without losing the body offset',()=>{const a=traceVehicleTurn({start:p(0,0),wheelbaseM:2,commands:[{distanceM:8,steeringRad:.4}]});assert.ok(a.poses.at(-1).yM>0);assert.ok(a.segmentPositionErrorM.every(e=>e>0));const r=traceVehicleTurn({start:a.poses.at(-1),wheelbaseM:2,commands:[{distanceM:-8,steeringRad:.4}]});assert.ok(Math.hypot(r.poses.at(-1).xM,r.poses.at(-1).yM)<1e-12);assert.equal(inspectVehicleSweep({...car,...a,obstacles:[box('distant',100,100)]}).status,'clear-for-specified-motion');});
test('sweep rejects unbounded work, invalid geometry and ambiguous full rotations',()=>{assert.throws(()=>inspectVehicleSweep({...car,poses:[p(0,0),p(0,0,Math.PI*2)]}),/Subdivide/);assert.throws(()=>traceVehicleTurn({start:p(0,0),wheelbaseM:2,commands:[{distanceM:1e9,steeringRad:0}]}),/budget/);assert.throws(()=>inspectVehicleSweep({...car,widthM:0,poses:[p(0,0),p(1,0)]}));});
test('continuous enclosure contains dense intermediate rotating body corners',()=>{
 for(let k=0;k<24;k++){const a=p(k*.1,-2,.1*k),b=p(3,4,.1*k+(k%2?1:-1)*2.5),r=inspectVehicleSweep({...car,poses:[a,b]}),poly=r.envelopes[0].polygon;
 for(let j=0;j<=40;j++){const t=j/40,h=a.headingRad*(1-t)+b.headingRad*t,x=a.xM*(1-t)+b.xM*t,y=a.yM*(1-t)+b.yM*t;
 for(const u of[-2,2])for(const v of[-1,1]){const q={xM:x+u*Math.cos(h)-v*Math.sin(h),yM:y+u*Math.sin(h)+v*Math.cos(h)};for(let i=0;i<poly.length;i++){const c=poly[i],d=poly[(i+1)%poly.length];assert.ok((d.xM-c.xM)*(q.yM-c.yM)-(d.yM-c.yM)*(q.xM-c.xM)>=-1e-8);}}
 }}
});

import test from'node:test';import assert from'node:assert/strict';import{createReliefGrid,routeBasinGraph,evolveRelief}from'../scripts/experiments/mst-relief.mjs';
function audit(r,g){const N=g.n*g.n;assert.equal(r.order.length,N);for(let i=0;i<N;i++){let j=i;const seen=new Set();while(r.receiver[j]>=0){assert.ok(!seen.has(j));seen.add(j);const q=r.receiver[j];assert.ok(g.neighbors[j].some(x=>x.i===q));j=q;}assert.equal(r.fixed[j],1);}const total=Array.from(r.area).reduce((v,a,i)=>v+(r.receiver[i]<0?a:0),0);assert.ok(Math.abs(total-N*g.spacingM**2)<1e-5);}
test('basin MST routes a closed bowl to explicit boundaries without changing its elevations',()=>{const n=9,g=createReliefGrid(n,100),z=Array.from({length:n*n},(_,i)=>(i%n-4)**2+(Math.floor(i/n)-4)**2),before=z.slice();const r=routeBasinGraph(z,g);audit(r,g);assert.deepEqual(z,before);assert.ok(r.report.reversedEdges>0);assert.ok(r.report.uphillRoutingEdges>0);assert.deepEqual(Array.from(r.receiver),Array.from(routeBasinGraph(z,g).receiver));});
test('basin routing preserves explicitly retained internal terminals',()=>{const n=7,g=createReliefGrid(n,50),z=Array.from({length:n*n},(_,i)=>Math.hypot(i%n-3,Math.floor(i/n)-3));const r=routeBasinGraph(z,g,{outlets:[24]});audit(r,g);assert.equal(r.receiver[24],-1);assert.equal(r.report.externalBasins,1);});
test('basin routing handles a flat and a sloped plane with finite adjacent receivers',()=>{for(const flat of[true,false]){const g=createReliefGrid(7,25),z=Array.from({length:49},(_,i)=>flat?0:i%7+Math.floor(i/7));audit(routeBasinGraph(z,g),g);}});
test('implicit relief preserves fixed elevations and finite bounded-step outputs',()=>{const n=9,initial=Array.from({length:81},(_,i)=>Math.sin(i*1.234)*.05),copy=initial.slice(),r=evolveRelief({initial,n,extentM:800,steps:5});assert.ok(r.heights.every(Number.isFinite));for(let i=0;i<81;i++)if(r.routing.fixed[i])assert.equal(r.heights[i],initial[i]);assert.deepEqual(initial,copy);audit(r.routing,createReliefGrid(n,100));});
test('relief routing and evolution reject invalid resource and numeric inputs',()=>{for(const n of[2,258,NaN,4.5])assert.throws(()=>createReliefGrid(n,10));const g=createReliefGrid(3,10);assert.throws(()=>routeBasinGraph(Array(9).fill(NaN),g));assert.throws(()=>routeBasinGraph(Array(9).fill(0),g,{outlets:[]}));assert.throws(()=>evolveRelief({initial:Array(9).fill(0),n:3,extentM:20,steps:201}));});

test('implicit n=1 step agrees with a direct downstream recurrence on an unambiguous plane',()=>{
 const n=7,initial=Array.from({length:n*n},(_,i)=>3*(i%n)+2*Math.floor(i/n));
 const g=createReliefGrid(n,100),route=routeBasinGraph(initial,g),expected=initial.slice(),dt=1000,K=.0002,m=.4;
 for(const i of route.order){const q=route.receiver[i];if(q<0)continue;const alpha=dt*K*route.area[i]**m/route.distance[i];expected[i]=(initial[i]+alpha*expected[q])/(1+alpha);}
 const r=evolveRelief({initial,n,extentM:600,steps:1,dtYears:dt,erodibility:K,areaExponent:m,upliftMPerYear:0});
 for(let i=0;i<n*n;i++)assert.ok(Math.abs(expected[i]-r.heights[i])<1e-12);
});

test('many deterministic rough basins terminate and conserve contributing area',()=>{
 let seed=91473;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/4294967296;};
 for(let run=0;run<20;run++){const n=5+run%7,g=createReliefGrid(n,30),z=Array.from({length:n*n},()=>Math.floor(random()*20));audit(routeBasinGraph(z,g),g);}
});

test('explicit uniform forcing fields reproduce scalar forcing exactly',()=>{
 const n=9,initial=Array.from({length:n*n},(_,i)=>2+Math.sin(i)),common={n,initial,extentM:800,steps:4};
 const a=evolveRelief({...common,erodibility:.0002,upliftMPerYear:.001});
 const b=evolveRelief({...common,erodibility:Array(n*n).fill(.0002),upliftMPerYear:Array(n*n).fill(.001)});
 assert.deepEqual(b.heights,a.heights);assert.deepEqual(b.routing.receiver,a.routing.receiver);
});

test('spatial forcing is bounded, owned input, with fixed outlets unaffected by uplift',()=>{
 const n=9,initial=Array.from({length:n*n},(_,i)=>i%n+Math.floor(i/n)),k=Array(n*n).fill(.0001),u=Array.from({length:n*n},(_,i)=>(i%n<4?.001:.002));
 const before=u.slice(),r=evolveRelief({n,initial,extentM:800,steps:2,erodibility:k,upliftMPerYear:u});
 assert.deepEqual(u,before);u[0]=.05;k[0]=.005;assert.equal(r.report.upliftMPerYear[0],.001);assert.equal(r.report.erodibility[0],.0001);
 for(let i=0;i<n*n;i++)if(r.routing.fixed[i])assert.equal(r.heights[i],initial[i]);
 for(const forcing of[[],Array(81).fill(NaN),Array(81).fill(-1),Array(81).fill(.2)])assert.throws(()=>evolveRelief({n,initial,extentM:800,upliftMPerYear:forcing}));
});

test('hillslope diffusion conserves closed-grid material and does not create extrema',async()=>{
 const {diffuseRelief}=await import('../scripts/experiments/mst-relief.mjs');
 const z=Array(49).fill(0);z[24]=100;const r=diffuseRelief(z,{n:7,spacingM:10,dtYears:100,diffusivityM2PerYear:1,fixed:Array(49).fill(0)});
 assert.equal(r.substeps,5);assert.equal(r.boundaryExportM3,0);assert.ok(r.heights.every(v=>v>=0&&v<=100));assert.ok(Math.abs(r.heights.reduce((a,b)=>a+b)-100)<1e-10);assert.equal(z[24],100);
});

test('diffusion accounts for export to fixed boundary reservoirs without moving them',async()=>{
 const {diffuseRelief}=await import('../scripts/experiments/mst-relief.mjs');const n=7,z=Array(49).fill(10),fixed=Array.from({length:49},(_,i)=>Number(i<7||i>=42||i%7===0||i%7===6));
 for(let i=0;i<49;i++)if(fixed[i])z[i]=0;
 const r=diffuseRelief(z,{n,spacingM:10,dtYears:100,diffusivityM2PerYear:1,fixed}),before=z.reduce((a,b)=>a+b)*100,after=Array.from(r.heights).reduce((a,b)=>a+b)*100;
 assert.ok(Math.abs(before-after-r.boundaryExportM3)<1e-8);assert.ok(r.boundaryExportM3>0);for(let i=0;i<49;i++)if(fixed[i])assert.equal(r.heights[i],0);
});

test('diffusion rejects excessive work before running and zero diffusion preserves old solver outputs',()=>{
 const n=9,initial=Array.from({length:81},(_,i)=>Math.sin(i));const p={n,initial,extentM:800,steps:2};
 assert.deepEqual(evolveRelief(p).heights,evolveRelief({...p,hillslopeDiffusivityM2PerYear:0}).heights);
 assert.throws(()=>evolveRelief({...p,extentM:1,hillslopeDiffusivityM2PerYear:1}));
 const r=evolveRelief({...p,hillslopeDiffusivityM2PerYear:.1});assert.ok(r.heights.every(Number.isFinite));assert.equal(r.report.hillslopeDiffusivityM2PerYear,.1);
});

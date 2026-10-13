import test from 'node:test';import assert from 'node:assert/strict';import {createUrbanBlockPlanner,insideUrbanBlock,surveyUrbanBlockStreets} from '../src/core/urban-blocks.mjs';
const ground=()=>100,water=()=>({waterDepthM:0});
test('urban block boundaries share a town-wide graph independent of page order',()=>{const a=createUrbanBlockPlanner({settlementId:'city',ground,water}),b=createUrbanBlockPlanner({settlementId:'city',ground,water});const left=a.cell(0,0),right=a.cell(1,0);assert.deepEqual(b.cell(1,0),right);assert.deepEqual(b.cell(0,0),left);const common=left.polygon.filter(p=>right.polygon.some(q=>Math.hypot(p.xM-q.xM,p.yM-q.yM)<1e-6));assert.equal(common.length,2);assert.ok(insideUrbanBlock(left.center,left.polygon));assert.ok(!insideUrbanBlock(right.center,left.polygon));assert.ok(surveyUrbanBlockStreets(left,{ground,water}).roads.length>=4);});
test('urban roads survey their width, not just their centerline',()=>{const block={id:'b',polygon:[{xM:0,yM:0},{xM:30,yM:0},{xM:30,yM:30},{xM:0,yM:30}]},p=surveyUrbanBlockStreets(block,{ground,water:(x,y)=>({waterDepthM:y< -1?1:0})});assert.ok(p.rejected.some(r=>r.edge===0));});

test('new seed policy removes coupled x/y proposals while retaining bounded terrain-ranked candidates',()=>{
 for(const settlementId of ['pop:4174:0','pop:3843:0','town-a']){const legacy=createUrbanBlockPlanner({settlementId,ground,water}),a=createUrbanBlockPlanner({settlementId,ground,water,seedPolicy:'terrain-ranked-block-seeds@2'}),b=createUrbanBlockPlanner({settlementId,ground,water,seedPolicy:'terrain-ranked-block-seeds@2'});let coupled=0,oldCoupled=0;
 for(let y=-4;y<=4;y++)for(let x=-4;x<=4;x++)if(x||y){const p=a.cell(x,y).center,q=legacy.cell(x,y).center,dx=p.xM-x*80,dy=p.yM-y*80;assert.ok(Math.abs(dx)<=15&&Math.abs(dy)<=15);if(Math.abs(dx-dy)<1)coupled++;if(Math.abs(q.xM-x*80-q.yM+y*80)<1)oldCoupled++;}
 assert.equal(oldCoupled,80);assert.ok(coupled<20,`${settlementId}: ${coupled}`);const right=b.cell(1,0),left=b.cell(0,0);assert.deepEqual(a.cell(1,0),right);assert.deepEqual(a.cell(0,0),left);assert.equal(left.polygon.filter(p=>right.polygon.some(q=>Math.hypot(p.xM-q.xM,p.yM-q.yM)<1e-6)).length,2);
 }
});

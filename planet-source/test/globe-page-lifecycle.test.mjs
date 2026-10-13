import test from 'node:test';import assert from 'node:assert/strict';import {installPageRecovery} from '../src/globe/page-lifecycle.mjs';
const event=(type,persisted=false)=>Object.assign(new Event(type),{persisted});
test('back-forward cache restores once after cleanup; initial pageshow does not reload',()=>{
 const target=new EventTarget();let stops=0,reloads=0;
 const dispose=installPageRecovery({target,onHide:()=>stops++,reload:()=>reloads++});
 target.dispatchEvent(event('pageshow'));target.dispatchEvent(event('pageshow',true));assert.equal(reloads,0);
 target.dispatchEvent(event('pagehide',true));target.dispatchEvent(event('pagehide',true));assert.equal(stops,1);
 target.dispatchEvent(event('pageshow',true));target.dispatchEvent(event('pageshow',true));assert.equal(reloads,1);
 target.dispatchEvent(event('pagehide',true));target.dispatchEvent(event('pageshow',true));assert.equal(stops,2);assert.equal(reloads,2);
 dispose();target.dispatchEvent(event('pagehide',true));target.dispatchEvent(event('pageshow',true));assert.equal(stops,2);assert.equal(reloads,2);
});
test('normal navigation cleanup does not claim a restored page or reload on first show',()=>{
 const target=new EventTarget();let stops=0,reloads=0;installPageRecovery({target,onHide:()=>stops++,reload:()=>reloads++});
 target.dispatchEvent(event('pagehide'));target.dispatchEvent(event('pageshow'));assert.equal(stops,1);assert.equal(reloads,0);
 assert.throws(()=>installPageRecovery({target}),/callbacks/);
});

import test from'node:test';import assert from'node:assert/strict';
import{cooperativeYield,cooperativeYieldMethod}from'../src/globe/cooperative-yield.mjs';
test('host scheduler keeps its receiver and yields before the continuation',async()=>{
 let resume;const scheduler={yield(){assert.equal(this,scheduler);return new Promise(r=>{resume=r;});}},host={scheduler,setTimeout(){throw Error('clamped timer selected');}};
 assert.equal(cooperativeYieldMethod(host),'scheduler.yield');let completed=false;const p=cooperativeYield(host).then(()=>{completed=true;});await Promise.resolve();assert.equal(completed,false);resume();await p;assert.equal(completed,true);
});
test('immediate and timer fallbacks preserve asynchronous cancellation opportunities',async()=>{
 for(const kind of['setImmediate','setTimeout']){let callback,args;const host={[kind](...a){callback=a[0];args=a;}};assert.equal(cooperativeYieldMethod(host),kind);let resumed=false;const pending=cooperativeYield(host).then(()=>{resumed=true;});assert.equal(resumed,false);if(kind==='setTimeout')assert.equal(args[1],0);callback();await pending;assert.equal(resumed,true);}
});
test('actual host yields to a pending immediate task',async()=>{
 let cancelled=false;setImmediate(()=>{cancelled=true;});await cooperativeYield();assert.equal(cancelled,true);
});

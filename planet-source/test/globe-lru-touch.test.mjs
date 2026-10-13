import test from 'node:test';import assert from 'node:assert/strict';
import {ByteLRU} from '../src/globe/lru.mjs';
test('repeated newest-page reads preserve eviction order, revisions, and pinning',()=>{
 const removed=[],cache=new ByteLRU(3,v=>removed.push(v));
 for(const k of ['a','b','c'])cache.put(k,k,1);
 const revision=cache.revision;for(let i=0;i<1000;i++)assert.equal(cache.get('c'),'c');
 assert.deepEqual([...cache.entries.keys()],['a','b','c']);assert.equal(cache.revision,revision);
 cache.get('a');for(let i=0;i<1000;i++)cache.get('a');cache.put('d','d',1);
 assert.deepEqual(removed,['b']);assert.deepEqual([...cache.entries.keys()],['c','a','d']);
 cache.delete('d');cache.put('e','e',1);cache.get('a');cache.put('f','f',1,new Set(['c']));
 assert.deepEqual([...cache.entries.keys()],['c','a','f']);assert.equal(cache.bytes,3);
 cache.clear();assert.equal(cache.get('f'),null);assert.equal(cache.bytes,0);
});
test('optimized LRU agrees with the plain reference after mixed puts, gets, and deletes',()=>{
 const a=new ByteLRU(8),b=new Map();let seed=32;
 for(let n=0;n<10000;n++){
  seed=(Math.imul(seed,1664525)+1013904223)>>>0;const key='k'+seed%12,op=seed>>>12&3;
  if(op===0){a.delete(key);b.delete(key);}
  else if(op===1){a.put(key,n,1);b.delete(key);b.set(key,n);while(b.size>8)b.delete(b.keys().next().value);}
  else {const expected=b.get(key);if(b.has(key)){b.delete(key);b.set(key,expected);}assert.equal(a.get(key),expected??null);}
  assert.deepEqual([...a.entries.keys()],[...b.keys()]);assert.equal(a.bytes,b.size);
 }
});

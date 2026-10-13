import test from 'node:test';
import assert from 'node:assert/strict';
import { readPage } from '../src/globe/page-request.mjs';
test('page deadline includes a stalled body and aborts transport',async()=>{
 let signal;await assert.rejects(readPage(async(url,options)=>{signal=options.signal;return{ok:true,text:()=>new Promise(()=>{})};},'test',{kind:'text',timeoutMs:15}),/timed out/);assert.equal(signal.aborted,true);
});
test('page cancellation is prompt even with an uncooperative transport',async()=>{
 const c=new AbortController(),p=readPage(()=>new Promise(()=>{}),'test',{signal:c.signal,timeoutMs:1000});c.abort();await assert.rejects(p,{name:'AbortError'});
});
test('page HTTP failure and valid text transfer are distinct',async()=>{
 await assert.rejects(readPage(async()=>({ok:false,status:404}),'test'),/404/);
 assert.equal(await readPage(async()=>({ok:true,text:async()=>'ok'}),'test',{kind:'text'}),'ok');
});
test('page streaming enforces byte limits even when Content-Length is absent',async()=>{
 const response=()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(8));c.enqueue(new Uint8Array(8));c.close();}}));
 await assert.rejects(readPage(async()=>response(),'test',{maxBytes:10}),/byte budget/);
 assert.equal((await readPage(async()=>response(),'test',{maxBytes:16})).byteLength,16);
 await assert.rejects(readPage(async()=>new Response('oversized',{headers:{'content-length':'999'}}),'test',{maxBytes:20}),/byte budget/);
});

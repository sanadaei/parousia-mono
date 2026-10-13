import test from'node:test';import assert from'node:assert/strict';import{startPlanet}from'../scripts/start-planet.mjs';
test('launcher serves the existing globe without running a build or generator',async()=>{
 const {server,url,port}=await startPlanet({port:0,software:true});try{assert.ok(port>0);const response=await fetch(url);assert.equal(response.status,200);assert.match(await response.text(),/Paged Globe/);assert.equal(response.headers.get('cache-control'),'no-cache');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
test('launcher selects another local port when the requested one is occupied',async()=>{
 const first=await startPlanet({port:0});let second;
 try{second=await startPlanet({port:first.port,attempts:2});assert.equal(second.port,first.port+1);}finally{first.server.closeAllConnections();await new Promise(r=>first.server.close(r));if(second){second.server.closeAllConnections();await new Promise(r=>second.server.close(r));}}
});
test('launcher rejects missing packages and malformed port options',async()=>{await assert.rejects(startPlanet({port:-1}));await assert.rejects(startPlanet({root:'/does-not-exist',port:0}),/missing/);});

import test from 'node:test';import assert from 'node:assert/strict';
import {createTerrainAdapter,TRIANGULAR_TERRAIN_SCHEMA} from '../src/core/index.mjs';
import {SoftwareRenderer} from '../src/globe/software-renderer.mjs';
const source=seed=>createTerrainAdapter({schema:TRIANGULAR_TERRAIN_SCHEMA,seed,revision:'1',frame:{kind:'planar-metric',verticalDatum:'test'},mesh:{points:[[0,0],[100,0],[100,100],[0,100]],triangles:[[0,1,2],[0,2,3]]},fields:{groundElevationM:[0,0,20,10]}}).toSnapshot();
// Instrumented DOM/event harness, NOT a real browser or GPU acceptance test.
test('actual regional page handles replacement, stale reads, failed upload, recovery and back/forward lifecycle',async()=>{
 const originals={document:globalThis.document,window:globalThis.window,requestAnimationFrame:globalThis.requestAnimationFrame,performance:globalThis.performance},originalUpload=SoftwareRenderer.prototype.upload;
 const nodes=new Map(),frames=[];let now=0;
 function node(id){const listeners=new Map();const n={id,value:'',disabled:false,textContent:'',files:[],clientWidth:320,clientHeight:220,
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);},
  emit(type,event={}){return Promise.all((listeners.get(type)??[]).map(f=>f(event)));},click(){return n.emit('click');},
  cloneNode(){return node(id);},replaceWith(other){nodes.set(id,other);},
  getContext(kind){if(kind!=='2d')return null;return{createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4),width:w,height:h}),putImageData:p=>{n.image=p;}};}};return n;}
 for(const id of ['view','file','state','heading','tilt','distance','scale','heading-value','tilt-value','distance-value','scale-value','lat','lon','details','reset','recover','report'])nodes.set(id,node(id));
 for(const[id,value]of[['heading','0'],['tilt','45'],['distance','600'],['scale','1'],['lat','0'],['lon','0']])nodes.get(id).value=value;
 const win=node('window');globalThis.document={getElementById:id=>nodes.get(id)};globalThis.window=win;globalThis.performance={now:()=>now};globalThis.requestAnimationFrame=fn=>{frames.push(fn);return frames.length;};
 async function settle(p=Promise.resolve()){let done=false,error;p.then(()=>{done=true;},e=>{error=e;done=true;});for(let i=0;i<500;i++){now+=1000;for(const fn of frames.splice(0))fn(now);await new Promise(setImmediate);if(done&&!frames.length)break;}if(error)throw error;assert.ok(done,'UI operation stalled');await p;}
 const file=(raw,name='terrain.json')=>({name,size:JSON.stringify(raw).length,text:async()=>JSON.stringify(raw)});
 const load=async raw=>{nodes.get('file').files=[file(raw)];await settle(nodes.get('file').emit('change'));};
 try{
  await import('../src/globe/relief-view.mjs');const a=source('A'),b=source('B'),c=source('C');await load(a);
  assert.match(nodes.get('state').textContent,/読み込みました/);assert.match(nodes.get('details').textContent,new RegExp(a.worldId));
  nodes.get('scale').value='3';await settle(nodes.get('scale').emit('input'));assert.equal(nodes.get('scale-value').textContent,'3×');assert.match(nodes.get('details').textContent,new RegExp(a.worldId));
  nodes.get('file').files=[{name:'bad.json',size:1,text:async()=>'{'}];await settle(nodes.get('file').emit('change'));assert.match(nodes.get('state').textContent,/以前の表示は保持/);
  let release;nodes.get('file').files=[{name:'slow.json',size:10,text:()=>new Promise(resolve=>release=resolve)}];const slow=nodes.get('file').emit('change');await load(b);release(JSON.stringify(a));await settle(slow);assert.match(nodes.get('details').textContent,new RegExp(b.worldId));
  let count=0;SoftwareRenderer.prototype.upload=function(m){if(++count===2)throw new Error('injected upload failure');return originalUpload.call(this,m);};await load(c);assert.match(nodes.get('state').textContent,/再準備/);assert.match(nodes.get('details').textContent,new RegExp(b.worldId));
  SoftwareRenderer.prototype.upload=originalUpload;await settle(nodes.get('recover').click());assert.match(nodes.get('details').textContent,new RegExp(c.worldId));
  await settle(win.emit('pagehide'));await settle(win.emit('pageshow',{persisted:true}));assert.match(nodes.get('state').textContent,/再準備しました/);assert.match(nodes.get('details').textContent,new RegExp(c.worldId));
 }finally{await settle(win.emit('pagehide'));SoftwareRenderer.prototype.upload=originalUpload;for(const[k,v]of Object.entries(originals)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});

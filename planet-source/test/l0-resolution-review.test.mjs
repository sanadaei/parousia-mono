import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {spawnSync} from 'node:child_process';
import {createPlanetMacroTerrain} from '../src/core/planet-macro.mjs';import {createL0ResolutionSeries} from '../scripts/experiments/l0-resolution-series.mjs';
test('standalone resolution controls reuse precomputed data, preserve location and disclose colour meaning',async()=>{
 const grid={columns:16,rows:8},frame={radiusM:6371000},{recipe}=createPlanetMacroTerrain({seed:'review',...grid,...frame});
 const series=createL0ResolutionSeries({worldId:'review',grid,frame,references:{macroRecipe:recipe,sea:{levelElevationM:0}}});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'l0-review-'));
 try{
  const input=path.join(dir,'series.json'),out=path.join(dir,'review.html');fs.writeFileSync(input,JSON.stringify(series));
  const result=spawnSync(process.execPath,['scripts/build-l0-resolution-review.mjs',input,out],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);
  const html=fs.readFileSync(out,'utf8');assert.match(html,/植生・砂漠・積雪の色ではありません/);assert.match(html,/上位段階の流域/);
  const script=html.split('<script>')[1].split('</script>')[0];
  let paints=0;const context2d={createImageData:(w,h)=>({data:new Uint8ClampedArray(w*h*4)}),putImageData(){},clearRect(){},drawImage(){paints++;},beginPath(){},moveTo(){},lineTo(){},stroke(){},strokeRect(){}};
  const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:id==='view'?'global':id==='water'?'300000':'',textContent:'',getContext:()=>context2d,getBoundingClientRect:()=>({left:0,top:0,width:1200,height:600}),append(o){if(this.value==='')this.value=String(o.value);}});return elements.get(id);};
  const sandbox={Uint8Array,Blob,Response,DecompressionStream,atob,document:{getElementById:element,createElement:type=>type==='canvas'?{getContext:()=>context2d}:{}}};
  await vm.runInNewContext(script,sandbox,{timeout:5000});assert.match(element('status').textContent,/16 × 8/);assert.ok(element('previous').disabled);assert.equal(element('next').disabled,false);
  element('map').onpointerdown({clientX:600,clientY:300});assert.match(element('cell').textContent,/経度 180.00/);
  element('next').onclick();assert.match(element('status').textContent,/32 × 16/);assert.match(element('cell').textContent,/経度 180.00/);
  element('next').onclick();assert.match(element('status').textContent,/64 × 32/);assert.equal(element('next').disabled,true);
  element('previous').onclick();assert.match(element('status').textContent,/32 × 16/);
  element('water').value='off';element('water').onchange();assert.ok(paints>=5);
 }finally{fs.rmSync(dir,{recursive:true});}
});

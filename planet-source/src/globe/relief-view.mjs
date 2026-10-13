import {prepareTriangularRegion,replaceTriangularPackets} from './triangular-session.mjs';
import {GlobeRenderer} from './renderer.mjs';import {SoftwareRenderer} from './software-renderer.mjs';
import {createOrbitCamera} from './view-state.mjs';import {sphereBasis} from '../core/spherical.mjs';
const $=id=>document.getElementById(id),status=text=>{$('state').textContent=text;},yieldNow=()=>new Promise(requestAnimationFrame);
let canvas=$('view'),renderer=null,prepared=null,tiles=[],epoch=0,pendingFrame=null,lastDraw=null,rendererAlive=true,recoveryPrepared=null;
function makeRenderer(){
 let next;
 try{next=new GlobeRenderer(canvas);}
 catch{const fresh=canvas.cloneNode();canvas.replaceWith(fresh);canvas=fresh;next=new SoftwareRenderer(canvas,{pixelScale:.5,maxDimension:640});}
 canvas.addEventListener('webglcontextlost',()=>status('描画が中断されました。「描画を再準備」で再開できます。'));
 return next;
}
renderer=makeRenderer();
function distance(){return Math.max(10,(prepared?.extentM??1000)*(.08+3.92*(Number($('distance').value)/1000)**2));}
function schedule(){if(pendingFrame!==null)return;pendingFrame=requestAnimationFrame(draw);}
function draw(){pendingFrame=null;if(!prepared||!tiles.length||!rendererAlive)return;
 if(renderer.lost){status('描画が中断されています。「描画を再準備」を押してください。');return;}
 if(renderer.nextDrawAt>performance.now()){pendingFrame=setTimeout(()=>{pendingFrame=null;schedule();},renderer.nextDrawAt-performance.now());return;}
 const heading=Number($('heading').value),tilt=Number($('tilt').value),heightScale=Number($('scale').value),altitude=distance();
 $('heading-value').textContent=`${heading}°`;$('tilt-value').textContent=`${tilt}°`;$('scale-value').textContent=`${heightScale}×`;$('distance-value').textContent=`${Math.round(altitude)} m`;
 const camera=createOrbitCamera({...prepared.focus,altitude,heading:heading*Math.PI/180,tilt:tilt*Math.PI/180},{radiusM:prepared.view.radiusM,heightScale,aspect:canvas.clientWidth/canvas.clientHeight});camera.radiusM=prepared.view.radiusM;
 const basis=sphereBasis(prepared.focus.point);camera.sun=basis.up.map((v,i)=>.86*v+.3*basis.east[i]+.41*basis.north[i]);const length=Math.hypot(...camera.sun);camera.sun=camera.sun.map(v=>v/length);
 try{lastDraw=renderer.draw(camera,tiles.map(tile=>({tile,morph:1,stitchMask:0})),performance.now());}
 catch(error){status(`描画できません: ${error.message}`);return;}
 $('details').textContent=JSON.stringify({sourceWorldId:prepared.view.sourceWorldId,viewId:prepared.view.viewId,renderer:renderer.device??'WebGL2',packets:tiles.length,bufferBytes:prepared.bytes,draw:lastDraw,scope:'地域表示。全球の境界・流域・水面は未接続'},null,2);
}
function reset(){for(const[id,v]of[['heading',0],['tilt',45],['distance',600],['scale',1]])$(id).value=v;schedule();}
$('file').addEventListener('change',async()=>{
 const file=$('file').files[0];if(!file)return;const request=++epoch,isCurrent=()=>request===epoch;recoveryPrepared=null;$('recover').disabled=!prepared;
 try{
  if(file.size>16*1024*1024)throw new RangeError('ファイルは16 MiB以下にしてください');status('保存地形を確認しています…');
  const input=JSON.parse(await file.text());if(!isCurrent())return;
  const next=await prepareTriangularRegion(input,{centerLatDeg:Number($('lat').value),centerLonDeg:Number($('lon').value)},{yieldNow,isCurrent,onProgress:(n,total)=>status(`地形の表示範囲を準備しています ${n}/${total}`)});
  recoveryPrepared=next;$('recover').disabled=false;
  const nextTiles=await replaceTriangularPackets(renderer,tiles,next,{yieldNow,isCurrent});
  prepared=next;tiles=nextTiles;recoveryPrepared=null;for(const id of ['reset','recover','report'])$(id).disabled=false;
  if(isCurrent()){status(`${file.name} を読み込みました。${renderer.gl?'WebGL':'CPU診断'}表示です。`);reset();}else schedule();
 }catch(error){if(error.name!=='AbortError'&&isCurrent())status(`読み込めません: ${error.message}。${tiles.length?'以前の表示は保持しています。':''}${recoveryPrepared?'描画を再準備して再試行できます。':''}`);}
});
for(const id of ['heading','tilt','distance','scale'])$(id).addEventListener('input',schedule);
$('reset').addEventListener('click',reset);window.addEventListener('resize',schedule);
$('recover').addEventListener('click',async()=>{
 if(!prepared&&!recoveryPrepared)return;const request=++epoch,current=recoveryPrepared??prepared;
 if(rendererAlive){for(const tile of tiles)renderer.dispose(tile);renderer.destroy();}tiles=[];const fresh=canvas.cloneNode();canvas.replaceWith(fresh);canvas=fresh;renderer=makeRenderer();rendererAlive=true;
 try{tiles=await replaceTriangularPackets(renderer,[],current,{yieldNow,isCurrent:()=>request===epoch});prepared=current;recoveryPrepared=null;for(const id of ['reset','recover','report'])$(id).disabled=false;status('保存地形から描画を再準備しました。');schedule();}catch(error){if(error.name!=='AbortError')status(`再準備できません: ${error.message}`);}
});
$('report').addEventListener('click',()=>{if(!prepared)return;const data={sourceWorldId:prepared.view.sourceWorldId,viewId:prepared.view.viewId,binding:prepared.view.contract,draw:lastDraw,renderer:renderer.device??'WebGL2',heightScale:Number($('scale').value),scope:'地域の手動確認記録。全惑星の完成判定ではありません。'},url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='regional-terrain-view.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
window.addEventListener('pagehide',()=>{++epoch;if(rendererAlive){for(const tile of tiles)renderer.dispose(tile);renderer.destroy();rendererAlive=false;}tiles=[];});
window.addEventListener('pageshow',event=>{if(event.persisted&&prepared)$('recover').click();});
